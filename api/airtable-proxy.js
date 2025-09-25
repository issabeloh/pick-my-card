export default async function handler(req, res) {
  // 只允許GET請求
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // 檢查環境變數
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.error('Missing Airtable environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }
  
  try {
    const { table } = req.query;
    
    // 驗證table參數
    if (!table || !['Cards', 'CashbackRates'].includes(table)) {
      return res.status(400).json({ error: 'Invalid table parameter' });
    }
    
    // 構建Airtable API URL
    const airtableUrl = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${table}`;
    
    console.log('Proxying request to:', airtableUrl);
    
    // 代理請求到Airtable
    const airtableResponse = await fetch(airtableUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!airtableResponse.ok) {
      console.error('Airtable API error:', airtableResponse.status, airtableResponse.statusText);
      return res.status(airtableResponse.status).json({ 
        error: 'Airtable API error',
        status: airtableResponse.status,
        statusText: airtableResponse.statusText
      });
    }
    
    const data = await airtableResponse.json();
    
    // 設定CORS標頭
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, s-maxage=60'); // 快取1分鐘
    
    res.status(200).json(data);
    
  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}