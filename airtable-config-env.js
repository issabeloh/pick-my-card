// Airtable API 環境變數配置檔案
// 從Vercel環境變數讀取敏感資訊

// 檢查是否在瀏覽器環境中，如果是則從window對象讀取環境變數
const getEnvVar = (key) => {
    // 在Vercel部署時，環境變數會被注入到全域變數中
    if (typeof window !== 'undefined' && window.ENV) {
        return window.ENV[key];
    }
    // 開發環境fallback - 您需要手動替換這些值用於本地測試
    const fallbacks = {
        'AIRTABLE_API_KEY': 'YOUR_API_KEY_HERE',
        'AIRTABLE_BASE_ID': 'YOUR_BASE_ID_HERE',
        'AIRTABLE_CARDS_TABLE_ID': 'YOUR_CARDS_TABLE_ID_HERE',
        'AIRTABLE_RATES_TABLE_ID': 'YOUR_RATES_TABLE_ID_HERE'
    };
    return fallbacks[key];
};

const AIRTABLE_CONFIG = {
    // 從環境變數讀取API金鑰
    API_KEY: getEnvVar('AIRTABLE_API_KEY'),
    
    // Base ID
    BASE_ID: getEnvVar('AIRTABLE_BASE_ID'),
    
    // 資料表設定
    TABLES: {
        CARDS: {
            TABLE_ID: getEnvVar('AIRTABLE_CARDS_TABLE_ID'),
            TABLE_NAME: 'Cards'
        },
        CASHBACK_RATES: {
            TABLE_ID: getEnvVar('AIRTABLE_RATES_TABLE_ID'),
            TABLE_NAME: 'CashbackRates'
        }
    },
    
    // API基礎URL
    BASE_URL: 'https://api.airtable.com/v0'
};

// 建構API URL的輔助函數
function getTableUrl(tableConfig) {
    return `${AIRTABLE_CONFIG.BASE_URL}/${AIRTABLE_CONFIG.BASE_ID}/${tableConfig.TABLE_NAME}`;
}

// API請求標頭
function getApiHeaders() {
    return {
        'Authorization': `Bearer ${AIRTABLE_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
    };
}

// 檢查配置是否完整
function validateConfig() {
    const requiredKeys = ['API_KEY', 'BASE_ID'];
    const requiredTables = ['CARDS', 'CASHBACK_RATES'];
    
    for (const key of requiredKeys) {
        if (!AIRTABLE_CONFIG[key] || AIRTABLE_CONFIG[key].includes('YOUR_')) {
            console.error(`❌ 缺少環境變數: ${key}`);
            return false;
        }
    }
    
    for (const table of requiredTables) {
        if (!AIRTABLE_CONFIG.TABLES[table].TABLE_ID || AIRTABLE_CONFIG.TABLES[table].TABLE_ID.includes('YOUR_')) {
            console.error(`❌ 缺少環境變數: ${table} TABLE_ID`);
            return false;
        }
    }
    
    console.log('✅ Airtable配置驗證成功');
    return true;
}

// 匯出設定供其他檔案使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AIRTABLE_CONFIG, getTableUrl, getApiHeaders, validateConfig };
}