export default function handler(req, res) {
  // 安全檢查：不直接返回API key，而是代理請求
  // 檢查請求方法和參數
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 檢查環境變數是否存在
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.error('Missing environment variables:', {
      hasApiKey: !!process.env.AIRTABLE_API_KEY,
      hasBaseId: !!process.env.AIRTABLE_BASE_ID
    });
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  // 返回配置信息（不包含敏感資訊）
  const config = {
    configured: true,
    BASE_ID: process.env.AIRTABLE_BASE_ID, // Base ID 可以公開
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
