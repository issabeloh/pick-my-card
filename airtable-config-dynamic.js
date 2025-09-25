// 動態載入Airtable配置的安全版本
let AIRTABLE_CONFIG = null;

// 從API載入配置
async function loadConfig() {
    if (AIRTABLE_CONFIG) {
        return AIRTABLE_CONFIG;
    }
    
    try {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        AIRTABLE_CONFIG = await response.json();
        
        // 驗證配置
        if (!AIRTABLE_CONFIG.API_KEY || !AIRTABLE_CONFIG.BASE_ID) {
            throw new Error('配置不完整：缺少API_KEY或BASE_ID');
        }
        
        console.log('✅ Airtable配置載入成功');
        return AIRTABLE_CONFIG;
    } catch (error) {
        console.error('❌ 載入配置失敗:', error);
        throw error;
    }
}

// 建構API URL的輔助函數
function getTableUrl(tableConfig) {
    if (!AIRTABLE_CONFIG) {
        throw new Error('配置尚未載入，請先調用 loadConfig()');
    }
    return `${AIRTABLE_CONFIG.BASE_URL}/${AIRTABLE_CONFIG.BASE_ID}/${tableConfig.TABLE_NAME}`;
}

// API請求標頭
function getApiHeaders() {
    if (!AIRTABLE_CONFIG) {
        throw new Error('配置尚未載入，請先調用 loadConfig()');
    }
    return {
        'Authorization': `Bearer ${AIRTABLE_CONFIG.API_KEY}`,
        'Content-Type': 'application/json'
    };
}

// 重置配置（用於測試）
function resetConfig() {
    AIRTABLE_CONFIG = null;
}

// 匯出函數
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { loadConfig, getTableUrl, getApiHeaders, resetConfig };
}