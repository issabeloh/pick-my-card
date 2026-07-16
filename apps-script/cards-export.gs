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
    rateObj.slot = j;

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
    addOptionalField(rateObj, row, headers, `minSpend_${j}`, 'number', 'minSpend');
    addOptionalField(rateObj, row, headers, `maxSpend_${j}`, 'number', 'maxSpend');

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

  // 靜態生成新戶活動一覽頁（純函數，見下方「promos.html 靜態生成」一節），
  // 掛進同一次 GitHub commit（見 publishToGitHub）
  const promosPageHtml = generatePromosPageHtml({
    cards: cards,
    newCardholderPromos: newCardholderPromos,
    cardApplyCtas: cardApplyCtas
  });

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
  const version = publishToGitHub(encoded, promosPageHtml);

  ui.alert(
    '✅ 匯出完成',
    `已自動發布到 GitHub（版本 ${version}），Vercel 會自動部署。\n\n` +
    `匯出內容：\n` +
    `・信用卡 ${cards.length} 張\n` +
    `・行動支付 ${payments.length} 個、快捷選項 ${quickSearchOptions.length} 個\n` +
    `・商家付款資訊 ${Object.keys(merchantPayments).length} 個、FAQ ${faqList.length} 則、公告 ${announcements.length} 則\n` +
    `・推薦連結 ${referralLinks.length} 個、返利站點 Shopback ${cashbackSites.shopback.length} / LINE購物 ${cashbackSites.linebuy.length}\n` +
    `・新戶活動 ${newCardholderPromos.length} 筆、申辦 CTA ${Object.keys(cardApplyCtas).length} 張卡\n` +
    `・精選活動 ${spotlights.length} 筆\n` +
    `・promos.html 已同步更新（${newCardholderPromos.length} 筆活動中，未過期的已渲染進頁面）`,
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

// ==========================================
// promos.html 靜態生成（新戶活動一覽頁）
// ==========================================
// 純函數：吃「組好的匯出資料物件」（cards / newCardholderPromos / cardApplyCtas），
// 回傳完整 HTML 字串。內部不得呼叫任何 Sheets/Apps Script API（連 Utilities 也不用），
// 這樣同一份程式碼才能被 exportToJSON() 與 Node harness（repo 初版由
// scratchpad 的臨時 harness 呼叫本函數，餵現有 cards.json 產生）共用、行為保證一致。
// 詳見 docs/project/data-pipeline.md「promos.html 靜態生成」一節。

const PMC_SITE_URL = 'https://pickmycard.app';
const PMC_OG_IMAGE = 'https://pickmycard.app/assets/images/pickmycard-social-share.png?v=20260516';

const PMC_CHIP_DEFS = [
  { key: 'gift', label: '贈品／首刷禮' },
  { key: 'bonus', label: '回饋加碼' },
  { key: 'voucher', label: '定額抵用' }
];

function generatePromosPageHtml(exportData) {
  const cards = (exportData && exportData.cards) || [];
  const promos = (exportData && exportData.newCardholderPromos) || [];
  const cardApplyCtas = (exportData && exportData.cardApplyCtas) || {};

  const cardsById = {};
  cards.forEach(function (c) { if (c && c.id) cardsById[c.id] = c; });

  const todayIso = pmcTodayISO_();

  // 過濾已過期活動：period_end 存在且早於今天才濾掉；無 period_end（不限期）永遠保留
  const activePromos = promos.filter(function (p) {
    const endIso = pmcNormalizeDate_(p.period_end);
    if (!endIso) return true;
    return endIso >= todayIso;
  });

  // 預設排序：即將截止（period_end 升冪），無截止日排最後；同日期用 priority 當次序
  const sorted = activePromos.slice().sort(function (a, b) {
    const aEnd = pmcNormalizeDate_(a.period_end) || '9999-99-99';
    const bEnd = pmcNormalizeDate_(b.period_end) || '9999-99-99';
    if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
    return (typeof a.priority === 'number' ? a.priority : 99) - (typeof b.priority === 'number' ? b.priority : 99);
  });

  // 逐筆準備渲染所需的衍生欄位，卡片 HTML／JSON-LD／篩選 chips 共用同一份，避免算兩次分岔
  const prepared = sorted.map(function (promo, idx) {
    const card = cardsById[promo.id] || null;
    const cardName = card ? card.name : promo.id;
    const types = Array.isArray(promo.promo_types) ? promo.promo_types : [];
    const bucketList = types.map(pmcPromoTypeBucket_);
    const uniqueBuckets = bucketList.filter(function (b, i) { return bucketList.indexOf(b) === i; });
    const buckets = uniqueBuckets.length ? uniqueBuckets : ['default'];
    const primaryBucket = buckets.indexOf('bonus') !== -1 ? 'bonus' : buckets[0];
    const anchorId = 'promo-' + (idx + 1) + '-' + pmcSlug_(promo.promo_id || promo.id || 'x');
    const periodEndIso = pmcNormalizeDate_(promo.period_end);
    const periodStartIso = pmcNormalizeDate_(promo.period_start);
    const cta = cardApplyCtas[promo.id] || null;
    return { promo: promo, card: card, cardName: cardName, types: types, buckets: buckets,
      primaryBucket: primaryBucket, anchorId: anchorId, periodStartIso: periodStartIso,
      periodEndIso: periodEndIso, cta: cta, orderIndex: idx };
  });

  const bucketCounts = {};
  prepared.forEach(function (p) {
    p.buckets.forEach(function (b) { bucketCounts[b] = (bucketCounts[b] || 0) + 1; });
  });

  const cardsHtml = prepared.map(pmcRenderPromoCard_).join('\n');
  const filterChipsHtml = pmcBuildFilterChips_(prepared.length, bucketCounts);
  const jsonLd = pmcBuildJsonLd_(prepared);

  const generatedDisplay = pmcFormatDateDisplay_(todayIso);
  const yearMonthLabel = todayIso.slice(0, 4) + '年' + parseInt(todayIso.slice(5, 7), 10) + '月';
  const title = '信用卡新戶活動一覽（' + yearMonthLabel + '更新）｜首刷禮・新戶回饋懶人包 - Pick My Card';
  const seenNames = {};
  const sampleNameList = [];
  prepared.forEach(function (p) {
    if (p.cardName && !seenNames[p.cardName] && sampleNameList.length < 3) {
      seenNames[p.cardName] = true;
      sampleNameList.push(p.cardName);
    }
  });
  const sampleNames = sampleNameList.join('、');
  const description = prepared.length + ' 檔信用卡新戶活動一次看' + (sampleNames ? '，含' + sampleNames + '等' : '') +
    '首刷禮、新戶回饋加碼、定額回饋活動，依即將截止時間排序，持續更新。';
  // 版本含台北時間的時分：同一天多次匯出／改版也能破 promos.css/js 快取
  // （2026-07-16 教訓：純日期版本讓當天稍早的舊 CSS/JS 被瀏覽器快取住）。
  // 位元級重現驗證時用 exportData.versionTagOverride 固定值（見 data-pipeline.md 第 9 節）。
  const versionTag = (exportData && exportData.versionTagOverride) ||
    todayIso.replace(/-/g, '') + pmcTaipeiHm_();

  return pmcPageTemplate_({
    title: title,
    description: description,
    generatedDisplay: generatedDisplay,
    count: prepared.length,
    cardsHtml: cardsHtml,
    filterChipsHtml: filterChipsHtml,
    jsonLd: jsonLd,
    versionTag: versionTag
  });
}

// ---------- 日期／字串小工具（自成一套，不依賴 script.js 或任何外部服務）----------

// 回傳「今天」的台北時區 ISO 日期字串。用固定 +8 小時位移換算，Node 與 Apps Script
// 兩邊執行時不論系統時區為何都會得到一致結果（先轉 UTC，再加 8 小時）。
function pmcTodayISO_() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipei = new Date(utcMs + 8 * 3600000);
  const y = taipei.getUTCFullYear();
  const m = String(taipei.getUTCMonth() + 1).padStart(2, '0');
  const d = String(taipei.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

// 台北時間的時分（HHmm），供 versionTag 破同日快取用
function pmcTaipeiHm_() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const taipei = new Date(utcMs + 8 * 3600000);
  return String(taipei.getUTCHours()).padStart(2, '0') + String(taipei.getUTCMinutes()).padStart(2, '0');
}

// 容忍 ISO "2026-07-01" 與台式 "2026/7/1"（不一定補零）兩種格式（data-pipeline.md 第 8 節陷阱），
// 一律正規化成補零的 "YYYY-MM-DD"；解析失敗回 null。
function pmcNormalizeDate_(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.indexOf('-') !== -1) {
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (!m) return null;
    return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  }
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0], 10), mo = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
  if (!y || !mo || !d) return null;
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

// "YYYY-MM-DD" → 台灣慣用顯示 "YYYY/M/D"（去補零）
function pmcFormatDateDisplay_(iso) {
  if (!iso) return '';
  const parts = iso.split('-').map(Number);
  return parts[0] + '/' + parts[1] + '/' + parts[2];
}

function pmcSlug_(s) {
  const slug = String(s || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'x';
}

function pmcEscapeHtml_(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function pmcEscapeHtmlMultiline_(s) {
  return pmcEscapeHtml_(s).replace(/\r\n|\r|\n/g, '<br>');
}

// 外部連結防護：只允許 http/https 開頭，杜絕 javascript: 等危險 scheme（連結值來自
// Google Sheets 資料，多一層保險；語義同 script.js 的 sanitizeUrl）
function pmcSanitizeUrl_(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

// 活動類型字串 → 糖果色分類（語義同 script.js 的 promoTypeClass，並把資料裡實際出現、
// 未列在原枚舉的「定額點數」也正規化進 voucher 桶，行為更寬鬆但不影響原三桶）
function pmcPromoTypeBucket_(label) {
  const s = String(label || '');
  if (s.indexOf('贈') !== -1 || s === '首刷禮') return 'gift';
  if (s === '回饋加碼') return 'bonus';
  if (s.indexOf('定額') !== -1) return 'voucher';
  return 'default';
}

// ---------- 好康 hero（重點好康區）----------
// 依活動類型抽出「一眼看到」的重點：贈品內容／定額金額（＋用途）／加碼回饋率（＋上限）。
// 同一筆 promo 可能同時具備多種類型（如 cathay-cube 同時有 gift_content 與
// voucher_amount），因此回傳陣列讓卡片渲染時並列顯示，而不是只挑一種。
// 回傳的 quickHighlightPlain 是給手機收合態「一行重點好康」用的純文字版（無 HTML、
// 換行轉頓號），交由呼叫端自己 escape 後塞進單行 CSS ellipsis 容器。
function pmcBuildPromoHero_(promo) {
  const items = [];
  const quickParts = [];

  // 2026-07-15 站長回饋：hero 區塊移除 🎁💰⚡ 等 emoji 圖示，純文字＋既有配色
  // 區分即可（.promo-hero-item--gift/voucher/bonus 底色已經夠分得出類型）。
  if (promo.gift_content) {
    const raw = String(promo.gift_content);
    items.push({
      bucket: 'gift',
      bigHtml: pmcEscapeHtmlMultiline_(raw),
      bigModifier: 'promo-hero-big--gift'
    });
    quickParts.push(raw.replace(/\r\n|\r|\n/g, '、'));
  }

  if (typeof promo.voucher_amount === 'number' && !isNaN(promo.voucher_amount)) {
    const amountDisplay = promo.voucher_amount.toLocaleString('en-US');
    const usage = promo.voucher_usage ? String(promo.voucher_usage) : '';
    // voucher_amount 匯出時已 parseFloat 成純數字（見讀取端），不會有「NT$」「元」殘留，
    // 前綴固定加不會重複（2026-07-16 第六輪站長回饋：「500 刷卡金」→「NT$500 刷卡金」）
    items.push({
      bucket: 'voucher',
      bigHtml: pmcEscapeHtml_('NT$' + amountDisplay),
      smallHtml: usage ? pmcEscapeHtml_(usage) : ''
    });
    quickParts.push('NT$' + amountDisplay + (usage ? ' ' + usage : ''));
  }

  if (promo.bonus_rate !== undefined && promo.bonus_rate !== null && promo.bonus_rate !== '') {
    let rateDisplay;
    if (typeof promo.bonus_rate === 'number') {
      rateDisplay = (promo.bonus_rate <= 1 ? (promo.bonus_rate * 100) : promo.bonus_rate) + '%';
    } else {
      rateDisplay = String(promo.bonus_rate);
    }
    const capText = (typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap))
      ? '消費上限 NT$' + Math.round(promo.bonus_cap).toLocaleString('en-US')
      : '';
    items.push({
      bucket: 'bonus',
      bigHtml: '最高 ' + pmcEscapeHtml_(rateDisplay),
      smallHtml: capText ? pmcEscapeHtml_(capText) : ''
    });
    quickParts.push('最高' + rateDisplay + (capText ? '（' + capText + '）' : ''));
  }

  const heroItemsHtml = items.map(function (it) {
    return '<div class="promo-hero-item promo-hero-item--' + it.bucket + '">' +
      '<span class="promo-hero-main">' +
      '<span class="promo-hero-big' + (it.bigModifier ? ' ' + it.bigModifier : '') + '">' + it.bigHtml + '</span>' +
      (it.smallHtml ? '<span class="promo-hero-small">' + it.smallHtml + '</span>' : '') +
      '</span></div>';
  }).join('');

  return {
    heroItemsHtml: heroItemsHtml,
    hasHero: items.length > 0,
    quickHighlightPlain: quickParts.join('｜')
  };
}

// ---------- HTML 片段渲染 ----------

function pmcRenderPromoCard_(p) {
  const promo = p.promo;
  const cardId = promo.id || '';
  const cardName = p.cardName;

  const typeBadgesHtml = p.types.map(function (t) {
    const bucket = pmcPromoTypeBucket_(t);
    return '<span class="promo-type-badge promo-type-badge--' + bucket + '">' + pmcEscapeHtml_(t) + '</span>';
  }).join('');

  // 標題只留卡名：不再附加「新戶優惠」字樣（2026-07-15 站長回饋，卡名旁的
  // 「新戶優惠」文字被認為多餘——activity 類型已經由下方 promo-type-badges 表達）。
  const title = (promo.promo_name && String(promo.promo_name).trim())
    ? String(promo.promo_name).trim()
    : (cardName || '新戶優惠');

  const summary = promo.new_customer_summary || '';

  // 好康 hero：贈品內容／定額金額／加碼回饋率抽出來大字呈現（見 pmcBuildPromoHero_），
  // 下面 dl 列表不再重複這三種欄位，只留適用通路（hero 沒地方放的細節）。
  const hero = pmcBuildPromoHero_(promo);
  const heroSectionHtml = hero.hasHero ? '<div class="promo-hero">' + hero.heroItemsHtml + '</div>' : '';

  // 摘要行：優先顯示 new_customer_summary（活動摘要，一句話講清楚活動在幹嘛），
  // summary 空的極少數情況才退用 hero 的贈品/金額/回饋率純文字版（2026-07-15
  // 站長回饋：收合態原本顯示贈品內容，容易被誤讀成「活動只有這個」）。這一行是
  // 全頁唯一的摘要文字——桌機／手機收合態都看得到（見 promos.css .promo-quick-highlight
  // 已移除 display:none）；詳情展開區不再重複輸出第二份相同文字（2026-07-15
  // 第三輪站長回饋：原本展開後灰底 summary 區塊跟這行內容重複）。
  const collapsedSummaryPlain = summary || hero.quickHighlightPlain;
  const quickHighlightHtml = collapsedSummaryPlain
    ? '<p class="promo-quick-highlight">' + pmcEscapeHtml_(collapsedSummaryPlain) + '</p>'
    : '';
  // 摘要（有圖時圖左文右）一律在 toggle 之外的 .promo-highlight-row 輸出，
  // 見下方 highlightRowHtml 組裝處的說明。

  const highlightRows = [];
  if (Array.isArray(promo.bonus_merchants) && promo.bonus_merchants.length) {
    // 2026-07-16 第五輪站長回饋：適用通路可能很長（多個通路逗號分隔），超過 3 行
    // 高才收合＋加「展開 ▾」toggle（機制同備註，見 promos.js setupMerchantsClamp）。
    // clampClass 包一層 <span> 而不是直接 class 加在 <dd> 上——<dl> 內容模型只允許
    // dt/dd 當子元素，toggle 按鈕必須插在 <dd> 內部（span 之後）才合法，不能像備註
    // 那樣直接掛在量測目標的 afterend（那是 <div> 不是 <dd>，情境不同）。
    highlightRows.push({ label: '適用通路', value: promo.bonus_merchants.join('、'), clampClass: 'promo-merchants-value' });
  }
  const highlightHtml = highlightRows.map(function (r) {
    const val = r.multiline ? pmcEscapeHtmlMultiline_(r.value) : pmcEscapeHtml_(r.value);
    const inner = r.clampClass ? '<span class="' + r.clampClass + '">' + val + '</span>' : val;
    return '<div class="promo-meta-row"><dt>' + pmcEscapeHtml_(r.label) + '</dt><dd>' + inner + '</dd></div>';
  }).join('');

  // 活動宣傳圖：可能空、也可能是資料誤填的非網址字串（如 "picture link"），
  // 一律走 pmcSanitizeUrl_ 過濾，無效值直接不輸出縮圖（不留空位）。改成小縮圖
  // （約 80px、圓角、cover）＋點擊開 lightbox 看原圖（promos.js 監聽
  // .promo-gift-thumb 點擊）。縮圖獨立放在可收合的 .promo-card-toggle 之外，
  // 手機收合態、桌機都看得到——不像舊版大圖藏在收合的 detail 區塊裡
  // （2026-07-15 站長回饋：活動宣傳圖沒顯示在頁面上）。維持在 toggle 之外還有
  // 第二個理由：promos.js 的 click 監聽都掛在 document 上，同一層兩個監聽器
  // 彼此的 stopPropagation 攔不住對方（不是真正的冒泡攔截），若把縮圖塞進
  // .promo-card-toggle 內，點縮圖會連帶觸發卡片展開/收合。
  const giftImgUrl = pmcSanitizeUrl_(promo.gift_image_url);
  const giftImgAlt = title + ' 活動宣傳圖';
  const giftThumbHtml = giftImgUrl
    ? '<div class="promo-gift-thumb-row"><button type="button" class="promo-gift-thumb" data-full-src="' +
      pmcEscapeHtml_(giftImgUrl) + '" data-full-alt="' + pmcEscapeHtml_(giftImgAlt) +
      '" aria-label="放大看' + pmcEscapeHtml_(giftImgAlt) + '"><img src="' + pmcEscapeHtml_(giftImgUrl) +
      '" alt="' + pmcEscapeHtml_(giftImgAlt) + '" loading="lazy" onerror="this.closest(\'.promo-gift-thumb-row\').style.display=\'none\'"></button></div>'
    : '';

  // 摘要一律放 toggle 之外的 .promo-highlight-row（2026-07-16 第六輪站長回饋：
  // 有圖與無圖卡的 summary 起始位置要一致——舊做法無圖時塞在 toggle 內、有圖時
  // 在 toggle 外的 highlight-row，兩者 top 不同）。無圖時 row 內只有文字；
  // 圖與摘要皆無時不產生空容器。
  const highlightRowHtml = (giftThumbHtml || quickHighlightHtml)
    ? '<div class="promo-highlight-row">' + giftThumbHtml + quickHighlightHtml + '</div>'
    : '';

  // 新戶定義：直接顯示全文（2026-07-15 站長回饋移除收合，這是判斷自己是不是
  // 新戶的關鍵資訊，不該藏在一個要點開的 details 裡）
  const definitionHtml = promo.new_customer_definition
    ? '<div class="promo-meta-row promo-definition-row"><dt>新戶定義</dt><dd>' +
      pmcEscapeHtmlMultiline_(promo.new_customer_definition) + '</dd></div>'
    : '';

  const conditionHtml = promo.promo_condition
    ? '<div class="promo-meta-row"><dt>達成條件</dt><dd>' + pmcEscapeHtmlMultiline_(promo.promo_condition) + '</dd></div>'
    : '';

  let periodValueHtml;
  if (p.periodStartIso && p.periodEndIso) {
    periodValueHtml = '<time datetime="' + p.periodStartIso + '">' + pmcFormatDateDisplay_(p.periodStartIso) + '</time> ~ <time datetime="' + p.periodEndIso + '">' + pmcFormatDateDisplay_(p.periodEndIso) + '</time>';
  } else if (p.periodEndIso) {
    periodValueHtml = '至 <time datetime="' + p.periodEndIso + '">' + pmcFormatDateDisplay_(p.periodEndIso) + '</time> 止';
  } else if (p.periodStartIso) {
    periodValueHtml = '<time datetime="' + p.periodStartIso + '">' + pmcFormatDateDisplay_(p.periodStartIso) + '</time> 起';
  } else {
    periodValueHtml = '不限期';
  }
  const periodHtml = '<div class="promo-meta-row"><dt>活動期間</dt><dd>' + periodValueHtml + '</dd></div>';

  // 備註：一律完整輸出成純 div，收不收合交給 promos.js 客戶端量測——
  // scrollHeight 超過兩行高才套 clamp＋「展開 ▾」toggle，兩行內的備註完全不
  // 收合（2026-07-15 站長回饋：短備註不該無條件被收合藏起來）。不再用
  // <details>／<summary>：那套原生元件只能「一律收合」，沒辦法依內容長度
  // 決定要不要收合。標題樣式（見 promos.css .promo-notes-label）跟「活動期間」
  // 等 dt label 完全一樣，沿用同一視覺配方。
  const notesHtml = promo.notes
    ? '<div class="promo-notes" data-notes-block><div class="promo-notes-label">備註</div>' +
      '<div class="promo-notes-text">' + pmcEscapeHtmlMultiline_(promo.notes) + '</div></div>'
    : '';

  // CTA：cardApplyCtas 有分潤連結時當主按鈕「立即申辦」；沒有的話退用 promo.link
  // （銀行活動頁）當主按鈕，文字改「活動詳情」。
  // 「立即申辦」要在手機收合態就可點（分潤入口不能藏在展開後），所以按鈕仍放在
  // .promo-card-toggle 內、跟可收合的 promo-card-detail 分開。位置沿革：第四輪
  // 移到卡名右側（站長回饋位置尷尬），2026-07-16 第五輪再移到卡片右上角、跟類型
  // 徽章同一水平帶（見下方 topline 組裝）；promos.js 的收合展開點擊處理需忽略
  // 按鈕本身的點擊（見 promos.js setupCardToggle 的 .promo-apply-btn 排除判斷），
  // 避免點按鈕同時觸發卡片展開/收合。
  // 2026-07-15 站長回饋：移除「銀行活動頁」次要連結——有分潤連結時 promo.link
  // 不再另外顯示，避免使用者被導去銀行官網、繞過分潤申辦連結。
  const ctaLink = p.cta ? pmcSanitizeUrl_(p.cta.link) : '';
  const promoLink = pmcSanitizeUrl_(promo.link);
  let primaryCtaHtml = '';
  if (ctaLink) {
    primaryCtaHtml = '<a class="promo-apply-btn" href="' + pmcEscapeHtml_(ctaLink) + '" target="_blank" rel="noopener noreferrer sponsored" data-ga-track="1" data-card-id="' + pmcEscapeHtml_(cardId) + '" data-card-name="' + pmcEscapeHtml_(cardName) + '">立即申辦</a>';
  } else if (promoLink) {
    primaryCtaHtml = '<a class="promo-apply-btn" href="' + pmcEscapeHtml_(promoLink) + '" target="_blank" rel="noopener noreferrer" data-card-id="' + pmcEscapeHtml_(cardId) + '">活動詳情</a>';
  }

  const imgSrc = 'assets/images/cards/' + encodeURIComponent(cardId) + '.png';
  const detailId = p.anchorId + '-detail';

  return '<article class="promo-card" id="' + pmcEscapeHtml_(p.anchorId) + '" data-card-id="' + pmcEscapeHtml_(cardId) +
    '" data-card-name="' + pmcEscapeHtml_(cardName) + '" data-period-end="' + (p.periodEndIso || '') +
    '" data-order-index="' + p.orderIndex + '" data-type-buckets="' + pmcEscapeHtml_(p.buckets.join(' ')) + '">\n' +
    '  <div class="promo-type-bar promo-type-bar--' + p.primaryBucket + '"></div>\n' +
    '  <div class="promo-card-body">\n' +
    // role="button" 而非真的 <button>：裡面包 <h2> 標題，<button> 的內容模型是
    // phrasing content 不允許 heading 後代（HTML5 規範），用 div+role=button 才合法；
    // 鍵盤可及性（Enter/Space 觸發）與 aria-expanded 同步由 promos.js 補上。
    '    <div class="promo-card-toggle" role="button" tabindex="0" aria-expanded="false" aria-controls="' + pmcEscapeHtml_(detailId) + '">\n' +
    '      <div class="promo-card-header">\n' +
    // 「立即申辦」再移到卡片右上角（2026-07-16 第五輪站長回饋：卡名右側的位置很
    // 尷尬）——跟類型徽章同一水平帶（.promo-card-topline），靠右。這一整列在
    // .promo-card-mainline（卡圖＋卡名＋chevron）之上，跟 chevron 完全不同一列，
    // 天生不會重疊（chevron 只在 mainline 內垂直置中，topline 在它上方另起一行）；
    // primaryCtaHtml 可能是空字串（沒有任何連結可用時），topline 此時只剩徽章，
    // justify-content:space-between 對單一子元素無副作用。
    '        <div class="promo-card-topline">\n' +
    '          <div class="promo-type-badges">' + typeBadgesHtml + '<span class="promo-ending-badge" hidden></span></div>\n' +
    primaryCtaHtml + '\n' +
    '        </div>\n' +
    '        <div class="promo-card-mainline">\n' +
    '          <img class="promo-card-cardimg" src="' + imgSrc + '" alt="' + pmcEscapeHtml_(cardName) + '" loading="lazy" onerror="this.style.display=\'none\'">\n' +
    // 卡名只出現一次：title 已含卡名（promo_name 自訂時假設含卡名／預設 fallback
    // 就是 cardName 本身，2026-07-15 第三輪站長回饋起不再附加「新戶優惠」字樣），
    // 不再另外重複一行 .promo-card-cardname（2026-07-15 第二輪站長回饋：「滙豐
    // Live+ 卡 新戶優惠」標題下又重複一行「滙豐 Live+ 卡」）。
    '          <div class="promo-card-headline">\n' +
    '            <h2 class="promo-card-title">' + pmcEscapeHtml_(title) + '</h2>\n' +
    // ⓘ 卡片詳情（2026-07-16 站長要求）：連去主站的卡片詳情深連結
    // （?card= 由 script.js 開 modal；?start 繞過 landing 首訪轉址）。
    '            <a class="promo-card-info-btn" href="' + pmcEscapeHtml_('/?start&card=' + cardId) + '" target="_blank" rel="noopener noreferrer" aria-label="查看卡片詳情" title="查看卡片詳情">&#9432;</a>\n' +
    '          </div>\n' +
    '          <span class="promo-card-chevron" aria-hidden="true"></span>\n' +
    '        </div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    highlightRowHtml +
    '    <div class="promo-card-detail" id="' + pmcEscapeHtml_(detailId) + '">\n' +
    '      <div class="promo-card-detail-inner">\n' +
    heroSectionHtml +
    // summary 已經在 quickHighlightHtml（.promo-quick-highlight，展開前就看得到
    // 那一行）輸出過一次，這裡不再重複——2026-07-15 第三輪站長回饋：收合態一行
    // ＋展開後灰底 summary 區塊是同一段文字重複兩次。
    '        <dl class="promo-card-meta">\n' +
    definitionHtml + conditionHtml + periodHtml + highlightHtml + '\n' +
    '        </dl>\n' +
    notesHtml +
    '      </div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '</article>';
}

// 數量括號用半形 (n)，不用全形（） ——2026-07-15 站長回饋：全形括號跟其餘半形
// 內文混排不一致，改半形比較乾淨。
function pmcBuildFilterChips_(total, bucketCounts) {
  const chips = ['<button type="button" class="promo-chip is-active" data-filter="all">全部 (' + total + ')</button>'];
  PMC_CHIP_DEFS.forEach(function (c) {
    const n = bucketCounts[c.key] || 0;
    if (n > 0) {
      chips.push('<button type="button" class="promo-chip" data-filter="' + c.key + '">' + pmcEscapeHtml_(c.label) + ' (' + n + ')</button>');
    }
  });
  return chips.join('\n');
}

function pmcBuildJsonLd_(prepared) {
  const items = prepared.map(function (p, idx) {
    return {
      '@type': 'ListItem',
      position: idx + 1,
      // 與卡片標題（pmcRenderPromoCard_ 的 title）同一套 fallback 邏輯，一律只留卡名
      name: (p.promo.promo_name && String(p.promo.promo_name).trim()) ? String(p.promo.promo_name).trim() : (p.cardName || '新戶優惠'),
      url: PMC_SITE_URL + '/promos#' + p.anchorId
    };
  });
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: '信用卡新戶活動一覽',
    itemListElement: items
  };
  // 防止任何欄位含 "</script>" 提前關閉內嵌的 <script> 標籤
  return JSON.stringify(ld, null, 2).replace(/<\//g, '<\\/');
}

function pmcPageTemplate_(o) {
  return '<!DOCTYPE html>\n' +
'<html lang="zh-Hant">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'<title>' + pmcEscapeHtml_(o.title) + '</title>\n' +
'\n' +
'<meta name="description" content="' + pmcEscapeHtml_(o.description) + '">\n' +
'<link rel="canonical" href="' + PMC_SITE_URL + '/promos">\n' +
'\n' +
'<meta property="og:type" content="website">\n' +
'<meta property="og:url" content="' + PMC_SITE_URL + '/promos">\n' +
'<meta property="og:title" content="' + pmcEscapeHtml_(o.title) + '">\n' +
'<meta property="og:description" content="' + pmcEscapeHtml_(o.description) + '">\n' +
'<meta property="og:image" content="' + PMC_OG_IMAGE + '">\n' +
'<meta property="og:locale" content="zh_TW">\n' +
'<meta property="og:site_name" content="信用卡回饋大師">\n' +
'\n' +
'<meta name="twitter:card" content="summary_large_image">\n' +
'<meta name="twitter:url" content="' + PMC_SITE_URL + '/promos">\n' +
'<meta name="twitter:title" content="' + pmcEscapeHtml_(o.title) + '">\n' +
'<meta name="twitter:description" content="' + pmcEscapeHtml_(o.description) + '">\n' +
'<meta name="twitter:image" content="' + PMC_OG_IMAGE + '">\n' +
'\n' +
'<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700;800&display=swap" rel="stylesheet">\n' +
'\n' +
'<link rel="stylesheet" href="promos.css?v=' + o.versionTag + '">\n' +
'\n' +
'<link rel="apple-touch-icon" href="assets/images/icon-pickmycard.png">\n' +
'<link rel="icon" type="image/png" href="assets/images/icon-pickmycard.png">\n' +
'\n' +
'<script type="application/ld+json">\n' + o.jsonLd + '\n</script>\n' +
'</head>\n' +
'<body>\n' +
'<div class="promos-container">\n' +
// Header：與主站左上角一致（同款 logo＋站名＋深藍 header bar），複製自 index.html
// 的 header/.header-top/.header-content 結構——主站改動 header 時這裡要手動同步。
// 站名刻意用 <span> 而非 <h1>：這頁真正的 SEO H1 是下面 hero 區塊的
// 「信用卡新戶活動一覽」，同頁兩個 h1 對文件結構不利。
'<header class="promos-header">\n' +
'  <div class="promos-header-top">\n' +
'    <div class="promos-header-content">\n' +
'      <img src="assets/images/logo-header.png?v=' + o.versionTag + '" alt="" class="promos-header-logo">\n' +
'      <span class="promos-header-title">信用卡回饋大師</span>\n' +
'    </div>\n' +
'    <nav class="promos-header-links" aria-label="站內導覽">\n' +
'      <a href="/">回主站工具</a>\n' +
'    </nav>\n' +
'  </div>\n' +
'</header>\n' +
'\n' +
'<main class="promos-main">\n' +
'  <section class="promos-hero">\n' +
'    <h1>信用卡新戶活動一覽</h1>\n' +
'  </section>\n' +
'\n' +
// 「類型」「排序」低調組前綴 label：2026-07-15 站長回饋，兩排 chips 光看外觀
// 分不出是「篩選活動類型」跟「排序方式」兩組不同的操作。id 仍留在
// .promos-filter-chips / .promos-sort-toggle 本體（promos.js 用 getElementById
// 抓這兩個 id，querySelectorAll('.promo-chip'/'.promo-sort-btn') 只會選到按鈕，
// 不受外層新增的 label/wrapper 影響）。
'  <section class="promos-controls" aria-label="篩選與排序">\n' +
'    <div class="promos-control-group">\n' +
'      <span class="promos-control-label">類型</span>\n' +
'      <div class="promos-filter-chips" role="group" aria-label="活動類型篩選" id="promos-filter-chips">\n' +
o.filterChipsHtml + '\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="promos-control-group">\n' +
'      <span class="promos-control-label">排序</span>\n' +
'      <div class="promos-sort-toggle" role="group" aria-label="排序方式" id="promos-sort-toggle">\n' +
'        <button type="button" class="promo-sort-btn is-active" data-sort="deadline">按截止日期排序</button>\n' +
'        <button type="button" class="promo-sort-btn" data-sort="card">按卡片名稱排序</button>\n' +
'      </div>\n' +
'    </div>\n' +
    // 「隱藏我持有的卡片」篩選（2026-07-16 第四輪站長回饋）：讀主站
    // localStorage 的 myOwnedCards_*（見 promos.js），這裡靜態生成時完全不知道
    // 訪客/用戶持有哪些卡，所以一律先 hidden，交給 promos.js 在偵測到有持有資料
    // 時才拿掉 hidden（見 promos.js setupOwnedFilter）——沒有任何持有資料時，
    // 這組控制項整個不出現。
'    <div class="promos-control-group" id="promos-owned-filter-group" hidden>\n' +
'      <span class="promos-control-label">篩選</span>\n' +
'      <label class="promos-owned-filter-label">\n' +
'        <input type="checkbox" id="promos-hide-owned-checkbox">\n' +
'        隱藏我持有的卡片\n' +
'      </label>\n' +
// 「?」浮出說明（2026-07-16 站長回饋）：絕對定位浮層，不推開版面；
// 文案中的張數由 promos.js 依實際比對結果填入 #promos-owned-help-count。
'      <span class="promos-owned-help-wrap">\n' +
'        <button type="button" class="promos-owned-help-btn" id="promos-owned-help-btn" aria-expanded="false" aria-controls="promos-owned-help-pop" aria-label="說明">?</button>\n' +
'        <span class="promos-owned-help-pop" id="promos-owned-help-pop" role="tooltip" hidden>您有「我的信用卡」的記錄，因此將幫你隱藏 <strong id="promos-owned-help-count">0</strong> 張信用卡的新戶活動</span>\n' +
'      </span>\n' +
'    </div>\n' +
'  </section>\n' +
'\n' +
'  <!-- PROMOS:START -->\n' +
'  <div class="promo-grid" id="promo-grid">\n' +
o.cardsHtml + '\n' +
'  </div>\n' +
'  <!-- PROMOS:END -->\n' +
'\n' +
'  <p class="promos-empty-state" id="promos-empty-state" hidden>目前沒有符合條件的活動，換個篩選試試？</p>\n' +
'</main>\n' +
'</div>\n' +
'\n' +
// Footer：移除「用回饋計算機比比看」按鈕，改放主站的 footer（信用卡警語橫條＋
// 社群媒體/贊助區塊），複製自 index.html 的 .finance-warning-row／
// .social-media-footer——主站改動這兩塊時，這裡要手動同步（同一句提醒也寫進了
// docs/project/data-pipeline.md 第 9 節）。
'<div class="promos-warning-row" role="note" aria-label="信用卡警語">謹慎理財、信用至上</div>\n' +
'\n' +
'<div class="social-media-footer">\n' +
'  <div class="social-media-container">\n' +
'    <div class="explore-section">\n' +
'      <p class="social-media-title">探索更多</p>\n' +
'      <div class="social-media-links">\n' +
'        <a href="/faq" class="social-link faq" aria-label="常見問題">\n' +
'          <span class="social-text">常見問題 FAQ ↗</span>\n' +
'        </a>\n' +
'        <a href="/landing" class="social-link about" aria-label="認識 Pick My Card">\n' +
'          <span class="social-text">Pick My Card 是什麼？↗</span>\n' +
'        </a>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="social-section">\n' +
'      <p class="social-media-title">追蹤我們</p>\n' +
'      <div class="social-media-links">\n' +
'        <a href="https://www.threads.com/@pickmycard_tw" target="_blank" rel="noopener noreferrer" class="social-link threads" aria-label="Threads">\n' +
'          <svg width="24" height="24" fill="currentColor" viewBox="0 0 24 24"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.78 3.631 2.695 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.214.094.318.143 1.46.685 2.527 1.724 3.087 3.005.78 1.787.852 4.7-1.523 7.082-1.815 1.78-4.019 2.582-7.227 2.605zm1.063-11.046l-.379.012c-1.085.06-2.97.42-2.928 2.105.022.39.196.825.535 1.05.452.293 1.067.41 1.806.359 1.118-.063 1.94-.45 2.512-1.171.421-.527.668-1.21.737-2.034a11.405 11.405 0 0 0-2.283-.32z"/></svg>\n' +
'          <span class="social-text">@pickmycard_tw</span>\n' +
'        </a>\n' +
'      </div>\n' +
'    </div>\n' +
'    <div class="sponsor-section">\n' +
'      <p class="social-media-title">支持我們</p>\n' +
'      <div class="social-media-links">\n' +
'        <a href="https://portaly.cc/pickmycard/support" target="_blank" rel="noopener noreferrer" class="social-link sponsor" aria-label="贊助支持">\n' +
'          <svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16"><path d="m8 2.748-.717-.737C5.6.281 2.514.878 1.4 3.053c-.523 1.023-.641 2.5.314 4.385.92 1.815 2.834 3.989 6.286 6.357 3.452-2.368 5.365-4.542 6.286-6.357.955-1.885.838-3.362.314-4.385C13.486.878 10.4.28 8.717 2.01L8 2.748zM8 15C-7.333 4.868 3.279-3.04 7.824 1.143c.06.055.119.112.176.171a3.12 3.12 0 0 1 .176-.17C12.72-3.042 23.333 4.867 8 15z"/></svg>\n' +
'          <span class="social-text">小額抖內</span>\n' +
'        </a>\n' +
'      </div>\n' +
'    </div>\n' +
'  </div>\n' +
'</div>\n' +
'\n' +
'<div class="promos-data-update-footer">資料更新於 ' + pmcEscapeHtml_(o.generatedDisplay) + '</div>\n' +
'\n' +
'<script type="module" async>\n' +
'  // 精簡版 Firebase Analytics 初始化（只取 app+analytics，不含 auth/firestore/storage，\n' +
'  // 這頁不需要登入或存取用戶資料）；供 promos.js 送 button_click 事件。\n' +
'  import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";\n' +
'  import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-analytics.js";\n' +
'  const firebaseConfig = {\n' +
'    apiKey: "AIzaSyCERYFst64lYgR07OnEk-aJPbg838R7nYA",\n' +
'    authDomain: "pick-my-card-28f2a.firebaseapp.com",\n' +
'    projectId: "pick-my-card-28f2a",\n' +
'    storageBucket: "pick-my-card-28f2a.firebasestorage.app",\n' +
'    messagingSenderId: "181128376981",\n' +
'    appId: "1:181128376981:web:f9084ecdf6dddaf82e619c",\n' +
'    measurementId: "G-RW8F159L52"\n' +
'  };\n' +
'  const app = initializeApp(firebaseConfig);\n' +
'  window.firebaseAnalytics = getAnalytics(app);\n' +
'  window.logEvent = logEvent;\n' +
'</script>\n' +
'<script src="promos.js?v=' + o.versionTag + '"></script>\n' +
'</body>\n' +
'</html>\n';
}

// ============ GitHub 自動發布 ============
// 在 exportToJSON() 產生 cards.data 內容（base64 字串）後呼叫：
//   publishToGitHub(encodedContent);
// 會把 cards.data 與 cards.version 一起 commit 到 repo。

const GITHUB_REPO = 'issabeloh/pick-my-card';
const GITHUB_BRANCH = 'main';

function publishToGitHub(cardsDataContent, promosPageHtml) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('請先在「專案設定 → 指令碼屬性」設定 GITHUB_TOKEN');

  const version = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');

  commitFileToGitHub('cards.data', cardsDataContent, `Update cards.data (${version})`, token);
  commitFileToGitHub('cards.version', version, `Update cards.version (${version})`, token);
  if (promosPageHtml) {
    commitFileToGitHub('promos.html', promosPageHtml, `Update promos.html (${version})`, token);
  }

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
