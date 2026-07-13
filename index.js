const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function scrapePSA(cert, retries = 3) {
  for (let i = 0; i < retries; i++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
        headless: true
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
      await page.goto(`https://www.psacard.com/cert/${cert}/psa`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await new Promise(r => setTimeout(r, 5000));

      const data = await page.evaluate(() => {
        const items = document.querySelectorAll('dl div');
        let grade = '', subject = '', variety = '', brand = '';
        items.forEach(item => {
          const dt = item.querySelector('dt');
          const dd = item.querySelector('dd');
          if (!dt || !dd) return;
          const label = dt.textContent.trim();
          const value = dd.textContent.trim();
          if (label === 'Item Grade') grade = value;
          if (label === 'Subject') subject = value;
          if (label === 'Variety/Pedigree') variety = value;
          if (label === 'Brand/Title') brand = value;
        });
        const images = Array.from(document.querySelectorAll('main img'))
          .map(img => img.src).filter(src => src.includes('cloudfront.net'));
        return { grade, subject, variety, brand, images };
      });

      await browser.close();
      if (data.grade && data.subject) {
        let language = 'EN';
        if (data.brand) {
          const b = data.brand.toUpperCase();
          if (b.includes('JAPANESE')) language = 'JP';
          else if (b.includes('KOREAN')) language = 'KR';
        }
        return { ...data, language };
      }
    } catch (err) {
      if (browser) await browser.close();
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

async function scrapeCGC(cert, retries = 3) {
  for (let i = 0; i < retries; i++) {
    let browser;
    try {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        headless: true
      });
      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      await page.goto(`http://www.cgccards.com/certlookup/${cert}/`, { waitUntil: 'networkidle2', timeout: 60000 });
      await new Promise(r => setTimeout(r, 7000));

      const data = await page.evaluate(() => {
        const allText = document.body.innerText;
        const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);
        let cardName = '', grade = '', language = '', variety = '', cardSet = '', brand = '';
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === 'Card Name') cardName = lines[i+1] || '';
          if (lines[i] === 'Grade') grade = lines[i+1] || '';
          if (lines[i] === 'Language') language = lines[i+1] || '';
          if (lines[i] === 'Variant 1') variety = lines[i+1] || '';
          if (lines[i] === 'Card Set') cardSet = lines[i+1] || '';
          if (lines[i] === 'Game') brand = lines[i+1] || '';
        }
        let langCode = '';
        if (language.toLowerCase().includes('japanese')) langCode = 'JP';
        else if (language.toLowerCase().includes('korean')) langCode = 'KR';
        else if (language.toLowerCase().includes('english')) langCode = 'EN';
        return { cardName, grade, variety, cardSet, brand, language: langCode, rawText: allText.slice(0, 500) };
      });

      await browser.close();
      if (data.cardName) return data;
      // 파싱 실패해도 rawText 반환해서 디버깅
      if (data.rawText) return { debug: data.rawText };
    } catch (err) {
      if (browser) await browser.close();
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

app.get('/psa', async (req, res) => {
  const { cert } = req.query;
  if (!cert) return res.status(400).json({ error: '써티 번호 없음' });
  const { data: cached } = await supabase.from('graded_cards').select().eq('cert_number', cert).single();
  if (cached && cached.card_name) {
    return res.json({ cert, cardName: cached.card_name, grade: cached.grade, variety: cached.variety, language: cached.language, cached: true });
  }
  const data = await scrapePSA(cert);
  if (!data) return res.status(404).json({ error: '카드 정보를 찾을 수 없습니다' });
  res.json({ cert, cardName: data.subject, grade: data.grade, variety: data.variety, brand: data.brand, language: data.language, images: data.images || [] });
});

app.get('/cgc', async (req, res) => {
  const { cert } = req.query;
  if (!cert) return res.status(400).json({ error: '써티 번호 없음' });
  const { data: cached } = await supabase.from('graded_cards').select().eq('cert_number', cert).single();
  if (cached && cached.card_name) {
    return res.json({ cert, cardName: cached.card_name, grade: cached.grade, variety: cached.variety, language: cached.language, cached: true });
  }
  const data = await scrapeCGC(cert);
  if (!data) return res.status(404).json({ error: 'CGC 카드 정보를 찾을 수 없습니다' });
  if (data.debug) return res.status(200).json({ debug: data.debug, error: '파싱 실패' });
  res.json({ cert, cardName: data.cardName, grade: data.grade, variety: data.variety, brand: data.brand, language: data.language, cardSet: data.cardSet });
});

app.get('/products', async (req, res) => {
  const { data, error } = await supabase.from('products').select().order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/graded-cards', async (req, res) => {
  const { data, error } = await supabase.from('graded_cards').select().order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/transactions', async (req, res) => {
  const { data, error } = await supabase.from('transactions').select().order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/products', async (req, res) => {
  const { barcode, name, type, country, packs, sell_price, avg_cost, qty } = req.body;
  const { data: existing } = await supabase.from('products').select().eq('barcode', barcode).single();
  if (existing) {
    const newQty = existing.qty + (qty || 1);
    const newCost = (existing.avg_cost * existing.qty + (avg_cost||0) * (qty||1)) / newQty;
    const { data, error } = await supabase.from('products').update({ qty: newQty, avg_cost: newCost }).eq('barcode', barcode).select();
    if (error) return res.status(500).json({ error: error.message });
    await supabase.from('transactions').insert({ type: 'in', product_type: 'product', product_id: existing.id, name, qty, price: avg_cost, total: (avg_cost||0)*(qty||1), cost: avg_cost, pay_method: '-' });
    return res.json(data);
  }
  const { data, error } = await supabase.from('products').insert({ barcode, name, type, country, packs, sell_price, avg_cost: avg_cost||0, qty: qty||1 }).select();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('transactions').insert({ type: 'in', product_type: 'product', product_id: data[0].id, name, qty, price: avg_cost, total: (avg_cost||0)*(qty||1), cost: avg_cost, pay_method: '-' });
  res.json(data);
});

app.post('/graded-cards', async (req, res) => {
  const { cert_number, card_name, grade, variety, image_url, grader, language, brand, card_set, avg_cost } = req.body;
  const { data, error } = await supabase.from('graded_cards').upsert({ cert_number, card_name, grade, variety, image_url, grader: grader||'PSA', language, brand, card_set, avg_cost: avg_cost||0 }).select();
  if (error) return res.status(500).json({ error: error.message });
  await supabase.from('transactions').insert({ type: 'in', product_type: 'graded_card', name: card_name||cert_number, qty: 1, price: avg_cost, total: avg_cost, cost: avg_cost, pay_method: '-' });
  res.json(data);
});

app.post('/sell', async (req, res) => {
  const { items, pay_method } = req.body;
  for (const item of items) {
    if (item.product_type === 'product') {
      const { data: p } = await supabase.from('products').select().eq('id', item.product_id).single();
      if (p) await supabase.from('products').update({ qty: p.qty - item.qty }).eq('id', item.product_id);
    } else {
      await supabase.from('graded_cards').update({ status: 'sold' }).eq('id', item.product_id);
    }
    await supabase.from('transactions').insert({ type: 'out', product_type: item.product_type, product_id: item.product_id, name: item.name, qty: item.qty, price: item.price, total: item.price * item.qty, cost: item.cost, pay_method });
  }
  res.json({ success: true });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
