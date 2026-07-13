// ==========================================
// 信用卡管理系統 - Apps Script（新增 QuickSearch）
// ==========================================
//
// ⚠️ 這是 Google Sheets Apps Script 專案內「匯出主程式」的備份副本。
//    實際執行的版本在 Google Sheets 裡（試算表 → 擴充功能 → Apps Script），
//    改動時兩邊請同步（見 apps-script/README.md）。
//
// 2026-07-11 修正：日期範圍改由 resolvePeriodBounds() 統一決定——優先讀維護者輸入的
//    periodStart_N / periodEnd_N（日期源頭），某一邊讀不到時從 period_N 合併字串
//    （公式組出的 "YYYY/M/D~YYYY/M/D"）拆回來救援。修正前若輸入欄「讀不到」（欄位
//    標題對不上或欄名重複，儲存格有值也讀不到），periodStart 會缺席，前端過期判斷
//    拿不到開始日、已過期活動不被隱藏。套用於 cashbackRates / couponCashbacks；
//    並在 runQACheck 加入欄位結構與期間一致性檢查，匯出時直接報警。
//
// 2026-07-12 與線上版合併：
//    - 保留維護者的修改：_hide/_hide_1 專用隱藏槽處理移除（隱藏活動改走一般槽位
//      + hideInDisplay_N）；槽位上限 21→22 由 maxSlotIndex() 自動偵測取代（加新欄免改程式）
//    - 修正 coupon 兩個舊 bug：日期欄原本只在有 couponCap 時才匯出（沒 cap 的 coupon
//      過期判斷失效）；且未過 formatDateToISO（Date 儲存格會序列化成
//      "2026-06-29T16:00:00.000Z" UTC 字串，前端字串比較會提早一天過期）。
//      現統一走 resolvePeriodBounds，與 cashbackRates 相同。

// 建立自訂選單
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🎯 卡片管理')
    .addItem('✅ 檢查資料品質', 'runQACheck')
    .addItem('📥 匯出 JSON', 'exportToJSON')
    .addSeparator()
    .addItem('🗑️ 清除 QA 報告', 'clearQAReport')
    .addSeparator()
    .addItem('📦 立即寄送試算表備份', 'sendBackupEmail')
    .addItem('⏰ 啟用每月自動備份', 'setupMonthlyBackupTrigger')
    .addToUi();
    buildAutomationMenu_();
}

// ==========================================
// QA 檢查功能（保持不變）
// ==========================================

function runQACheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('Cards Data');
  const qaSheet = ss.getSheetByName('QA Check');

  if (!dataSheet || !qaSheet) {
    SpreadsheetApp.getUi().alert('找不到必要的工作表！');
    return;
  }

  // 清除舊的 QA 報告
  qaSheet.clear();

  // 設定標題
  qaSheet.getRange(1, 1, 1, 6).setValues([
    ['卡片ID', '卡片名稱', '問題類型', '欄位', '問題描述', '嚴重度']
  ]);
  qaSheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');

  // 讀取資料
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  const issues = [];

  // 必填欄位
  const requiredFields = ['id', 'name', 'fullName', 'basicCashback', 'annualFee', 'feeWaiver', 'website', 'tags'];

  // 檢查所有 ID（用於重複檢查）
  const idList = [];

  // 從第二行開始檢查（跳過標題）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cardId = row[headers.indexOf('id')];
    const cardName = row[headers.indexOf('name')];

    // 跳過空行
    if (!cardId && !cardName) continue;

    // 檢查 1: 必填欄位
    requiredFields.forEach(field => {
      const colIndex = headers.indexOf(field);
      if (colIndex >= 0 && !row[colIndex]) {
        issues.push([cardId, cardName, '缺少必填欄位', field, `${field} 欄位為空`, '❌']);
      }
    });

    // 檢查 2: ID 格式
    if (cardId) {
      if (!/^[a-z0-9-]+$/.test(cardId)) {
        issues.push([cardId, cardName, '格式錯誤', 'id', 'ID 只能包含小寫英文、數字和連字號', '❌']);
      }
      idList.push(cardId);
    }

    // 檢查 3: basicCashback 範圍
    const basicCashback = row[headers.indexOf('basicCashback')];
    if (basicCashback !== '' && (basicCashback < 0 || basicCashback > 100)) {
      issues.push([cardId, cardName, '數值超出範圍', 'basicCashback', '回饋率必須在 0-100 之間', '❌']);
    }

    // 檢查 4: website 格式
    const website = row[headers.indexOf('website')];
    if (website && !website.startsWith('https://')) {
      issues.push([cardId, cardName, '格式錯誤', 'website', '網址必須以 https:// 開頭', '⚠️']);
    }

    // 檢查 5: name 長度
    if (cardName && cardName.length > 20) {
      issues.push([cardId, cardName, '名稱過長', 'name', `名稱長度 ${cardName.length} 字，建議不超過 20 字`, '⚠️']);
    }

    // 檢查 6: rate 必須有 items
    for (let j = 1; j <= 5; j++) {
      const rateCol = headers.indexOf(`rate_${j}`);
      const itemsCol = headers.indexOf(`items_${j}`);

      if (rateCol >= 0 && itemsCol >= 0) {
        const rate = row[rateCol];
        const items = row[itemsCol];

        if (rate && !items) {
          issues.push([cardId, cardName, '資料不完整', `rate_${j}`, `有設定 rate_${j} 但沒有 items_${j}`, '❌']);
        }
      }
    }

    // 檢查 8: 期間欄位完整性與一致性（periodStart/End_N 是輸入源頭、period_N 是公式字串）
    // 8a: periodEnd_N 讀得到但 periodStart_N 讀不到 → 匯出會缺開始日（沒填、或欄位標題對不上）
    // 8b: period_N 與輸入的 periodStart/End_N 日期對不上 → 有一邊是舊資料（如肌膚之鑰誤植案例）
    for (let j = 1; j <= maxSlotIndex(headers, 'rate'); j++) {
      const ps = getValue(row, headers, `periodStart_${j}`);
      const pe = getValue(row, headers, `periodEnd_${j}`);
      const per = getValue(row, headers, `period_${j}`);
      if (!ps && !pe && !per) continue;

      if (pe && !ps) {
        issues.push([cardId, cardName, '期間欄位不完整', `periodStart_${j}`, `periodEnd_${j} 有值但讀不到 periodStart_${j}（沒填，或欄位標題對不上）`, '⚠️']);
      }

      if (per && String(per).indexOf('~') !== -1 && (ps || pe)) {
        const parts = String(per).split('~');
        const perStart = formatDateToISO(String(parts[0] || '').trim());
        const perEnd = formatDateToISO(String(parts[1] || '').trim());
        const typedStart = ps ? formatDateToISO(ps) : null;
        const typedEnd = pe ? formatDateToISO(pe) : null;
        if ((perStart && typedStart && perStart !== typedStart) ||
            (perEnd && typedEnd && perEnd !== typedEnd)) {
          issues.push([cardId, cardName, '期間欄位不一致', `period_${j}`, `period_${j}（${per}）與輸入的 periodStart/End_${j} 日期對不上，請確認哪邊才是對的`, '⚠️']);
        }
      }
    }
  }

  // 檢查 7: ID 重複
  const duplicateIds = idList.filter((id, index) => idList.indexOf(id) !== index);
  duplicateIds.forEach(id => {
    issues.push([id, '', 'ID 重複', 'id', `ID "${id}" 重複出現`, '❌']);
  });

  // 檢查 9: 欄位標題結構（匯出用 headers.indexOf 按「完全相同的字串」找欄，
  // 標題拼字／前後空格／大小寫／全形字元不對 = 整欄讀不到，儲存格有填也一樣）
  // 9a: periodStart_N / periodEnd_N 必須成對存在
  for (let j = 1; j <= maxSlotIndex(headers, 'rate'); j++) {
    const hasStart = headers.indexOf(`periodStart_${j}`) >= 0;
    const hasEnd = headers.indexOf(`periodEnd_${j}`) >= 0;
    if (hasStart !== hasEnd) {
      const missing = hasStart ? `periodEnd_${j}` : `periodStart_${j}`;
      const present = hasStart ? `periodStart_${j}` : `periodEnd_${j}`;
      issues.push(['(全表)', '', '欄位結構', missing, `有 ${present} 欄但找不到 ${missing} 欄（標題拼錯／多空格／漏建），該欄所有卡片的值都會匯不出去`, '⚠️']);
    }
  }
  // 9b: 欄位標題重複（indexOf 只會讀到最前面那欄，後面同名欄整欄被忽略）
  const seenHeaders = {};
  headers.forEach((h, idx) => {
    if (h === null || h === undefined || String(h).trim() === '') return;
    const key = String(h);
    if (seenHeaders[key] !== undefined) {
      issues.push(['(全表)', '', '欄位結構', key, `欄位標題「${key}」重複出現（第 ${seenHeaders[key] + 1} 欄與第 ${idx + 1} 欄），匯出只會讀最前面那欄`, '⚠️']);
    } else {
      seenHeaders[key] = idx;
    }
  });

  // 寫入 QA 報告
  if (issues.length > 0) {
    qaSheet.getRange(2, 1, issues.length, 6).setValues(issues);

    // 設定顏色
    for (let i = 0; i < issues.length; i++) {
      const severity = issues[i][5];
      const color = severity === '❌' ? '#fce8e6' : '#fff4ce';
      qaSheet.getRange(i + 2, 1, 1, 6).setBackground(color);
    }
  }

  // 統計結果
  const criticalCount = issues.filter(issue => issue[5] === '❌').length;
  const warningCount = issues.filter(issue => issue[5] === '⚠️').length;

  // 顯示結果
  const ui = SpreadsheetApp.getUi();
  if (criticalCount === 0 && warningCount === 0) {
    ui.alert('✅ 資料品質檢查完成', '沒有發現任何問題！可以安全匯出 JSON。', ui.ButtonSet.OK);
  } else {
    ui.alert('⚠️ 發現問題',
      `嚴重問題：${criticalCount} 個\n警告：${warningCount} 個\n\n請到 QA Check 工作表查看詳細內容。`,
      ui.ButtonSet.OK);
  }
}

// ==========================================
// 匯出 JSON 功能（新增 QuickSearch）
// ==========================================

function exportToJSON() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('Cards Data');
  const paymentsSheet = ss.getSheetByName('Payments');
  const quickSearchSheet = ss.getSheetByName('QuickSearch');
  const qaSheet = ss.getSheetByName('QA Check');
  const ui = SpreadsheetApp.getUi();

  // 先執行 QA 檢查
  runQACheck();

  // 檢查是否有嚴重問題
  const qaData = qaSheet.getDataRange().getValues();
  const criticalIssues = qaData.filter(row => row[5] === '❌').length - 1;

  if (criticalIssues > 0) {
    ui.alert('❌ 無法匯出',
      `發現 ${criticalIssues} 個嚴重問題，請先修正後再匯出。`,
      ui.ButtonSet.OK);
    return;
  }

  // 讀取資料
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];

  // 轉換成 JSON 格式
  const cards = [];

  function parseTags(tagsString) {
  if (!tagsString || tagsString.trim() === '') {
    return [];
  }
  // 分割字串、移除空白、過濾空值
  return tagsString
    .split(',')
    .map(tag => tag.trim())
    .filter(tag => tag.length > 0);
}

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const cardId = row[headers.indexOf('id')];

    // 跳過空行
    if (!cardId) continue;

    const card = {
      id: cardId,
      name: getValue(row, headers, 'name'),
      fullName: getValue(row, headers, 'fullName'),
      basicCashback: getValue(row, headers, 'basicCashback'),
      pointsExpiry: getValue(row, headers, 'pointsExpiry'),
      annualFee: getValue(row, headers, 'annualFee'),
      feeWaiver: getValue(row, headers, 'feeWaiver'),
      website: getValue(row, headers, 'website'),
      tags: parseTags(getValue(row, headers, 'tags'))
    };

    // 選填欄位
    addOptionalField(card, row, headers, 'basicCashbackType');
    addOptionalField(card, row, headers, 'basicConditions');
    addOptionalField(card, row, headers, 'domesticBonusConditions');
    addOptionalField(card, row, headers, 'overseasBonusConditions');
    addOptionalField(card, row, headers, 'hasLevels', 'boolean');
    addOptionalField(card, row, headers, 'overseasCashback', 'number');
    addOptionalField(card, row, headers, 'overseasBonusRate', 'number');
    addOptionalField(card, row, headers, 'overseasBonusCap', 'number');
    addOptionalField(card, row, headers, 'domesticBonusRate', 'number');
    addOptionalField(card, row, headers, 'domesticBonusCap', 'number');
    addOptionalField(card, row, headers, 'overseasBonusPeriod');
    addOptionalField(card, row, headers, 'domesticBonusPeriod');
    addOptionalField(card, row, headers, 'autoBillCashback', 'number');
    addOptionalField(card, row, headers, 'autoBillCap', 'number');

    // ========== hasLevels 卡片處理（僅處理 levelSettings）==========
  if (card.hasLevels) {
    const levelSettingsStr = getValue(row, headers, 'levelSettings');
    if (levelSettingsStr) {
      try {
        card.levelSettings = JSON.parse(levelSettingsStr);
      } catch (e) {
        Logger.log('levelSettings JSON 解析失敗 (' + card.id + '): ' + e);
        // 提供預設值（可選）
        card.levelSettings = {};
    }
  }

  addOptionalField(card, row, headers, 'levelLabelFormat');
}

    // cashbackRates - 處理 rate_N（槽位上限依表頭自動偵測，加新欄不用改程式）
    card.cashbackRates = [];
    const maxRateSlot = maxSlotIndex(headers, 'rate');
    for (let j = 1; j <= maxRateSlot; j++) {
      const rate = getValue(row, headers, `rate_${j}`);
      const items = getValue(row, headers, `items_${j}`);

    if (items && (rate || rate === 0)) {
    const rateObj = {
      items: items.split(',').map(s => s.trim())
    };

    // 🔥 判斷 rate 是否為變數格式 {specialRate}
    const rateValue = String(rate).trim();

    // 使用正則表達式匹配 {任意欄位名} 格式
    if (rateValue.match(/^\{.+\}$/)) {
      rateObj.rate = rateValue;  // 保持字串（如 {rate_1}, {specialRate}, {rate} 等）
    } else {
      const parsed = parseFloat(rate);
      if (isNaN(parsed)) continue;   // 非數字垃圾 → 整組跳過（0 會正常過）
      rateObj.rate = parsed;
    }

    const cap = getValue(row, headers, `cap_${j}`);
    if (cap) {
      const capValue = String(cap).trim();
      // 使用正則表達式匹配 {任意欄位名} 格式
      if (capValue.match(/^\{.+\}$/)) {
        rateObj.cap = capValue;  // 保持字串（如 {cap_1}, {cap} 等）
      } else {
        rateObj.cap = parseInt(cap);
      }
    }

    addOptionalField(rateObj, row, headers, `category_${j}`, 'string', 'category');
    addOptionalField(rateObj, row, headers, `conditions_${j}`, 'string', 'conditions');
    addOptionalField(rateObj, row, headers, `period_${j}`, 'string', 'period');
    addOptionalField(rateObj, row, headers, `hideInDisplay_${j}`, 'boolean', 'hideInDisplay');
    addOptionalField(rateObj, row, headers, `cashbackModel_${j}`, 'string', 'cashbackModel');

    // 日期範圍：輸入欄 periodStart_N/periodEnd_N 為準，讀不到的那一邊從 period_N 字串救回
    resolvePeriodBounds(
      rateObj,
      getValue(row, headers, `period_${j}`),
      getValue(row, headers, `periodStart_${j}`),
      getValue(row, headers, `periodEnd_${j}`)
    );

    card.cashbackRates.push(rateObj);
  }
}


// （原 _hide／_hide_1 專用隱藏槽處理已於 2026-07-12 退役——隱藏活動改用一般槽位
//   （目前是 21/22）配 hideInDisplay_N=TRUE，主迴圈的 addOptionalField 會自動帶出，
//   計算/匹配規則與一般槽完全相同，rate=0 一樣放行）

    // couponCashbacks（槽位上限依表頭自動偵測）
card.couponCashbacks = [];
const maxCouponSlot = maxSlotIndex(headers, 'couponMerchant');
for (let j = 1; j <= maxCouponSlot; j++) {
  const merchant = getValue(row, headers, `couponMerchant_${j}`);
  const rate = getValue(row, headers, `couponRate_${j}`);

  if (merchant && rate) {
    // 判斷 rate 是否需要保持字串格式
    const rateValue = String(rate).trim();
    let couponRate;

    // 如果包含 '+' 或變數名稱，保持字串；否則轉成數字
    if (rateValue.includes('+') ||
        rateValue === 'specialRate' ||
        rateValue === 'generalRate') {
      couponRate = rateValue;  // 保持字串
    } else {
      couponRate = parseFloat(rateValue);  // 轉成數字
    }

    const coupon = {
      merchant: merchant,
      rate: couponRate,  // ✅ 現在可以是字串或數字
      conditions: getValue(row, headers, `couponConditions_${j}`) || '',
      period: getValue(row, headers, `couponPeriod_${j}`) || ''
    };

    // 新增：抓取 cap 欄位
    const cap = getValue(row, headers, `couponCap_${j}`);
    if (cap) coupon.cap = parseFloat(cap);

    // 日期範圍：輸入欄 couponPeriodStart/End_N 為準、couponPeriod_N 字串救援
    resolvePeriodBounds(
      coupon,
      getValue(row, headers, `couponPeriod_${j}`),
      getValue(row, headers, `couponPeriodStart_${j}`),
      getValue(row, headers, `couponPeriodEnd_${j}`)
    );

    card.couponCashbacks.push(coupon);
  }
}

if (card.couponCashbacks.length === 0) {
  delete card.couponCashbacks;
}

cards.push(card);
}  // ← 這裡關閉主循環（處理每一張卡片的 for 循環）

  // ========== 匯出行動支付資料 ==========
  const payments = [];

  if (paymentsSheet) {
    const paymentsData = paymentsSheet.getDataRange().getValues();
    const paymentsHeaders = paymentsData[0];

    for (let i = 1; i < paymentsData.length; i++) {
      const row = paymentsData[i];
      const paymentId = getValue(row, paymentsHeaders, 'id');

      if (!paymentId) continue;

      const payment = {
        id: paymentId,
        name: getValue(row, paymentsHeaders, 'name')
      };

      const website = getValue(row, paymentsHeaders, 'website');
      if (website) {
        payment.website = website;
      }

      payment.searchTerms = generateSearchTerms(paymentId, payment.name);

      payments.push(payment);
    }
  }

  // ========== ✨ 新增：匯出 QuickSearch 資料 ==========
  const quickSearchOptions = [];

  if (quickSearchSheet) {
    const quickSearchData = quickSearchSheet.getDataRange().getValues();
    const quickSearchHeaders = quickSearchData[0];

    for (let i = 1; i < quickSearchData.length; i++) {
      const row = quickSearchData[i];
      const quickId = getValue(row, quickSearchHeaders, 'id');

      if (!quickId) continue;

      const quickOption = {
        id: quickId,
        displayName: getValue(row, quickSearchHeaders, 'displayName'),
        icon: getValue(row, quickSearchHeaders, 'icon'),
        merchants: getValue(row, quickSearchHeaders, 'merchants').split(',').map(s => s.trim()),
        order: parseInt(getValue(row, quickSearchHeaders, 'order')) || 999
      };

      quickSearchOptions.push(quickOption);
    }

    // 按 order 排序
    quickSearchOptions.sort((a, b) => a.order - b.order);
  }

// ========== 匯出商家付款方式資料 ==========
  const merchantPayments = {};

  const merchantPaymentsSheet = ss.getSheetByName('Merchant Payments');
  if (merchantPaymentsSheet) {
    const merchantData = merchantPaymentsSheet.getDataRange().getValues();
    const merchantHeaders = merchantData[0];

    for (let i = 1; i < merchantData.length; i++) {
      const row = merchantData[i];
      const merchant = getValue(row, merchantHeaders, 'merchant');

      if (!merchant) continue;

      merchantPayments[merchant] = {
        online: getValue(row, merchantHeaders, 'online_payment') || '',
        offline: getValue(row, merchantHeaders, 'offline_payment') || '',
        source_url: getValue(row, merchantHeaders, 'source_url') || '',
        last_updated: getValue(row, merchantHeaders, 'last_updated') || ''
      };
    }
  }

// ========== 匯出 Search Hints 資料 ==========
    const searchHints = {};

const searchHintsSheet = ss.getSheetByName('Search Hints');
if (searchHintsSheet) {
  const hintsData = searchHintsSheet.getDataRange().getValues();
  const hintsHeaders = hintsData[0];

  for (let i = 1; i < hintsData.length; i++) {
    const row = hintsData[i];
    const keywordsStr = getValue(row, hintsHeaders, 'keywords');  // ← 改成 keywords
    const active = getValue(row, hintsHeaders, 'active');

    // 只匯出啟用的提示
    if (!keywordsStr || (active !== true && active !== 'TRUE' && active !== 'true')) {
      continue;
    }

    const suggestions = getValue(row, hintsHeaders, 'suggestions');
    const displayMessage = getValue(row, hintsHeaders, 'display_message');

    // 🔥 新增：將 keywords 字串分割成陣列
    const keywordsList = keywordsStr.split(',').map(k => k.trim().toLowerCase());

    // 為每個 keyword 建立相同的提示
    const hintObj = {
      suggestions: suggestions ? suggestions.split(',').map(s => s.trim()) : [],
      message: displayMessage || '💡 建議也搜尋：'
    };

    // 將每個 keyword 都對應到相同的提示
    keywordsList.forEach(keyword => {
      if (keyword) {
        searchHints[keyword] = hintObj;
      }
    });
  }

  Logger.log('Search Hints 載入成功：' + Object.keys(searchHints).length + ' 個關鍵詞');
}

// ========== 新增讀取FAQ資料 ==========
const faqSheet = ss.getSheetByName('FAQ');
let faqList = [];

if (faqSheet) {
  const faqData = faqSheet.getDataRange().getValues();
  const faqHeaders = faqData[0];  // 保留這行以供未來使用

  for (let i = 1; i < faqData.length; i++) {
    const row = faqData[i];

    // 跳過完全空白的行
    if (!row[0] && !row[2]) continue;

    const id = row[0];
    const category = row[1] || '';  // 允許空值
    const question = row[2];
    const answer = row[3];
    const order = row[4] || i;  // 如果沒填 order，使用行號
    const isActive = row[5];

    // 只處理啟用的項目

    if (isActive !== true && isActive !== 'TRUE' && isActive !== 'true') {

      continue;

    }

    faqList.push({
      id: String(id),
      category: category,
      question: question,
      answer: answer,
      order: order,
      isActive: true
    });
  }

  // 依照 order 排序
  faqList.sort((a, b) => a.order - b.order);

  Logger.log('FAQ 資料載入成功：' + faqList.length + ' 筆');
}

// ========== 讀取 Announcements 資料 ==========
  const announcements = getAnnouncements();
  const benefits = readCardBenefits();
  const referralLinks = readReferralLinks();
  const cashbackSites = readCashbackSites();
  const promoData = readNewCardholderPromos();
  const newCardholderPromos = promoData.newCardholderPromos;
  const cardApplyCtas = promoData.cardApplyCtas;
  const spotlights = readHighlights();

  // 生成 cards.json 內容
  const jsonContent = JSON.stringify({
  lastUpdated: Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy/M/d"),
  cards: cards,
  payments: payments,
  quickSearchOptions: quickSearchOptions,
  merchantPayments: merchantPayments,
  faq: faqList,
  announcements: announcements,
  searchHints: searchHints,
  benefits: benefits,
  referralLinks: referralLinks,
  cashbackSites: cashbackSites,
  newCardholderPromos: newCardholderPromos,
  cardApplyCtas: cardApplyCtas,
  spotlights: spotlights
  }, null, 2);


  // 🔒 Base64 編碼 → 直接發布到 GitHub（cards.data + cards.version），
  //    Vercel 自動部署。不再產生 Drive 下載檔（2026-07-12 移除：下載區塊
  //    每次匯出都在 Drive 堆兩個永不清理的檔案；歷史版本備份由 GitHub
  //    的 commit 紀錄承擔，原始資料的備份由 Google Sheets 版本記錄承擔）。
  const encoded = Utilities.base64Encode(jsonContent, Utilities.Charset.UTF_8);
  const version = publishToGitHub(encoded);

  ui.alert(
    '✅ 匯出完成',
    `已自動發布到 GitHub（版本 ${version}），Vercel 會自動部署。\n\n` +
    `匯出內容：\n` +
    `・信用卡 ${cards.length} 張\n` +
    `・行動支付 ${payments.length} 個、快捷選項 ${quickSearchOptions.length} 個\n` +
    `・商家付款資訊 ${Object.keys(merchantPayments).length} 個、FAQ ${faqList.length} 則、公告 ${announcements.length} 則\n` +
    `・推薦連結 ${referralLinks.length} 個、返利站點 Shopback ${cashbackSites.shopback.length} / LINE購物 ${cashbackSites.linebuy.length}\n` +
    `・新戶活動 ${newCardholderPromos.length} 筆、申辦 CTA ${Object.keys(cardApplyCtas).length} 張卡\n` +
    `・精選活動 ${spotlights.length} 筆`,
    ui.ButtonSet.OK
  );
}

// ==========================================
// 輔助函數
// ==========================================

function getValue(row, headers, fieldName) {
  const index = headers.indexOf(fieldName);
  return index >= 0 ? row[index] : null;
}

// ⭐ 依表頭自動偵測某前綴的最大槽位編號（如 rate_1..rate_22 → 22）。
//    匯出迴圈用它決定上限，之後在試算表加 rate_23 等新欄位不用改程式。
//    （2026-07 教訓：表已加到 rate_22，程式迴圈還寫死 <= 21，slot 22 整槽被靜默丟棄）
function maxSlotIndex(headers, prefix) {
  const re = new RegExp('^' + prefix + '_(\\d+)$');
  let max = 0;
  headers.forEach(function(h) {
    const m = String(h).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return max;
}

function addOptionalField(obj, row, headers, fieldName, type = 'string', targetName = null) {
  const value = getValue(row, headers, fieldName);
  const name = targetName || fieldName;

  if (value !== null && value !== '') {
    if (type === 'number') {
      obj[name] = parseFloat(value);
    } else if (type === 'boolean') {
      obj[name] = value === true || value === 'TRUE' || value === 'true';
    } else {
      obj[name] = value;
    }
  }
}

function formatDateToISO(dateValue) {
  if (!dateValue) return null;

  try {
    const date = new Date(dateValue);

    // 防呆：檢查是否為無效日期
    if (isNaN(date.getTime())) {
      // 額外處理：如果原本是字串且已經符合 YYYY-MM-DD，則直接回傳
      if (typeof dateValue === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        return dateValue;
      }
      return null;
    }

    // 使用 Google 內建工具：強制輸出 YYYY-MM-DD 並鎖定台北時區
    // "yyyy-MM-dd" 中的大寫 MM 代表補零的月份，dd 代表補零的日期
    return Utilities.formatDate(date, "Asia/Taipei", "yyyy-MM-dd");
  } catch (e) {
    Logger.log('日期轉換失敗: ' + dateValue);
    return null;
  }
}

// ⭐ 決定一筆活動的 periodStart / periodEnd。
//    資料流：維護者「輸入」periodStart_N / periodEnd_N（日期源頭），period_N 是由
//    它們「公式組出」的顯示字串。因此優先採用輸入欄；period 字串只在某一邊讀不到時
//    當救援來源。「讀不到」通常不是沒填——getValue 按欄位標題字串找欄，標題拼字／
//    空格／大小寫對不上、或欄名重複（indexOf 只抓最前面那欄）都會回空值，但儲存格
//    其實有資料、公式照樣組得出完整字串（2026-07 實例：periodStart_2 整欄讀不到，
//    23 張卡的第 2 槽全缺 periodStart，靠 period 字串救回）。這類結構問題另由
//    runQACheck 的欄位結構檢查在匯出時直接報警。
//    formatDateToISO 能吃 "2025/7/1" 斜線格式，解析失敗回 null 即不寫入該欄。
function resolvePeriodBounds(obj, periodStr, typedStart, typedEnd) {
  let startRaw = typedStart;
  let endRaw = typedEnd;
  if ((!startRaw || !endRaw) && periodStr && String(periodStr).indexOf('~') !== -1) {
    const parts = String(periodStr).split('~');
    if (!startRaw) startRaw = (parts[0] || '').trim();
    if (!endRaw) endRaw = (parts[1] || '').trim();
  }
  if (startRaw) {
    const iso = formatDateToISO(startRaw);
    if (iso) obj.periodStart = iso;
  }
  if (endRaw) {
    const iso = formatDateToISO(endRaw);
    if (iso) obj.periodEnd = iso;
  }
}

function clearQAReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const qaSheet = ss.getSheetByName('QA Check');

  if (qaSheet) {
    qaSheet.clear();
    SpreadsheetApp.getUi().alert('✅ 已清除 QA 報告');
  }
}

// ========== 读取停车优惠数据 ==========
function readCardBenefits() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Card Benefits');
  if (!sheet) {
    Logger.log('⚠️ 找不到 Card Benefits 表格');
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const benefits = [];

  // 从第三行开始读取（第一行是标题、第二行是個人備註）
  for (let i = 2; i < data.length; i++) {
    const row = data[i];

    // 跳过空行
    if (!row[0]) continue;

    const benefit = {};

    // 读取各栏位
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = row[j];

      if (value !== null && value !== undefined && value !== '') {
        // 处理 active 栏位（转换为 boolean）
        if (header === 'active') {
          benefit[header] = value === true || value === 'true' || value === 'TRUE';
        }
        // 处理 merchants 栏位（分割成数组）
        else if (header === 'merchants') {
          benefit[header] = String(value).split(',').map(m => m.trim());
        }
        // ✅ 正确 - 使用 formatDateToISO 函数
        else if (header === 'benefit_period') {
          benefit[header] = formatDateToISO(value);
        }

        // 其他栏位直接赋值
        else {
          benefit[header] = value;
        }
      }
    }

    // 只添加有效的数据
    if (benefit.id && benefit.benefit_type) {
      benefits.push(benefit);
    }
  }

  Logger.log(`✅ 读取 ${benefits.length} 笔停车优惠数据`);
  return benefits;
}

// ========== 讀取 New Cardholder Promos 資料 ==========
function readNewCardholderPromos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('New Cardholder Promos');

  if (!sheet) {
    Logger.log('⚠️ 找不到 New Cardholder Promos 工作表');
    return { newCardholderPromos: [], cardApplyCtas: {} };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const promos = [];
  const cardApplyCtas = {}; // ✨ 新增：用於存放卡片層級的 CTA

  // 從第二行開始讀取（第一行是標題）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 跳過空行
    if (!row[0]) continue;

    const active = getValue(row, headers, 'active');

    // 只輸出 active === true 的資料
    if (active !== true && active !== 'TRUE' && active !== 'true') {
      continue;
    }

    const id = String(getValue(row, headers, 'id') || '');
    const promo_id = String(getValue(row, headers, 'promo_id') || '');

    // ==========================================
    // ✨ 新增：處理 CTA 資料 (情境 A & B)
    // ==========================================
    const ctaTextRaw = getValue(row, headers, 'apply_cta_text');
    const ctaLinkRaw = getValue(row, headers, 'apply_cta_link');
    const ctaText = ctaTextRaw ? String(ctaTextRaw).trim() : '';
    const ctaLink = ctaLinkRaw ? String(ctaLinkRaw).trim() : '';

    if (ctaText || ctaLink) {
      if (!cardApplyCtas[id]) {
        // 第一筆直接寫入
        cardApplyCtas[id] = {
          text: ctaText,
          link: ctaLink
        };
      } else {
        // 如果已存在，檢查是否需要補齊空值或發出衝突警告
        const existing = cardApplyCtas[id];
        let hasConflict = false;

        if (ctaText) {
          if (!existing.text) existing.text = ctaText;
          else if (existing.text !== ctaText) hasConflict = true;
        }

        if (ctaLink) {
          if (!existing.link) existing.link = ctaLink;
          else if (existing.link !== ctaLink) hasConflict = true;
        }

        if (hasConflict) {
          Logger.log(`⚠️ 卡片 ${id} 有多個不同的 apply_cta_text 或 apply_cta_link，使用第一個。`);
        }
      }
    }

    // ==========================================
    // 處理新戶活動資料 (僅在有 promo_id 時處理 - 情境 A)
    // ==========================================
    if (promo_id) {
      const promo = {
        id: id,
        promo_id: promo_id,
        promo_name: String(getValue(row, headers, 'promo_name') || ''),
        new_customer_definition: getValue(row, headers, 'new_customer_definition') || '',
        new_customer_summary: getValue(row, headers, 'new_customer_summary') || ''
      };

      // 處理 promo_types (以逗號分割成陣列)
      const promoTypesStr = getValue(row, headers, 'promo_types');
      promo.promo_types = promoTypesStr
        ? String(promoTypesStr).split(',').map(s => s.trim()).filter(s => s.length > 0)
        : [];

      // 處理日期欄位 (維持 ISO 格式)
      const periodStart = getValue(row, headers, 'period_start');
      promo.period_start = periodStart ? formatDateToISO(periodStart) : null;

      const periodEnd = getValue(row, headers, 'period_end');
      promo.period_end = periodEnd ? formatDateToISO(periodEnd) : null;

      // 處理 priority (預設為 99)
      const priorityVal = getValue(row, headers, 'priority');
      promo.priority = (priorityVal !== null && priorityVal !== '') ? parseInt(priorityVal) : 99;

      // 處理 bonus_merchants (以逗號分割成陣列)
      const bonusMerchantsStr = getValue(row, headers, 'bonus_merchants');
      if (bonusMerchantsStr && String(bonusMerchantsStr).trim() !== '') {
        promo.bonus_merchants = String(bonusMerchantsStr).split(',').map(s => s.trim());
      }

      // 處理數字型別的選填欄位
      const bonusCap = getValue(row, headers, 'bonus_cap');
      if (bonusCap !== null && bonusCap !== '') promo.bonus_cap = parseFloat(bonusCap);

      const voucherAmount = getValue(row, headers, 'voucher_amount');
      if (voucherAmount !== null && voucherAmount !== '') promo.voucher_amount = parseFloat(voucherAmount);

      // 使用 addOptionalField 處理其他選填字串欄位
      addOptionalField(promo, row, headers, 'gift_content');
      addOptionalField(promo, row, headers, 'gift_image_url', 'string');
      addOptionalField(promo, row, headers, 'bonus_rate');
      addOptionalField(promo, row, headers, 'voucher_usage');
      addOptionalField(promo, row, headers, 'notes');
      addOptionalField(promo, row, headers, 'link');
      addOptionalField(promo, row, headers, 'promo_condition');

      promos.push(promo);
    }
  }

  Logger.log(`✅ 讀取 ${promos.length} 筆新戶活動資料，${Object.keys(cardApplyCtas).length} 張卡片申辦 CTA`);
  return { newCardholderPromos: promos, cardApplyCtas: cardApplyCtas }; // ✨ 回傳物件
}

// ========== 讀取 Announcements 資料 ==========
function getAnnouncements() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('announcements');

  if (!sheet) {
    Logger.log('⚠️ announcements sheet not found');
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const announcements = [];

  // Skip header row (index 0), start from row 1
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const text = getValue(row, headers, 'text');
    const fullText = getValue(row, headers, 'fullText');
    const link = getValue(row, headers, 'link');
    const active = getValue(row, headers, 'active');
    const priority = getValue(row, headers, 'priority');
    const date = getValue(row, headers, 'date');

    // Only include active announcements with text
    if (active === true && text && text.trim() !== '') {
      announcements.push({
        text: text.toString().trim(),
        fullText: fullText && fullText.toString().trim() !== ''
            ? fullText.toString().trim()
            : text.toString().trim(),
        link: link && link.toString().trim() !== '' ? link.toString().trim() : null,
        priority: typeof priority === 'number' ? priority : 999,
        date: date && date.toString().trim() !== '' ? date.toString().trim() : null
      });
    }
  }

  // ⭐ 新增：按 priority 排序（數字越小越前面）
  announcements.sort((a, b) => a.priority - b.priority);

  // 移除 priority 欄位（前端不需要）
  const sortedAnnouncements = announcements.map(({ priority, ...rest }) => rest);

  // 限制最多 5 則
  if (sortedAnnouncements.length > 5) {
    Logger.log('⚠️ 公告超過 5 則，只取前 5 則');
    return sortedAnnouncements.slice(0, 5);
  }

  Logger.log('✅ Loaded ' + announcements.length + ' announcements');
  return announcements;
}

function readReferralLinks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('ReferralLinks');

  if (!sheet) {
    Logger.log('⚠️ ReferralLinks 工作表不存在');
    return [];
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const referralLinks = [];

  // 從第二行開始讀取（跳過標題行）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 跳過空行
    if (!row[0]) continue;

    const merchant = getValue(row, headers, 'merchant');
    const url = getValue(row, headers, 'url');
    const description = getValue(row, headers, 'description');
    const active = getValue(row, headers, 'active');

    // 只匯出 active = TRUE 的項目
    if (active === true && merchant && url && description) {
      referralLinks.push({
        merchant: merchant,
        url: url,
        description: description,
        active: true
      });
    }
  }

  Logger.log('✅ 讀取 ' + referralLinks.length + ' 筆推薦連結資料');
  return referralLinks;
}

// ========== 讀取 Highlights 資料 ==========
function readHighlights() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Highlights');

  if (!sheet) {
    Logger.log('⚠️ 找不到 Highlights 工作表');
    return []; // 找不到工作表回傳空陣列
  }

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return []; // 只有標題列或全空

  const headers = data[0];
  const spotlights = [];

  // 輔助閉包函式：處理空值預設與型別轉換
  const getStr = (row, field) => {
    const val = getValue(row, headers, field);
    return val !== null && val !== undefined && val !== '' ? String(val).trim() : '';
  };

  const getNum = (row, field) => {
    const val = getValue(row, headers, field);
    const parsed = parseFloat(val);
    return isNaN(parsed) ? 0 : parsed;
  };

  const getBool = (row, field) => {
    const val = getValue(row, headers, field);
    return val === true || String(val).toUpperCase() === 'TRUE';
  };

  // 從第二行開始讀取（跳過標題）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 簡單防呆：如果 merchant 和 card_id 都沒填，視為無效空行跳過
    if (!getValue(row, headers, 'merchant') && !getValue(row, headers, 'card_id')) continue;

    // 處理日期格式 (確保輸出 YYYY/MM/DD)
    let deadlineStr = '';
    const rawDeadline = getValue(row, headers, 'deadline');
    if (rawDeadline) {
      const d = new Date(rawDeadline);
      if (!isNaN(d.getTime())) {
        // 強制轉換為指定格式與時區
        deadlineStr = Utilities.formatDate(d, "Asia/Taipei", "yyyy/MM/dd");
      } else {
        // 若為無法解析的字串則原樣保留
        deadlineStr = String(rawDeadline).trim();
      }
    }

    spotlights.push({
      merchant: getStr(row, 'merchant'),
      category: getStr(row, 'category'),
      rate: getNum(row, 'rate'),
      description: getStr(row, 'description'),
      card_name: getStr(row, 'card_name'),
      card_id: getStr(row, 'card_id'),
      cap: getStr(row, 'cap'),
      deadline: deadlineStr,
      order: getNum(row, 'order'),
      active: getBool(row, 'active') // active 為 false 也照常 push
    });
  }

  Logger.log(`✅ 讀取 ${spotlights.length} 筆 Highlights (spotlights) 資料`);
  return spotlights;
}

// ========== 讀取 Cashback Sites 資料 ==========
function readCashbackSites() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Cashback Sites');

  if (!sheet) {
    Logger.log('⚠️ Cashback Sites 工作表不存在');
    return { shopback: [], linebuy: [] };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const shopback = [];
  const linebuy = [];

  // 從第二行開始讀取（跳過標題行）
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    // 處理 Shopback 欄位
    const sbMerchant = getValue(row, headers, 'shopbackMerchants');
    const sbLink = getValue(row, headers, 'shopbackLink');
    if (sbMerchant && sbLink && sbMerchant.toString().trim() !== '' && sbLink.toString().trim() !== '') {
      shopback.push({
        merchant: sbMerchant.toString().trim(),
        link: sbLink.toString().trim()
      });
    }

    // 處理 LINE 購物 欄位
    const lbMerchant = getValue(row, headers, 'linebuyMerchants');
    const lbLink = getValue(row, headers, 'linebuyLink');
    if (lbMerchant && lbLink && lbMerchant.toString().trim() !== '' && lbLink.toString().trim() !== '') {
      linebuy.push({
        merchant: lbMerchant.toString().trim(),
        link: lbLink.toString().trim()
      });
    }
  }

  Logger.log(`✅ 讀取 Cashback Sites: Shopback ${shopback.length} 筆, LINE 購物 ${linebuy.length} 筆`);
  return { shopback, linebuy };
}

function generateSearchTerms(id, name) {
  const terms = [id.toLowerCase(), name.toLowerCase()];

  const aliases = {
    'linepay': ['line pay', 'linepay'],
    'jkopay': ['街口', '街口支付', 'jkopay'],
    'applepay': ['apple pay', 'applepay'],
    'allpay': ['全支付'],
    'easywallet': ['悠遊付', 'easy wallet', 'easywallet'],
    'googlepay': ['google pay', 'googlepay'],
    'esunwallet': ['玉山wallet', 'esun wallet'],
    'allplus': ['全盈+pay', '全盈支付', '全盈+'],
    'openwallet': ['open錢包', 'open wallet'],
    'piwallet': ['pi錢包', 'pi 拍錢包', 'pi wallet'],
    'icashpay': ['icash pay', 'icashpay'],
    'samsungpay': ['samsung pay', 'samsungpay'],
    'opay': ['歐付寶', '歐付寶行動支付', 'opay'],
    'ecpay': ['橘子支付', 'ecpay'],
    'paypal': ['paypal'],
    'twpay': ['台灣pay', 'taiwan pay', 'twpay', '台灣支付'],
    'skmpay': ['skm pay', 'skmpay'],
    'hamipay': ['hami pay', 'hamipay', 'hami pay掃碼付'],
    'cpcpay': ['中油pay', 'cpc pay'],
    'garminpay': ['garmin pay', 'garminpay']
  };

  if (aliases[id]) {
    return aliases[id];
  }

  return terms;

}

// ============ GitHub 自動發布 ============
// 在 exportToJSON() 產生 cards.data 內容（base64 字串）後呼叫：
//   publishToGitHub(encodedContent);
// 會把 cards.data 與 cards.version 一起 commit 到 repo。

const GITHUB_REPO = 'issabeloh/pick-my-card';
const GITHUB_BRANCH = 'main';

function publishToGitHub(cardsDataContent) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('請先在「專案設定 → 指令碼屬性」設定 GITHUB_TOKEN');

  const version = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');

  commitFileToGitHub('cards.data', cardsDataContent, `Update cards.data (${version})`, token);
  commitFileToGitHub('cards.version', version, `Update cards.version (${version})`, token);

  return version;
}

function commitFileToGitHub(path, textContent, message, token) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json'
  };

  // 取得現有檔案的 sha（更新既有檔案時 GitHub API 必須帶上）
  let sha = null;
  const getRes = UrlFetchApp.fetch(url + '?ref=' + GITHUB_BRANCH, {
    headers: headers,
    muteHttpExceptions: true
  });
  if (getRes.getResponseCode() === 200) {
    sha = JSON.parse(getRes.getContentText()).sha;
  }

  const body = {
    message: message,
    content: Utilities.base64Encode(textContent, Utilities.Charset.UTF_8),
    branch: GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  const putRes = UrlFetchApp.fetch(url, {
    method: 'put',
    headers: headers,
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  const code = putRes.getResponseCode();
  if (code !== 200 && code !== 201) {
    throw new Error(`GitHub 上傳 ${path} 失敗 (HTTP ${code}): ` + putRes.getContentText());
  }
}

// ============ 每月自動備份（.xlsx 寄信）============
// 目的：Google Sheet 是唯一存放「原始資料全貌」的地方——公式（period_N、
// daysRemaining_N）、欄位結構、Watchlist/QA 等其他工作表都只在這裡；
// cards.data 的 git 歷史只涵蓋「匯出內容」。每月把整本試算表以 .xlsx 附件
// 寄到信箱，補上「Google 帳號單點故障」這個備份缺口。
// 啟用方式：選單「⏰ 啟用每月自動備份」跑一次即可（重跑會先清掉舊觸發器，
// 不會重複寄）；「📦 立即寄送試算表備份」可隨時手動寄一份或測試。

const BACKUP_EMAIL = ''; // 留空 = 寄給試算表登入帳號（比照權益監控的慣例）

function sendBackupEmail() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dateStr = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');

  // 匯出整本試算表為 .xlsx（含所有工作表；公式大多可保留，Google 專屬函數會轉成值）
  const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx';
  const blob = UrlFetchApp.fetch(exportUrl, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  }).getBlob().setName(ss.getName() + '-備份-' + dateStr + '.xlsx');

  const to = BACKUP_EMAIL || Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: '📦 [pick-my-card] 試算表每月備份 ' + dateStr,
    body: '附件是「' + ss.getName() + '」的完整 .xlsx 備份（含所有工作表）。\n\n' +
          '建議下載後存放到 Google 以外的位置（本機或另一個雲端），' +
          '以防 Google 帳號無法存取時原始資料（公式、欄位結構、Watchlist 等）遺失。\n\n' +
          '試算表：' + ss.getUrl() + '\n' +
          '此信由 Apps Script 每月備份觸發器自動寄出。',
    attachments: [blob]
  });
  Logger.log('✅ 備份已寄出：' + to);
}

function setupMonthlyBackupTrigger() {
  // 先清掉同一 handler 的舊觸發器，重跑不會疊加
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendBackupEmail') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendBackupEmail')
    .timeBased()
    .onMonthDay(1)
    .atHour(9)
    .create();

  const to = BACKUP_EMAIL || Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  SpreadsheetApp.getUi().alert(
    '✅ 已啟用每月自動備份',
    '每月 1 日早上（9–10 點間）會把整本試算表以 .xlsx 附件寄到：\n' + to +
    '\n\n可用「📦 立即寄送試算表備份」先測試一封。',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
