export default function handler(req, res) {
  // 只返回配置，不包含敏感資訊
  const config = {
    API_KEY: process.env.AIRTABLE_API_KEY,
    BASE_ID: process.env.AIRTABLE_BASE_ID,
    TABLES: {
      CARDS: {
        TABLE_NAME: 'Cards'
      },
      CASHBACK_RATES: {
        TABLE_NAME: 'CashbackRates'
      }
    },
    BASE_URL: 'https://api.airtable.com/v0'
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(config);
}