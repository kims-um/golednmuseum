const axios = require('axios');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { cert } = req.query;
  if (!cert) return res.status(400).json({ error: '써티 번호를 입력해주세요' });

  const token = process.env.PSA_TOKEN;
  if (!token) return res.status(500).json({ error: 'PSA 토큰이 설정되지 않았습니다' });

  try {
    const response = await axios.get(
      `https://api.psacard.com/publicapi/cert/GetByCertNumber/${cert}`,
      {
        headers: { 'Authorization': `bearer ${token}` },
        timeout: 10000,
      }
    );

    const data = response.data;

    if (!data.IsValidRequest) {
      return res.status(400).json({ error: '유효하지 않은 써티 번호입니다' });
    }
    if (data.ServerMessage === 'No data found') {
      return res.status(404).json({ error: '해당 써티 번호의 카드를 찾을 수 없습니다' });
    }

    const cert_data = data.PSACert || data;

    return res.status(200).json({
      cert: cert,
      cardName: cert_data.Subject || cert_data.CardName || '',
      grade: cert_data.CardGrade || cert_data.Grade || '',
      year: cert_data.Year || '',
      brand: cert_data.Brand || cert_data.SetName || '',
      cardNumber: cert_data.CardNumber || '',
      totalPopulation: cert_data.TotalPopulation || '',
    });

  } catch (err) {
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'PSA 토큰이 만료됐습니다. 토큰을 재발급해주세요.' });
    }
    if (err.response?.status === 500) {
      return res.status(400).json({ error: '잘못된 써티 번호이거나 PSA 서버 오류입니다' });
    }
    return res.status(500).json({ error: '서버 오류: ' + err.message });
  }
};
