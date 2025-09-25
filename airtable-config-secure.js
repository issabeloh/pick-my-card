// 安全的Airtable配置 - 使用代理API
let AIRTABLE_CONFIG = null;

// 從API載入配置信息
async function loadConfig() {
    if (AIRTABLE_CONFIG) {
        return AIRTABLE_CONFIG;
    }
    
    try {
        console.log('🔄 載入Airtable配置...');
        const response = await fetch('/api/config');
        
        if (!response.ok) {
            throw new Error(`配置API錯誤: ${response.status} ${response.statusText}`);
        }
        
        const configData = await response.json();
        
        if (!configData.configured) {
            throw new Error('Airtable未正確配置');
        }
        
        AIRTABLE_CONFIG = {
            BASE_ID: configData.BASE_ID,
            TABLES: configData.TABLES,
            BASE_URL: configData.BASE_URL,
            configured: true
        };
        
        console.log('✅ Airtable配置載入成功');
        console.log('🗃️ Base ID:', AIRTABLE_CONFIG.BASE_ID);
        
        return AIRTABLE_CONFIG;
    } catch (error) {
        console.error('❌ 載入配置失敗:', error);
        throw error;
    }
}

// 使用代理API獲取資料
async function fetchTableData(tableName) {
    if (!AIRTABLE_CONFIG) {
        throw new Error('配置尚未載入，請先調用 loadConfig()');
    }
    
    try {
        const url = `/api/airtable-proxy?table=${tableName}`;
        console.log(`🔄 載入 ${tableName} 資料...`);
        
        const response = await fetch(url);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`API錯誤 (${response.status}): ${errorData.error || response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`✅ ${tableName} 資料載入成功:`, data.records.length, '筆記錄');
        
        return data;
    } catch (error) {
        console.error(`❌ 載入 ${tableName} 資料失敗:`, error);
        throw error;
    }
}

// 建構API URL的輔助函數（現在不需要了，但保留向後兼容性）
function getTableUrl(tableConfig) {
    return `/api/airtable-proxy?table=${tableConfig.TABLE_NAME}`;
}

// API請求標頭（現在不需要了，但保留向後兼容性）
function getApiHeaders() {
    return {
        'Content-Type': 'application/json'
    };
}

// 檢查配置是否可用
function isConfigured() {
    return AIRTABLE_CONFIG && AIRTABLE_CONFIG.configured;
}

// 匯出函數
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { 
        loadConfig, 
        fetchTableData, 
        getTableUrl, 
        getApiHeaders, 
        isConfigured 
    };
}