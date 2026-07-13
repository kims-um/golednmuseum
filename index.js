const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/psa', async (req, res) => {
  const { cert } = req.query;
  if (!cert) return res.status(400).json({ error: '써티 번호 없음' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      headless: true
    });
    const page = await browser.newPage();
    await page.goto(`https://www.psacard.com/cert/${cert}/psa`, { 
      waitUntil: 'domcontentloaded', 
      timeout: 60000 
    });
    
    const data = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      const cardName = h1 ? h1.textContent.trim() : '';
      const items = document.querySelectorAll('dl div');
      let grade = '', year = '', brand = '', subject = '';
      items.forEach(item => {
        const dt = item.querySelector('dt');
        const dd = item.querySelector('dd');
        if (!dt || !dd) return;
        const label = dt.textContent.trim();
        const value = dd.textContent.trim();
        if (label === 'Item Grade') grade = value;
        if (label === 'Year') year = value;
        if (label === 'Brand/Title') brand = value;
        if (label === 'Subject') subject = value;
      });
      return { cardName, grade, year, brand, subject };
    });

    await browser.close();

    if (!data.grade && !data.subject) {
      return res.status(404).json({ error: '카드 정보를 찾을 수 없습니다' });
    }

    res.json({
      cert,
      cardName: data.subject || data.cardName,
      grade: data.grade,
      year: data.year,
      brand: data.brand,
    });

  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
