import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  try {
    // 讀取HTML模板檔案
    const htmlPath = join(process.cwd(), 'index-env.html');
    let html = readFileSync(htmlPath, 'utf8');
    
    // 替換環境變數
    html = html.replace(/\{\{AIRTABLE_API_KEY\}\}/g, process.env.AIRTABLE_API_KEY || '');
    html = html.replace(/\{\{AIRTABLE_BASE_ID\}\}/g, process.env.AIRTABLE_BASE_ID || '');
    html = html.replace(/\{\{AIRTABLE_CARDS_TABLE_ID\}\}/g, process.env.AIRTABLE_CARDS_TABLE_ID || '');
    html = html.replace(/\{\{AIRTABLE_RATES_TABLE_ID\}\}/g, process.env.AIRTABLE_RATES_TABLE_ID || '');
    
    // 設定適當的headers
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    // 回傳處理後的HTML
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error processing HTML:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
