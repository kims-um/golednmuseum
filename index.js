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
    await page.goto(`https://www.psacard.com/cert/${cert}/psa`, { waitUntil: 'networkidle2', timeout: 30000 });
    const content = await page.content();
    await browser.close();

    const nameMatch = content.match(/"Subject"\s*:\s*"([^"]+)"/);
    const gradeMatch = content.match(/"CardGrade"\s*:\s*"([^"]+)"/);
    const yearMatch = content.match(/"Year"\s*:\s*"([^"]+)"/);
    const brandMatch = content.match(/"Brand"\s*:\s*"([^"]+)"/);

    if (!nameMatch) return res.status(404).json({ error: '카드 정보를 찾을 수 없습니다' });

    res.json({
      cert,
      cardName: nameMatch?.[1] || '',
      grade: gradeMatch?.[1] || '',
      year: yearMatch?.[1] || '',
      brand: brandMatch?.[1] || ''
    });
  } catch (err) {
    if (browser) await browser.close();
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
