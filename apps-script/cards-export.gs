// ==========================================
// PMC 管理系統 - Apps Script（新增 QuickSearch）
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
    .addItem('🔗 檢查 card_id 參照完整性', 'runReferentialIntegrityCheck')
    .addItem('🏷️ 檢查通路名稱一致性', 'runMerchantNamingCheck')
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

    // 檢查 6: rate 必須有 items——匯出迴圈的 guard 要求 items 才收槽，rate 有值但
    // items 空 ＝ 整槽靜默消失。上限依表頭自動偵測（原本寫死 1–5，槽 6+ 完全沒查）；
    // 槽 1–5 維持 ❌ 擋匯出（沿用既有行為），槽 6 起用 ⚠️ 只警告不擋，避免舊資料突然擋死匯出
    for (let j = 1; j <= maxSlotIndex(headers, 'rate'); j++) {
      const rateCol = headers.indexOf(`rate_${j}`);
      const itemsCol = headers.indexOf(`items_${j}`);

      if (rateCol >= 0 && itemsCol >= 0) {
        const rate = row[rateCol];
        const items = row[itemsCol];

        if (rate && !items) {
          issues.push([cardId, cardName, '資料不完整', `rate_${j}`, `有設定 rate_${j} 但沒有 items_${j}（此槽不會匯出）`, j <= 5 ? '❌' : '⚠️']);
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

  // 檢查 10: 「變動紀錄」的 id 對不到 Cards Data（2026-07-31 新增）
  // 對不到時該筆異動不會掛到任何卡片，前端「靜默」少一列、沒有錯誤訊息。
  // ⚠️ 一律 ⚠️ 不擋匯出：這張表是可撤下的展示用 log，不該讓一個打錯的 id 卡住整次發布。
  const changelogQaSheet = ss.getSheetByName('變動紀錄');
  if (changelogQaSheet) {
    const clData = changelogQaSheet.getDataRange().getValues();
    if (clData.length > 1) {
      const clIdCol = clData[0].map(h => String(h).trim()).indexOf('id');
      if (clIdCol < 0) {
        issues.push(['(變動紀錄)', '', '欄位結構', 'id', '「變動紀錄」第一列找不到 id 欄，整張表都不會匯出', '⚠️']);
      } else {
        const knownIds = {};
        idList.forEach(id => { knownIds[id] = true; });
        const badRows = {};
        for (let i = 1; i < clData.length; i++) {
          const cid = String(clData[i][clIdCol] || '').trim();
          if (!cid || knownIds[cid]) continue;
          if (!badRows[cid]) badRows[cid] = [];
          badRows[cid].push(i + 1);
        }
        Object.keys(badRows).forEach(cid => {
          issues.push(['(變動紀錄)', '', 'id 對不到卡片', 'id',
            `「變動紀錄」的 id「${cid}」不在 Cards Data（列 ${badRows[cid].join('、')}），該筆異動不會出現在任何卡片`, '⚠️']);
        });
      }
    }
  }

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
// ② 參照完整性檢查（card_id 對得到卡片）
// ------------------------------------------
// spotlights.card_id / newCardholderPromos.id / cardApplyCtas 的 key 都必須對得到
// cards[].id。對不到時前端「靜默」失敗——精選活動 ⓘ 退回手打文字、申辦按鈕不顯示，
// 不會有錯誤訊息。純函數：吃已解析好的記憶體物件、回傳問題字串陣列（空＝沒問題）。
// 於 exportToJSON 匯出前呼叫（發布前擋），也可獨立由 runReferentialIntegrityCheck 手動跑。
// ==========================================
function validateReferentialIntegrity_(cards, spotlights, newCardholderPromos, cardApplyCtas) {
  const idSet = {};
  (cards || []).forEach(function(c) { if (c && c.id) idSet[c.id] = true; });

  const problems = [];

  (spotlights || []).forEach(function(s, i) {
    if (!s) return;
    const who = s.merchant || s.card_name || ('第 ' + (i + 1) + ' 列');
    if (!s.card_id) {
      problems.push('精選活動（Highlights）「' + who + '」缺 card_id');
    } else if (!idSet[s.card_id]) {
      problems.push('精選活動（Highlights）「' + who + '」的 card_id「' + s.card_id + '」對不到任何卡片');
    }
  });

  (newCardholderPromos || []).forEach(function(p, i) {
    if (!p) return;
    // promo_id 移除後改用摘要當人看的識別（promo_name 實務上都是空的）
    const who = p.promo_name || String(p.new_customer_summary || '').slice(0, 20) || ('第 ' + (i + 1) + ' 列');
    if (!p.id) {
      problems.push('新戶活動「' + who + '」缺卡片 id');
    } else if (!idSet[p.id]) {
      problems.push('新戶活動「' + who + '」的卡片 id「' + p.id + '」對不到任何卡片');
    }
  });

  Object.keys(cardApplyCtas || {}).forEach(function(cid) {
    if (!idSet[cid]) {
      problems.push('申辦 CTA（cardApplyCtas）的卡片 id「' + cid + '」對不到任何卡片');
    }
  });

  return problems;
}

// 手動版：不做完整匯出，只跑參照完整性檢查並用對話框回報（給選單用）。
// 重用既有 reader，所以欄位版面改了也不會失準。
function runReferentialIntegrityCheck() {
  const ui = SpreadsheetApp.getUi();
  try {
    const cards = readCardsForValidation_();
    const promoData = readNewCardholderPromos();
    const spotlights = readHighlights();
    const problems = validateReferentialIntegrity_(
      cards, spotlights, promoData.newCardholderPromos, promoData.cardApplyCtas
    );
    if (problems.length === 0) {
      ui.alert('✅ 參照完整性檢查通過', '所有 card_id 都對得到卡片。', ui.ButtonSet.OK);
    } else {
      ui.alert('⚠️ 發現 ' + problems.length + ' 個參照問題',
        problems.slice(0, 25).join('\n') +
          (problems.length > 25 ? '\n…（其餘略）' : ''),
        ui.ButtonSet.OK);
    }
  } catch (e) {
    ui.alert('檢查失敗：' + e.message);
  }
}

// 只為驗證讀出 cards 的 id/name（不跑完整 exportToJSON）。
// 若專案已有可重用的「讀 Cards Data」函式，可改呼叫它取代這段。
function readCardsForValidation_() {
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Cards Data');
  if (!dataSheet) return [];
  const data = dataSheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('name');
  const cards = [];
  for (let i = 1; i < data.length; i++) {
    const id = idCol >= 0 ? data[i][idCol] : '';
    if (!id) continue;
    cards.push({ id: String(id), name: nameCol >= 0 ? data[i][nameCol] : '' });
  }
  return cards;
}

// ==========================================
// ⑥ 通路（商家）名稱一致性檢查
// ------------------------------------------
// 搜尋靠 item 名稱比對，同一通路寫法不一（全形/半形、大小寫、空格、常見別名）
// 會讓匹配分裂。做法：把所有來源的通路字串收齊 → 正規化成一把「鑰匙」→ 同一把
// 鑰匙底下若出現 2 種以上「原始寫法」，就是疑似同物異名，列進 QA Check 工作表。
// 這是「警告」不是「錯誤」：正規化後相同不代表一定是同一家（可能真的是兩家），
// 需人工判讀，所以不擋匯出，只產報告。
// ==========================================
function runMerchantNamingCheck() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const qaSheet = ss.getSheetByName('QA Check');
  const ui = SpreadsheetApp.getUi();
  if (!qaSheet) { ui.alert('找不到 QA Check 工作表！'); return; }

  // 收集所有通路字串 + 來源（能追回哪張卡/哪個活動）
  const occ = {};  // rawName -> Set(來源說明)
  const addName = function(raw, source) {
    if (raw === null || raw === undefined) return;
    const name = String(raw).trim();
    if (!name) return;
    if (!occ[name]) occ[name] = {};
    occ[name][source] = true;
  };

  // 來源 1：Cards Data 的 items_N（主來源，佔絕大多數）
  const dataSheet = ss.getSheetByName('Cards Data');
  if (dataSheet) {
    const data = dataSheet.getDataRange().getValues();
    const headers = data[0];
    const nameCol = headers.indexOf('name');
    for (let i = 1; i < data.length; i++) {
      const cardName = nameCol >= 0 ? data[i][nameCol] : '';
      if (!cardName) continue;
      for (let j = 1; j <= maxSlotIndex(headers, 'rate'); j++) {
        const itemsCol = headers.indexOf('items_' + j);
        if (itemsCol < 0) continue;
        splitMerchantCell_(data[i][itemsCol]).forEach(function(m) {
          addName(m, '卡片:' + cardName);
        });
      }
    }
  }
  // 來源 2：快捷搜尋（QuickSearch 的 merchants）與精選活動 merchant——跨來源不一致最常見
  try {
    (readHighlights() || []).forEach(function(s) { addName(s.merchant, '精選活動'); });
  } catch (e) {}

  // 依正規化鑰匙分群，找出「一鑰匙多寫法」
  const groups = {};  // key -> Set(rawName)
  Object.keys(occ).forEach(function(name) {
    const key = normalizeMerchantKey_(name);
    if (!key) return;
    if (!groups[key]) groups[key] = {};
    groups[key][name] = true;
  });

  const issues = [['正規化鑰匙', '疑似同物異名（原始寫法）', '出現來源']];
  Object.keys(groups).forEach(function(key) {
    const variants = Object.keys(groups[key]);
    if (variants.length < 2) return;  // 只有一種寫法＝沒問題
    const sources = {};
    variants.forEach(function(v) { Object.keys(occ[v] || {}).forEach(function(s) { sources[s] = true; }); });
    issues.push([key, variants.join('  ⇄  '), Object.keys(sources).slice(0, 6).join('、')]);
  });

  // 寫報告到 QA Check 工作表下方（不覆蓋既有 QA 報告，另起一區）
  const startRow = Math.max(qaSheet.getLastRow() + 2, 2);
  if (issues.length > 1) {
    qaSheet.getRange(startRow, 1).setValue('—— ⑥ 通路名稱一致性（疑似同物異名 ' + (issues.length - 1) + ' 組）——')
      .setFontWeight('bold');
    qaSheet.getRange(startRow + 1, 1, issues.length, 3).setValues(issues);
    qaSheet.getRange(startRow + 1, 1, 1, 3).setFontWeight('bold').setBackground('#fff4ce');
    ui.alert('⚠️ 通路名稱一致性',
      '找到 ' + (issues.length - 1) + ' 組疑似同物異名，已寫入 QA Check 工作表。\n' +
      '請人工判讀——正規化後相同不代表一定是同一家。',
      ui.ButtonSet.OK);
  } else {
    ui.alert('✅ 通路名稱一致性', '沒有發現疑似同物異名。', ui.ButtonSet.OK);
  }
}

// 拆一格 items（sheet 內可能用 、 , ，或換行分隔）
function splitMerchantCell_(cell) {
  if (cell === null || cell === undefined) return [];
  return String(cell).split(/[、,，\n]/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
}

// 正規化鑰匙：小寫 + 去空白 + 全形轉半形 + 去常見尾綴/符號。
// 目的是讓「玉山Wallet」「玉山 wallet」「玉山wallet電子支付」落到同一鑰匙以便攤在一起檢視。
// 尾綴清單刻意保守（只削明顯的通用後綴），寧可少歸併也不要把兩家不同的併成一家。
function normalizeMerchantKey_(name) {
  let s = String(name);
  // 全形英數轉半形
  s = s.replace(/[！-～]/g, function(ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); });
  s = s.toLowerCase();
  s = s.replace(/[\s　]/g, '');                 // 去所有空白（含全形空格）
  s = s.replace(/[()（）·・.,\-_/]/g, '');            // 去常見標點
  s = s.replace(/(電子支付|購物網|購物|股份有限公司|有限公司|公司|服務|系統|超市|超商|門市)$/g, '');
  return s;
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
  // 標題列的第 6 欄是「嚴重度」字樣、不是 ❌，filter 本來就不會數到它——
  // 不能再 -1（2026-07-20 審計發現：舊的 -1 讓「恰好只有 1 個 ❌」時照樣放行匯出）
  const criticalIssues = qaData.filter(row => row[5] === '❌').length;

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
    // bank＝發卡行顯示名稱（側欄「加入比較的卡片」膠囊左半、分組用）。
    // 沒有這一欄也不會壞：前端會退回用 id 前綴推導（js/home-ui.js
    // CARD_BANK_BY_ID_PREFIX），但要改顯示字樣或新增發卡行時，建 bank 欄最省事。
    addOptionalField(card, row, headers, 'bank');
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

    // cardUseCase（選填，2026-09-17 新增；2026-09-21 由 cardUsage 更名——usage 讀起來
    // 像「用量」，這個欄位講的是「這張卡適合什麼情境」）：一句話描述這張卡的性格，
    // 顯示在卡片詳情頁「基本資訊」最上方與 /promos 的卡片特色 modal。沒填就整行不出現。
    // ⚠️ 只寫性格、不寫數字——句子裡一旦出現「6%」，它就變成第二份會漂移的回饋率。
    addOptionalField(card, row, headers, 'cardUseCase');

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
    // 銀行官方登錄連結（2026-09-08 新增）：需登錄才算數的活動，其登錄頁網址。
    // 前端 renderRegisterLinkLine() 會過 sanitizeUrl()（只放行 http/https）再顯示成
    // 「銀行官方登錄連結」超連結。欄位不存在時 addOptionalField 直接跳過，舊表相容。
    addOptionalField(rateObj, row, headers, `registerLink_${j}`, 'string', 'registerLink');
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

// ========== 匯出搜尋排除規則（searchExclusions 工作表） ==========
// 前端 mergeDataSearchExclusions() 早就備好接收端，但匯出這一側一直漏掉，
// 導致工作表填了規則也不會生效（2026-08-04 修：「搜尋全家仍出現鞋全家福」）。
// 語義：搜尋詞（含 fuzzy 展開後的別名）＝term 時，item 名與 excludedItems 小寫全等者不匹配。
// 工作表分頁名稱大小寫兩種都收（現況是 searchExclusions）。
const searchExclusions = [];

const searchExclusionsSheet = ss.getSheetByName('searchExclusions') || ss.getSheetByName('SearchExclusions');
if (searchExclusionsSheet) {
  const exclusionData = searchExclusionsSheet.getDataRange().getValues();
  const exclusionHeaders = exclusionData[0];

  for (let i = 1; i < exclusionData.length; i++) {
    const row = exclusionData[i];
    const term = getValue(row, exclusionHeaders, 'term');
    const excludedItemsStr = getValue(row, exclusionHeaders, 'excludedItems');
    const active = getValue(row, exclusionHeaders, 'active');

    // 只匯出啟用的規則
    if (!term || !excludedItemsStr || (active !== true && active !== 'TRUE' && active !== 'true')) {
      continue;
    }

    // excludedItems 逗號分隔；item 名本身含逗號的情況目前沒有，有的話改用別的分隔符
    const excludedItems = String(excludedItemsStr).split(',').map(s => s.trim()).filter(s => s);
    if (excludedItems.length === 0) continue;

    searchExclusions.push({
      term: String(term).trim(),
      excludedItems: excludedItems
    });
  }

  Logger.log('搜尋排除規則載入成功：' + searchExclusions.length + ' 條');
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

  // 近期異動：掛在每張卡身上（不另開頂層 key），沒有異動的卡不塞空陣列——
  // 空陣列在 29 張卡上就是白白多出來的體積，前端判斷本來就要防 undefined
  const changelogByCard = readChangelog();
  let changelogCardCount = 0;
  cards.forEach(function (card) {
    const entries = changelogByCard[card.id];
    if (entries && entries.length) {
      card.changelog = entries;
      changelogCardCount++;
    }
  });

  // 🔒 參照完整性把關：spotlights.card_id／newCardholderPromos.id／cardApplyCtas 的
  //    key 都必須對得到 cards[].id。對不到時前端不會報錯，會「靜默」退回手打文字
  //    （精選活動 ⓘ）或不顯示申辦按鈕，上線後肉眼幾乎抓不到。匯出前擋一次，
  //    讓維護者決定是否仍要發布（見 validateReferentialIntegrity_）。
  const refProblems = validateReferentialIntegrity_(cards, spotlights, newCardholderPromos, cardApplyCtas);
  if (refProblems.length > 0) {
    const proceed = ui.alert(
      '⚠️ 發現 ' + refProblems.length + ' 個參照問題（card_id 對不到卡片）',
      refProblems.slice(0, 20).join('\n') +
        (refProblems.length > 20 ? '\n…（其餘 ' + (refProblems.length - 20) + ' 個略）' : '') +
        '\n\n這些引用會讓前端靜默退回手打文字或不顯示申辦按鈕。\n仍要繼續匯出嗎？',
      ui.ButtonSet.YES_NO
    );
    if (proceed !== ui.Button.YES) {
      ui.alert('已取消匯出。請修正上述 card_id 後再匯出一次。');
      return;
    }
  }

  // 新戶活動「更新日期」：只有 newCardholderPromos 內容真的變動時才蓋今天，否則沿用上次那天。
  // 上次的指紋＋日期存在 Script Properties（Apps Script 端持久化，不佔 repo 檔案、不多一個
  // commit、維護者流程零改動）。首次執行或指紋不符 → 蓋今天並寫回。這個 promosUpdatedIso 之後
  // 同時餵給：generatePromosPageHtml（可見戳章＋JSON-LD dateModified）與 sitemap 的 promos
  // lastmod，三處同源一致（見 data-pipeline.md 第 9 節）。
  // （2026-08-16 起共用 pmcStampedDate_，key 沿用 PROMOS_*，語義與存的屬性都不變）
  const promosUpdatedIso = pmcStampedDate_('PROMOS', pmcPromoSignature_(newCardholderPromos));

  // 首頁（/）的 sitemap lastmod：首頁內容整份由 cards.data 前端渲染（卡片數、精選活動、
  // 搜尋結果都是），所以「首頁變了沒」等同「匯出資料變了沒」。指紋刻意排除 jsonContent
  // 第一個欄位 lastUpdated——那是匯出當下的時間戳，每次匯出必變，含進來指紋就永遠不相等，
  // 等於退回「天天蓋今天」。其餘欄位與 jsonContent 同一份資料，順序不影響（stable stringify）。
  // 商家落地頁清單（MerchantPages 工作表）。只是「要生哪些頁、文案是什麼」，
  // 頁面本體由 Cloudflare Pages build 時的 tools/build-merchant-pages.js 生成。
  const merchantPages = readMerchantPages();

  // 側欄膠囊的銀行品牌色（BankColors 工作表）。前端只拿色碼，底色/文字色即時算。
  const bankColorTables = readBankColors();
  const bankColors = bankColorTables.colors;
  const bankAccentColors = bankColorTables.accents;

  const homeUpdatedIso = pmcStampedDate_('HOME', pmcHashString_(pmcStableStringify_({
    cards: cards,
    payments: payments,
    quickSearchOptions: quickSearchOptions,
    merchantPayments: merchantPayments,
    faq: faqList,
    announcements: announcements,
    searchHints: searchHints,
    searchExclusions: searchExclusions,
    benefits: benefits,
    referralLinks: referralLinks,
    cashbackSites: cashbackSites,
    newCardholderPromos: newCardholderPromos,
    cardApplyCtas: cardApplyCtas,
    spotlights: spotlights,
    merchantPages: merchantPages,
    bankColors: bankColors,
    bankAccentColors: bankAccentColors
  })));

  // 靜態生成新戶活動一覽頁（純函數，見下方「promos.html 靜態生成」一節），
  // 掛進同一次 GitHub commit（見 publishToGitHub）
  const promosPageHtml = generatePromosPageHtml({
    cards: cards,
    newCardholderPromos: newCardholderPromos,
    cardApplyCtas: cardApplyCtas,
    promosUpdatedIso: promosUpdatedIso
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
  searchExclusions: searchExclusions,
  benefits: benefits,
  referralLinks: referralLinks,
  cashbackSites: cashbackSites,
  newCardholderPromos: newCardholderPromos,
  cardApplyCtas: cardApplyCtas,
  spotlights: spotlights,
  merchantPages: merchantPages,
  bankColors: bankColors,
  bankAccentColors: bankAccentColors
  }, null, 2);


  // 🔒 Base64 編碼 → 直接發布到 GitHub（cards.data + cards.version），
  //    Cloudflare Pages 自動部署。不再產生 Drive 下載檔（2026-07-12 移除：下載區塊
  //    每次匯出都在 Drive 堆兩個永不清理的檔案；歷史版本備份由 GitHub
  //    的 commit 紀錄承擔，原始資料的備份由 Google Sheets 版本記錄承擔）。
  const encoded = Utilities.base64Encode(jsonContent, Utilities.Charset.UTF_8);
  const version = publishToGitHub(encoded, promosPageHtml, merchantPages, promosUpdatedIso, homeUpdatedIso);

  ui.alert(
    '✅ 匯出完成',
    `已自動發布到 GitHub（版本 ${version}），Cloudflare Pages 會自動部署。\n\n` +
    `匯出內容：\n` +
    `・信用卡 ${cards.length} 張\n` +
    `・行動支付 ${payments.length} 個、快捷選項 ${quickSearchOptions.length} 個\n` +
    `・商家付款資訊 ${Object.keys(merchantPayments).length} 個、FAQ ${faqList.length} 則、公告 ${announcements.length} 則\n` +
    `・搜尋排除規則 ${searchExclusions.length} 條\n` +
    `・推薦連結 ${referralLinks.length} 個、返利站點 Shopback ${cashbackSites.shopback.length} / LINE購物 ${cashbackSites.linebuy.length}\n` +
    `・新戶活動 ${newCardholderPromos.length} 筆、申辦 CTA ${Object.keys(cardApplyCtas).length} 張卡\n` +
    `・精選活動 ${spotlights.length} 筆、近期異動 ${changelogCardCount} 張卡有紀錄\n` +
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
      // 字串欄位一律去頭尾空白（含隱形的 \r/\n）——與 rate/cap/name/items 等
      // 已 trim 的欄位一致。cashbackModel 走這條，先前沒 trim，貼上帶 CRLF 的
      // 來源會讓儲存格夾帶隱形尾端 \r（如 "rate+overseasCashback\r"），
      // 前端用 includes()／=== 'rate' 比對時是顆潛在地雷。只 trim 真字串，
      // 數字/布林/日期型不動。
      obj[name] = (typeof value === 'string') ? value.trim() : value;
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

// 「New Cardholder Promos」的一列到底是不是一檔活動（取代 2026-08-15 前的 `if (promo_id)`）。
// 只要下列任一欄有值就算——這些都是「活動才會填」的欄位，只掛申辦 CTA 的列一格都不會有。
// ⚠️ 刻意不放 link / notes / priority / apply_cta_*：
//    前兩者情境 B 也可能順手填；後兩者不是活動的內容本身。
const PROMO_DEFINING_FIELDS = [
  'new_customer_summary', 'new_customer_definition', 'promo_types', 'promo_condition',
  'period_start', 'period_end', 'gift_content', 'bonus_rate', 'bonus_merchants',
  'bonus_cap', 'voucher_amount', 'voucher_usage'
];

function isPromoRow_(row, headers) {
  for (let i = 0; i < PROMO_DEFINING_FIELDS.length; i++) {
    const v = getValue(row, headers, PROMO_DEFINING_FIELDS[i]);
    if (v !== null && v !== undefined && String(v).trim() !== '') return true;
  }
  return false;
}

// 數字欄容錯：儲存格可能是數字，也可能是文字格式的 "3,280"、"NT$3,280"、"24吋"。
// 直接 parseFloat("3,280") 會得到 3，所以先把數字與小數點以外的字元拿掉。空白回 null。
function pmcParseNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

// 「New Cardholder Promos」的一列 → 一檔活動物件。readNewCardholderPromos() 與
// promo-picks-fill.gs 的 fillPickSuggestions() 共用，兩邊讀出來的活動才會一模一樣
// （2026-09-23 從 readNewCardholderPromos 抽出，內容未改，只多了下面的新欄位）。
function pmcRowToPromo_(row, headers, id) {
  const promo = {
    id: id,
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

  // 站長推薦／行李箱專區用的欄位（2026-09-23）：
  //   min_spend     拿到獎勵的最低消費門檻；多段門檻填第一段。**空白＝不限金額**（站長定義）
  //   luggage_inch  行李箱吋數（有填＝這檔的贈品含行李箱，進行李箱專區）
  //   luggage_value 參考價（官網公告價值或市售估價）
  //   pick_rank     1–5＝手動指定進「站長推薦」的位置；x＝不要自動選入；空白＝交給自動
  //   pick_question／pick_reason  手動情境問句／推薦理由；空白＝用自動產生的
  ['min_spend', 'luggage_inch', 'luggage_value'].forEach(function (k) {
    const n = pmcParseNumber_(getValue(row, headers, k));
    if (n !== null) promo[k] = n;
  });
  addOptionalField(promo, row, headers, 'pick_rank');
  addOptionalField(promo, row, headers, 'pick_question');
  addOptionalField(promo, row, headers, 'pick_reason');
  if (promo.pick_rank !== undefined) promo.pick_rank = String(promo.pick_rank).trim();
  return promo;
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
    // 處理新戶活動資料（情境 A：這一列是一檔活動）
    // ==========================================
    // 這張表一列有兩種可能：情境 A＝一檔新戶活動、情境 B＝只掛卡片層級的申辦 CTA
    // （上面那段已經處理掉了）。2026-08-15 之前是用「有沒有填 promo_id」來分辨，
    // 站長裁定那個欄位純粹是多餘的維護負擔（前端從來沒讀過它），已整組移除。
    //
    // 現在的判準：**只要有任何一個「活動才會有」的欄位有值，這列就是一檔活動**。
    // 為什麼不改成單一必填欄（如 period_start）：那會變成「漏填一格就整檔活動人間蒸發」，
    // 跟舊的 promo_id 是同一種陷阱。用 any 就不會靜默掉資料——情境 B 的列天生一格都不會有。
    if (isPromoRow_(row, headers)) {
      promos.push(pmcRowToPromo_(row, headers, id));
    }
  }

  Logger.log(`✅ 讀取 ${promos.length} 筆新戶活動資料，${Object.keys(cardApplyCtas).length} 張卡片申辦 CTA`);
  return { newCardholderPromos: promos, cardApplyCtas: cardApplyCtas }; // ✨ 回傳物件
}

// ========== 讀取「BankColors」資料（側欄膠囊的銀行品牌色，2026-09-08 新增） ==========
// 回傳 { 銀行字樣: '#RRGGBB' }。key 必須與 Cards Data 的 bank 欄**完全一致**
// （前端就是拿 bank 欄的字去查這張表），例如 bank 欄寫「玉山」，這裡就要寫「玉山」。
//
// 前端只拿這一支色碼，膠囊左半色塊的實際底色與文字色是前端即時算的
// （品牌色 50% 疊在膠囊底上；文字取黑或白，看哪個對比度高）——所以這裡**一行一家、
// 只填一支主色**就好，不用填底色與文字色。
//
// ⚠️ 工作表不存在時安全降級：回空物件、不丟例外。前端查不到色碼的銀行會退回中性灰底，
//    不會壞掉——所以可以先貼程式、之後再慢慢把 16 家補齊。
// ⚠️ 只收 #RRGGBB / #RGB；填錯格式的那一列會被跳過並留 log，不會把壞值送到前端。
function readBankColors() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('BankColors');
  if (!sheet) {
    Logger.log('ℹ️ 找不到「BankColors」工作表，本次不匯出銀行品牌色（膠囊會全部退回中性灰）');
    return { colors: {}, accents: {} };
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return { colors: {}, accents: {} };
  const headers = data[0].map(h => String(h).trim());
  if (headers.indexOf('bank') < 0 || headers.indexOf('color') < 0) {
    Logger.log('⚠️ 「BankColors」第一列找不到 bank 或 color 欄，整張表略過');
    return { colors: {}, accents: {} };
  }

  const out = {};
  const accents = {};
  let skipped = 0;
  for (let i = 1; i < data.length; i++) {
    const bank = String(getValue(data[i], headers, 'bank') || '').trim();
    if (!bank) continue;

    // active 留空視為啟用（跟「變動紀錄」同慣例：忘了打 TRUE 不該整批消失）
    const active = getValue(data[i], headers, 'active');
    if (active === false || String(active).trim().toUpperCase() === 'FALSE') continue;

    const color = String(getValue(data[i], headers, 'color') || '').trim();
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) {
      if (color) { skipped++; Logger.log(`⚠️ 「BankColors」列 ${i + 1}（${bank}）色碼格式不對：${color}`); }
      continue;
    }
    out[bank] = color;

    // accent（副色）＝膠囊左緣色帶的下半段，2026-09-09 新增。整欄是選填的：
    // 沒這一欄、或某家沒填 → 前端畫成上下同色的單色帶，不會壞掉。
    // ⚠️ 格式錯的 accent 只丟掉那一格，主色照常匯出——副色是加分項，不該把整家拖下水。
    const accent = String(getValue(data[i], headers, 'accent') || '').trim();
    if (accent) {
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) accents[bank] = accent;
      else { skipped++; Logger.log(`⚠️ 「BankColors」列 ${i + 1}（${bank}）副色格式不對：${accent}`); }
    }
  }

  Logger.log(`✅ 讀取銀行品牌色：${Object.keys(out).length} 家（其中 ${Object.keys(accents).length} 家有副色）${skipped ? `（${skipped} 格色碼格式錯誤已略過）` : ''}`);
  return { colors: out, accents: accents };
}

// ========== 讀取「變動紀錄」資料（詳情頁「近期異動」，2026-07-31 新增） ==========
// 資料是自動化檔的選單「發布變動紀錄」跨檔 append 進來的（見 apps-script/README.md）。
// 回傳 { card_id: [{ date, summary }, ...] }，每張卡最多 CHANGELOG_MAX_PER_CARD 筆、由新到舊。
//
// ⚠️ 工作表不存在時安全降級：回空物件、不丟例外——站長可能先貼程式、隔天才建表，
//    匯出不能因此整個倒掉。
// ⚠️ 表裡保留全部歷史（撤下用 active=FALSE，不用刪列）；「只顯示最新 5 筆」是在這裡
//    截的，不是在資料層刪的——之後想改成 10 筆或做完整異動史頁面時資料還在。
const CHANGELOG_MAX_PER_CARD = 5;

function readChangelog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('變動紀錄');
  if (!sheet) {
    Logger.log('ℹ️ 找不到「變動紀錄」工作表，本次不匯出 changelog（不影響其他資料）');
    return {};
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const headers = data[0].map(h => String(h).trim());
  if (headers.indexOf('id') < 0) {
    Logger.log('⚠️ 「變動紀錄」第一列找不到 id 欄，整張表略過');
    return {};
  }

  const byCard = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const id = String(getValue(row, headers, 'id') || '').trim();
    if (!id) continue;

    // active 留空視為啟用（跟其他表不同：這張表是 append-only 的 log，
    // 站長要撤下才填 FALSE，不該因為忘了打 TRUE 就整批消失）
    const active = getValue(row, headers, 'active');
    if (active === false || String(active).trim().toUpperCase() === 'FALSE') continue;

    const summary = String(getValue(row, headers, 'summary') || '').trim();
    if (!summary) continue;

    // 一律過 formatDateToISO：Date 儲存格直接輸出會變 UTC 字串、前端差一天（2026-07-12 教訓）
    const date = formatDateToISO(getValue(row, headers, 'date'));
    if (!date) {
      Logger.log(`⚠️ 「變動紀錄」列 ${i + 1}（${id}）日期解析失敗，該列略過`);
      continue;
    }

    if (!byCard[id]) byCard[id] = [];
    byCard[id].push({ date: date, summary: summary, _seq: i });
  }

  let total = 0;
  Object.keys(byCard).forEach(id => {
    // 由新到舊；同一天的以「表裡越後面（越晚 append）＝越新」排前面
    byCard[id].sort((a, b) => (a.date === b.date ? b._seq - a._seq : (a.date < b.date ? 1 : -1)));
    byCard[id] = byCard[id].slice(0, CHANGELOG_MAX_PER_CARD)
      .map(e => ({ date: e.date, summary: e.summary }));
    total += byCard[id].length;
  });

  Logger.log(`✅ 讀取變動紀錄：${Object.keys(byCard).length} 張卡、共 ${total} 筆（每卡上限 ${CHANGELOG_MAX_PER_CARD}）`);
  return byCard;
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
// 商家落地頁清單（MerchantPages 工作表，2026-08-16 新增）。工作表不存在＝回傳空陣列，
// 此時 tools/build-merchant-pages.js 會退回 tools/merchant-pages.fallback.json（過渡用）。
//
// 欄位：
//   slug         URL 用的字串（/merchant/<slug>，中文會自動百分比編碼）
//   merchant     餵給搜尋引擎的「搜尋詞」，必須跟站上搜得到的商家一致（如 LinePay）
//   displayName  頁面上顯示的名稱，留空＝同 merchant（如 merchant=LinePay → 顯示 LINE Pay）
//   title        <title> 與 og:title，整句自己寫
//   description  meta description 與 og:description
//   active       FALSE 就不生成該頁（也不會進 sitemap）
//   order        排序用，非必要
//
// ⚠️ 改了任何一欄，下次匯出後 Cloudflare Pages build 會重生該頁；slug 改掉等於換網址，
// 舊網址會變 404，非必要別動（要動就自己去 GSC 提交新網址）。
function readMerchantPages() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MerchantPages');
  if (!sheet) {
    Logger.log('ℹ️ 找不到 MerchantPages 工作表——商家頁改用 repo 的 fallback 清單');
    return [];
  }
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const str = (row, field) => {
    const val = getValue(row, headers, field);
    return val !== null && val !== undefined && val !== '' ? String(val).trim() : '';
  };
  const pages = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const slug = str(row, 'slug');
    const merchant = str(row, 'merchant');
    if (!slug || !merchant) continue; // slug 或搜尋詞缺一就不是有效的一列
    const activeRaw = getValue(row, headers, 'active');
    pages.push({
      slug: slug,
      merchant: merchant,
      displayName: str(row, 'displayName') || merchant,
      title: str(row, 'title'),
      description: str(row, 'description'),
      // 站長手寫的正文 HTML（選填）。信任層級同 promos：直接烤進商家頁、不 escape，
      // 所以這欄只能由站長自己填，不接受任何外部來源的內容。
      bodyHtml: str(row, 'bodyHtml'),
      order: parseFloat(getValue(row, headers, 'order')) || 999,
      // 空白＝啟用（新增一列時不必特地填 TRUE）；只有明確填 FALSE 才關掉
      active: !(activeRaw === false || String(activeRaw).toUpperCase() === 'FALSE')
    });
  }
  pages.sort(function (a, b) { return a.order - b.order; });
  Logger.log('✅ 讀取 ' + pages.length + ' 筆 MerchantPages 資料');
  return pages;
}

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
      active: getBool(row, 'active'), // active 為 false 也照常 push
      // featured：勾選的活動會排到「主打卡」版位（手機每頁 1 則、桌機每頁 2 則）。
      // 欄位不存在時 getValue 回 null → getBool 回 false，所以舊 sheet 不會壞。
      featured: getBool(row, 'featured')
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
  { key: 'gift', label: '首刷禮' },
  { key: 'bonus', label: '回饋加碼' },
  { key: 'voucher', label: '定額回饋' }
];

function generatePromosPageHtml(exportData) {
  const cards = (exportData && exportData.cards) || [];
  const promos = (exportData && exportData.newCardholderPromos) || [];
  const cardApplyCtas = (exportData && exportData.cardApplyCtas) || {};

  const cardsById = {};
  cards.forEach(function (c) { if (c && c.id) cardsById[c.id] = c; });

  const todayIso = pmcTodayISO_();
  // 「資料更新於」戳章／sitemap lastmod／JSON-LD dateModified 三處共用的日期：由 exportToJSON
  // 依 promo 內容指紋決定（內容沒變就沿用上次那天），透過 promosUpdatedIso 傳入；沒傳（Node
  // 初版 harness、或第一次生成）就退回今天。注意這條「更新日」不等於 todayIso——todayIso 仍
  // 專責過期過濾與 versionTag 快取破壞（那兩件事必須用「實際今天」），別混用。
  const updatedIso = (exportData && exportData.promosUpdatedIso) || todayIso;

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
    // 錨點＝序號＋卡片 id。序號本來就會隨活動到期而位移，所以這串字從來就不是穩定連結，
    // 拿掉 promo_id 不會讓它更不穩（2026-08-15 移除 promo_id 時確認過）。
    const anchorId = 'promo-' + (idx + 1) + '-' + pmcSlug_(promo.id || 'x');
    const periodEndIso = pmcNormalizeDate_(promo.period_end);
    const periodStartIso = pmcNormalizeDate_(promo.period_start);
    const cta = cardApplyCtas[promo.id] || null;
    return { promo: promo, card: card, cardName: cardName, types: types, buckets: buckets,
      primaryBucket: primaryBucket, anchorId: anchorId, periodStartIso: periodStartIso,
      periodEndIso: periodEndIso, cta: cta, orderIndex: idx };
  });

  // ---- 依卡片分組（2026-09-17 改版）----
  // 舊版一檔活動一張卡片，同一張卡有 4 檔就出現 4 次（iLEO、遠東快樂卡、中信 uniopen
  // 都是）。改成一張卡一組：主活動在白卡裡，其餘以「卡疊卡」堆在下面。
  // 組內與組間都依 pmcPromoSortKey_（首刷禮 → 回饋率大到小 → 回饋金額大到小）。
  // ⚠️ 排序用的一律是**單檔**的數字，不相加——同一張卡的多檔活動各有不同達成條件，
  // 加總會講出一個拿不到的數字（左欄的「最多可拿」是另一回事，那是揭露上限不是排名）。
  const groupMap = {};
  const groupOrder = [];
  prepared.forEach(function (p) {
    const id = p.promo.id || '';
    if (!groupMap[id]) {
      groupMap[id] = { cardId: id, cardName: p.cardName, card: p.card, items: [], cta: p.cta };
      groupOrder.push(groupMap[id]);
    }
    groupMap[id].items.push(p);
  });
  groupOrder.forEach(function (g) {
    // 組內：首刷禮 → 回饋率大到小 → 回饋金額大到小（見 pmcPromoSortKey_）
    g.items.sort(function (a, b) { return pmcCompareSortKey_(a.promo, b.promo); });
    // 組間排序用的鍵＝這一組「最前面那一檔」的鍵（items 已排好，取第一筆即可）
    g.sortKey = pmcPromoSortKey_(g.items[0].promo);
    const bs = [];
    g.items.forEach(function (p) {
      p.buckets.forEach(function (b) { if (bs.indexOf(b) === -1) bs.push(b); });
    });
    g.buckets = bs.length ? bs : ['default'];
  });
  const groups = groupOrder.slice().sort(function (a, b) {
    if (a.sortKey.tier !== b.sortKey.tier) return a.sortKey.tier - b.sortKey.tier;
    if (a.sortKey.primary !== b.sortKey.primary) return b.sortKey.primary - a.sortKey.primary;
    return a.items[0].orderIndex - b.items[0].orderIndex;   // 同分用原本的即將截止序當穩定次鍵
  });
  groups.forEach(function (g, i) {
    g.orderIndex = i;
    g.anchorId = 'promo-' + (i + 1) + '-' + pmcSlug_(g.cardId || 'x');
    // JSON-LD 與錨點共用同一組 id：一張卡一個錨點，活動用 -a1/-a2 後綴
    g.items.forEach(function (p, j) { p.anchorId = g.anchorId + '-a' + (j + 1); });
  });

  // 篩選 chips 的數量改算「卡片組」——篩選隱藏的單位就是整組卡片
  const bucketCounts = {};
  groups.forEach(function (g) {
    g.buckets.forEach(function (b) { bucketCounts[b] = (bucketCounts[b] || 0) + 1; });
  });

  const cardsHtml = groups.map(pmcRenderCardGroup_).join('\n');

  // 站長推薦＋行李箱專區（2026-09-23）。舊版匯出程式不會輸出 min_spend／pick_rank／luggage_inch，
  // 這三個欄位都不存在時代表 Sheets 還沒貼上新版程式——整段不出現，免得用缺資料的自動評分上榜。
  const hasPickData = prepared.some(function (p) {
    return p.promo.min_spend !== undefined || p.promo.pick_rank !== undefined || p.promo.luggage_inch !== undefined;
  });
  const picksHtml = hasPickData
    ? pmcRenderPicks_(pmcSelectPicks_(prepared), todayIso.slice(0, 4) + ' 年 ' + parseInt(todayIso.slice(5, 7), 10) + ' 月')
    : '';
  const luggageHtml = hasPickData ? pmcRenderLuggage_(pmcSelectLuggage_(prepared)) : '';
  const filterChipsHtml = pmcBuildFilterChips_(groups.length, bucketCounts);
  const jsonLd = pmcBuildJsonLd_(prepared);
  const breadcrumbJsonLd = pmcBuildBreadcrumbJsonLd_();

  const generatedDisplay = pmcFormatDateDisplay_(updatedIso);
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
  // 不寫檔數：活動數每次匯出都變，放進描述會讓搜尋結果摘要跟頁面實況對不上（2026-09-23）
  const description = '信用卡新戶活動一次看' + (sampleNames ? '，含' + sampleNames + '等' : '') +
    '首刷禮、新戶回饋加碼、定額回饋活動，依即將截止時間排序，持續更新。';
  // 版本含台北時間的時分：同一天多次匯出／改版也能破 promos.css/js 快取
  // （2026-07-16 教訓：純日期版本讓當天稍早的舊 CSS/JS 被瀏覽器快取住）。
  // 位元級重現驗證時用 exportData.versionTagOverride 固定值（見 data-pipeline.md 第 9 節）。
  const versionTag = (exportData && exportData.versionTagOverride) ||
    todayIso.replace(/-/g, '') + pmcTaipeiHm_();

  const webPageJsonLd = pmcBuildWebPageJsonLd_(updatedIso, title, description);

  return pmcPageTemplate_({
    title: title,
    description: description,
    updatedIso: updatedIso,
    generatedDisplay: generatedDisplay,
    count: prepared.length,
    cardsHtml: cardsHtml,
    picksHtml: picksHtml,
    luggageHtml: luggageHtml,
    filterChipsHtml: filterChipsHtml,
    jsonLd: jsonLd,
    breadcrumbJsonLd: breadcrumbJsonLd,
    webPageJsonLd: webPageJsonLd,
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

// 穩定序列化：物件鍵一律排序，陣列維持傳入順序（呼叫端先排好）。純函數、不依賴任何服務，
// Node 與 Apps Script 兩邊輸出一致——供 pmcPromoSignature_ 算出「與序列無關」的內容指紋。
function pmcStableStringify_(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(pmcStableStringify_).join(',') + ']';
  return '{' + Object.keys(v).sort().map(function (k) {
    return JSON.stringify(k) + ':' + pmcStableStringify_(v[k]);
  }).join(',') + '}';
}

// 新戶活動「內容指紋」：只認 newCardholderPromos 的實際內容，不受 sheet 列順序影響
// （把每一筆各自序列化成字串後排序——2026-08-15 移除 promo_id 之前是拿它當排序鍵，
// 現在直接用內容本身排，同一張卡有多檔活動時也不會有排序歧義，比舊做法更穩）。
// exportToJSON 拿它跟 Script Properties 存的上次指紋比對，用來
// 決定 promos 頁「資料更新於」要不要蓋今天（見 data-pipeline.md 第 9 節）。純函數：
// djb2 雜湊配 Math.imul 固定在 32-bit 無號，Node/Apps Script 結果一致，回傳十進位字串。
function pmcPromoSignature_(promos) {
  const list = (promos || []).map(pmcStableStringify_).sort();
  return pmcHashString_('[' + list.join(',') + ']');
}

// djb2 雜湊（原本內嵌在 pmcPromoSignature_，2026-08-16 抽出共用）：配 Math.imul 固定
// 在 32-bit 無號，Node/Apps Script 結果一致，回傳十進位字串。
function pmcHashString_(payload) {
  let h = 5381;
  for (let i = 0; i < String(payload).length; i++) {
    h = (Math.imul(h, 33) ^ String(payload).charCodeAt(i)) >>> 0;
  }
  return String(h);
}

// 「內容真的變動時才前進的日期」通用版（2026-08-16 從 promos 的做法抽出）。
// 指紋與日期成對存在 Script Properties（`<KEY>_LAST_SIG` / `<KEY>_LAST_DATE`）：
// 指紋與上次相同 → 沿用上次那天；不同或第一次 → 蓋今天並寫回。
// 這是 sitemap lastmod 的唯一正確來源：每次匯出都蓋今天等於對 Google 天天喊
// 「我更新了」，內容其實沒動，久了 Google 反而不信任 lastmod、降低重爬效率。
function pmcStampedDate_(key, signature) {
  const props = PropertiesService.getScriptProperties();
  const prevSig = props.getProperty(key + '_LAST_SIG');
  const prevDate = props.getProperty(key + '_LAST_DATE');
  if (prevSig === signature && prevDate) return prevDate;
  const today = pmcTodayISO_();
  props.setProperty(key + '_LAST_SIG', signature);
  props.setProperty(key + '_LAST_DATE', today);
  return today;
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

// ---------- 獎勵金額換算（2026-09-17 改版）----------
// 三種獎勵換算成同一個單位「最高可拿多少錢」，卡片組排序與大字都用它：
//   定額回饋 → voucher_amount（票面金額）
//   回饋加碼 → bonus_rate × bonus_cap（bonus_cap 是「消費上限」，相乘即回饋天花板）
//   首刷禮   → 沒有現金定價，回 null（大字改顯示贈品全名）
// ⚠️ 同一張卡的多檔活動各自獨立、不相加（各有不同達成條件，2026-09-17 站長裁定）——
// 分組排序只看「單檔最大值」，全站沒有任何加總數字。
function pmcPromoValue_(promo) {
  if (typeof promo.voucher_amount === 'number' && !isNaN(promo.voucher_amount)) {
    return promo.voucher_amount;
  }
  const hasRate = promo.bonus_rate !== undefined && promo.bonus_rate !== null && promo.bonus_rate !== '';
  if (hasRate && typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap)) {
    const r = typeof promo.bonus_rate === 'number'
      ? (promo.bonus_rate <= 1 ? promo.bonus_rate * 100 : promo.bonus_rate)
      : parseFloat(promo.bonus_rate);
    if (!isNaN(r)) return Math.round(r / 100 * promo.bonus_cap);
  }
  return null;
}

function pmcRateDisplay_(promo) {
  if (promo.bonus_rate === undefined || promo.bonus_rate === null || promo.bonus_rate === '') return '';
  if (typeof promo.bonus_rate === 'number') {
    return (promo.bonus_rate <= 1 ? (promo.bonus_rate * 100) : promo.bonus_rate) + '%';
  }
  return String(promo.bonus_rate);
}

function pmcMoney_(n) {
  return 'NT$' + Math.round(n).toLocaleString('en-US');
}

// 獎勵大字（上）＋單位小字（下）。獎品沒有金額，大字改放贈品全名（不截斷，
// 站長 2026-09-17：獎品那區的重點就是獎品內容）。
// 「回饋加碼」型＝有回饋率、且不是定額回饋。大字、小字、附屬列三個地方都要用同一個
// 判斷，所以抽成一支——各寫各的 typeof 檢查遲早會分岔。
// ⚠️ 判斷順序：voucher_amount 優先（與 pmcPromoValue_ 一致），一列同時有兩種欄位時
// 一律當定額回饋。
function pmcIsBonus_(promo) {
  if (typeof promo.voucher_amount === 'number' && !isNaN(promo.voucher_amount)) return false;
  return promo.bonus_rate !== undefined && promo.bonus_rate !== null && promo.bonus_rate !== '';
}

// 回饋加碼的大字放**回饋率**，金額退到小字（站長 2026-09-21）——「10%」一眼就看得出
// 這檔活動的性質，「NT$2,000」則要配上「上限消費多少」才有意義。
// 定額回饋（金額）與首刷禮（贈品全名）維持原樣，它們本來就沒有回饋率。
// bonus_rate 的數值版（pmcRateDisplay_ 回傳的是給人看的字串，不能拿來排序）。
// Sheets 可能存 0.1 也可能存 10，一律正規化成百分比數字。
function pmcRateNumber_(promo) {
  const r = promo.bonus_rate;
  if (r === undefined || r === null || r === '') return null;
  const n = (typeof r === 'number') ? r : parseFloat(r);
  if (isNaN(n)) return null;
  return n <= 1 ? n * 100 : n;
}

// 排序鍵（站長 2026-09-21 定序）：**首刷禮優先 → 回饋率大到小 → 回饋金額大到小**。
// 大字改顯示回饋率之後，舊的「一律依金額」會讓清單看起來沒有規律（2% 排在 10% 前面），
// 所以改成先分三層、層內再各自比自己的主數字。
//   tier 0 首刷禮：沒有現金定價，排最前面
//   tier 1 回饋加碼：比 bonus_rate
//   tier 2 定額回饋：比 voucher_amount
// 回傳 { tier, primary }；比較規則是 tier 升冪、primary 降冪。
function pmcPromoSortKey_(promo) {
  if (pmcIsBonus_(promo)) {
    const r = pmcRateNumber_(promo);
    return { tier: 1, primary: r === null ? 0 : r };
  }
  const v = pmcPromoValue_(promo);
  if (v === null) return { tier: 0, primary: 0 };
  return { tier: 2, primary: v };
}

function pmcCompareSortKey_(a, b) {
  const ka = pmcPromoSortKey_(a), kb = pmcPromoSortKey_(b);
  if (ka.tier !== kb.tier) return ka.tier - kb.tier;
  return kb.primary - ka.primary;
}

function pmcRewardBig_(promo) {
  if (pmcIsBonus_(promo)) {
    const rate = pmcRateDisplay_(promo);
    if (rate) return { html: pmcEscapeHtml_(rate), isGift: false };
  }
  const v = pmcPromoValue_(promo);
  if (v === null) {
    const gift = String(promo.gift_content || '').trim();
    return { html: gift ? pmcEscapeHtmlMultiline_(gift) : '首刷禮', isGift: true };
  }
  return { html: pmcEscapeHtml_(pmcMoney_(v)), isGift: false };
}

function pmcRewardSub_(promo) {
  if (pmcIsBonus_(promo)) {
    // 大字已經是回饋率，小字改講「能拿多少・要刷多少」。
    // 金額放**前面**：它是結果、上限是條件，而附屬列的 meta 會被寬度截斷，
    // 截掉條件比截掉結果好。沒有上限（cap 空）時只出現金額，兩者都沒有就整句空白。
    const v = pmcPromoValue_(promo);
    const parts = [];
    if (v !== null) parts.push('最多可拿 ' + pmcMoney_(v));
    if (typeof promo.bonus_cap === 'number' && !isNaN(promo.bonus_cap)) {
      parts.push('上限消費 ' + pmcMoney_(promo.bonus_cap));
    }
    return parts.join('・');
  }
  // 首刷禮回空字串：大字已經是獎品全名、上方又有「首刷禮」類型徽章，
  // 這裡再印一次「首刷禮」就是同一張卡上出現兩遍（站長 2026-09-22）。
  if (pmcPromoValue_(promo) === null) return '';
  if (typeof promo.voucher_amount === 'number' && !isNaN(promo.voucher_amount)) {
    return promo.voucher_usage ? String(promo.voucher_usage) : '刷卡金';
  }
  return '';
}

// ---------- 站長推薦／行李箱專區（2026-09-23）----------
// 兩個區塊都放在清單上方、不受篩選／搜尋／「隱藏我持有的卡片」影響（站長指定）。
// 資料欄位見 pmcRowToPromo_ 的說明；規則的完整說明在 docs/project/data-pipeline.md 第 9b 節。
//
// 選榜規則（站長 2026-09-23 定案）：
//   1. pick_rank 填 1–5 的活動，強制排在該位置；填 x 的永遠不自動選入
//   2. 首刷禮／定額回饋／回饋加碼三類各至少 1 名（手動已涵蓋的類型就不再補）
//   3. 剩下的位置讓「定額回饋」與「回饋加碼」比換算回饋率；首刷禮之間只比得出門檻
//      （沒有價值欄位，站長不做 gift_value），第 2 檔以後的首刷禮要靠 pick_rank
//   4. 同一張卡只出現一次；同分時截止日較近的排前面
//   5. 只送行李箱的活動不進推薦區（它們在行李箱專區）；多選一裡有行李箱的，
//      推薦區只顯示非行李箱的選項
const PMC_PICK_MAX = 5;
// 定額回饋換算回饋率時的門檻下限：min_spend 空白（不限金額）或很小時，
// 100 元 ÷ 0 元會變成無限大、把小額活動全推上榜，所以最少當作刷了 1,000 元。
const PMC_PICK_SPEND_FLOOR = 1000;
// 回饋加碼的通路包含這些熱門支付時，分數 ×1.2（站長：「熱門通路的高回饋率」）
const PMC_HOT_PAY = ['line pay', 'linepay', 'apple pay', 'google pay', 'samsung pay', '全支付',
  '街口', '悠遊付', '玉山wallet', 'icash pay', '全盈+pay', 'pi 拍錢包'];
// 「行李箱」選項的判斷：行李箱／登機箱／旅行箱，或「N吋…箱」（擴充箱、胖胖箱、城市漫步旅行箱…）。
// 2026-09-23 實際資料：「Disegno 28吋爵美旅行胖胖箱」「SNOOPY 28吋上掀時尚擴充箱」原本漏判。
const PMC_LUGGAGE_RE = /行李箱|登機箱|旅行箱|吋[^①-⑩]*箱/;

function pmcHasValue_(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

// gift_content 拆成選項：「①A\n②B」或「A、B」以外的寫法都當成單一選項
function pmcGiftOptions_(text) {
  const s = String(text || '').trim();
  if (!s) return [];
  return s.split(/\n|(?=[①②③④⑤⑥⑦⑧⑨⑩])/)
    .map(function (x) { return x.replace(/^[\s①②③④⑤⑥⑦⑧⑨⑩]+/, '').trim(); })
    .filter(function (x) { return x.length > 0; });
}

function pmcIsHotPay_(merchants) {
  return (merchants || []).some(function (m) {
    const k = String(m).toLowerCase().replace(/\s+/g, ' ').trim();
    return PMC_HOT_PAY.indexOf(k) !== -1;
  });
}

function pmcPickRankNumber_(promo) {
  if (!pmcHasValue_(promo.pick_rank)) return null;
  const n = parseInt(promo.pick_rank, 10);
  return (n >= 1 && n <= PMC_PICK_MAX) ? n : null;
}

function pmcPickExcluded_(promo) {
  return pmcHasValue_(promo.pick_rank) && String(promo.pick_rank).trim().toLowerCase() === 'x';
}

function pmcThresholdText_(promo) {
  return typeof promo.min_spend === 'number' && promo.min_spend > 0
    ? '刷滿 ' + pmcMoney_(promo.min_spend) : '不限金額';
}

// 申辦連結：有分潤 CTA 用「立即申辦」，沒有就退用活動頁「活動詳情」（同清單的規則）
function pmcApplyLink_(p) {
  const ctaLink = p.cta ? pmcSanitizeUrl_(p.cta.link) : '';
  if (ctaLink) return { href: ctaLink, label: '立即申辦', sponsored: true };
  const promoLink = pmcSanitizeUrl_(p.promo.link);
  if (promoLink) return { href: promoLink, label: '活動詳情', sponsored: false };
  return null;
}

// 一檔活動 → 推薦候選（不符資格回 null）。p 是 generatePromosPageHtml 的 prepared 項目。
function pmcBuildPickCandidate_(p) {
  const promo = p.promo;
  const link = pmcApplyLink_(p);
  if (!link) return null;
  const base = { p: p, promo: promo, link: link, luggageNote: '' };

  if (pmcIsBonus_(promo)) {
    const r = pmcRateNumber_(promo);
    if (r === null || r <= 0) return null;
    const merchants = promo.bonus_merchants || [];
    const hot = pmcIsHotPay_(merchants);
    const v = pmcPromoValue_(promo);
    base.kind = 'bonus';
    base.score = r * (hot ? 1.2 : 1);
    base.headline = pmcRateDisplay_(promo) + ' 回饋';
    base.sub = merchants.length ? merchants.slice(0, 3).join('、') + (merchants.length > 3 ? ' 等' : '') : '';
    base.thr = typeof promo.bonus_cap === 'number' ? '上限消費 ' + pmcMoney_(promo.bonus_cap) : '門檻：' + pmcThresholdText_(promo);
    base.rateText = '';
    base.hot = hot;
    base.autoReason = (merchants.length ? base.sub + '都算，' : '') + '享 ' + pmcRateDisplay_(promo) + ' 回饋' +
      (v !== null ? '，最多可拿 ' + pmcMoney_(v) : '') + '。';
    return base;
  }

  if (typeof promo.voucher_amount === 'number' && !isNaN(promo.voucher_amount) && promo.voucher_amount > 0) {
    const spend = typeof promo.min_spend === 'number' && promo.min_spend > 0 ? promo.min_spend : 0;
    const rate = promo.voucher_amount / Math.max(spend, PMC_PICK_SPEND_FLOOR) * 100;
    base.kind = 'fixed';
    base.score = rate;
    base.headline = pmcMoney_(promo.voucher_amount);
    base.sub = promo.voucher_usage ? String(promo.voucher_usage) : '刷卡金';
    base.thr = '門檻：' + pmcThresholdText_(promo);
    base.rateText = spend ? '≈ ' + Math.round(promo.voucher_amount / spend * 100) + '%' : '';
    base.autoReason = (spend ? '刷滿 ' + pmcMoney_(spend) + ' 就拿 ' : '不限消費金額，就拿 ') +
      pmcMoney_(promo.voucher_amount) + (base.rateText ? '，換算回饋率約 ' + base.rateText.replace('≈ ', '') : '') + '。';
    return base;
  }

  const options = pmcGiftOptions_(promo.gift_content);
  if (!options.length) return null;
  const nonLuggage = options.filter(function (o) { return !PMC_LUGGAGE_RE.test(o); });
  if (!nonLuggage.length) return null;                       // 只送行李箱 → 只在行李箱專區
  if (nonLuggage.length < options.length || typeof promo.luggage_inch === 'number') {
    base.luggageNote = '另有行李箱選項，見下方行李箱專區';
  }
  base.kind = 'gift';
  base.score = -(typeof promo.min_spend === 'number' ? promo.min_spend : 0);   // 門檻越低越好
  base.headline = nonLuggage.join(' 或 ');
  base.sub = '';
  base.thr = '門檻：' + pmcThresholdText_(promo);
  base.rateText = '';
  base.autoReason = String(promo.new_customer_summary || '').trim();
  return base;
}

function pmcAutoQuestion_(c) {
  const spend = typeof c.promo.min_spend === 'number' ? c.promo.min_spend : 0;
  if (c.kind === 'gift') return spend <= 1000 ? '只想刷一筆就收工？' : spend <= 3000 ? '想用小額換好禮？' : '想拿實體好禮？';
  if (c.kind === 'fixed') {
    if (!spend) return '不想刻意消費也能拿？';
    return spend <= 1000 ? '小額就想拿回饋？' : spend <= 3000 ? '平常刷刷就能達標？' : '首月剛好有大筆開銷？';
  }
  const text = (c.promo.bonus_merchants || []).join(' ') + ' ' + (c.promo.new_customer_summary || '');
  if (c.hot) return '天天用手機付款？';
  if (/國外|海外|外幣/.test(text)) return '常出國刷卡？';
  if (/保費/.test(text)) return '最近要繳保費？';
  const m = (c.promo.bonus_merchants || [])[0];
  return m ? '常在' + m + '消費？' : '想多拿一點回饋？';
}

// 同一次推薦裡問句撞在一起時的替代句（兩張都是「小額就想拿回饋？」會很怪）
function pmcAltQuestion_(c) {
  if (c.kind === 'fixed') return '想拿 ' + c.headline + ' ' + c.sub + '？';
  if (c.kind === 'bonus') return '想要 ' + c.headline + '？';
  return '想拿' + c.headline.split(' 或 ')[0] + '？';
}

function pmcCompareCandidates_(a, b) {
  if (a.score !== b.score) return b.score - a.score;
  const ae = a.p.periodEndIso || '9999-99-99', be = b.p.periodEndIso || '9999-99-99';
  return ae < be ? -1 : ae > be ? 1 : 0;
}

// prepared（未過期、已排序）→ 最多 5 筆推薦，已決定好問句與理由
function pmcSelectPicks_(prepared) {
  const cands = prepared.map(pmcBuildPickCandidate_).filter(function (c) { return c; });
  const usedCards = {};
  const slots = [];

  // 1) 手動指定位置
  cands.filter(function (c) { return pmcPickRankNumber_(c.promo) !== null; })
    .sort(function (a, b) { return pmcPickRankNumber_(a.promo) - pmcPickRankNumber_(b.promo); })
    .forEach(function (c) {
      if (usedCards[c.promo.id]) return;
      let i = pmcPickRankNumber_(c.promo) - 1;
      while (i < PMC_PICK_MAX && slots[i]) i++;
      if (i >= PMC_PICK_MAX) return;
      slots[i] = c;
      usedCards[c.promo.id] = true;
    });

  // 2) 自動候選池
  const pool = cands.filter(function (c) {
    return pmcPickRankNumber_(c.promo) === null && !pmcPickExcluded_(c.promo);
  }).sort(pmcCompareCandidates_);
  const autos = [];
  const take = function (c) { autos.push(c); usedCards[c.promo.id] = true; };
  const freeCount = function () { return PMC_PICK_MAX - slots.filter(Boolean).length - autos.length; };
  const hasKind = function (k) {
    return slots.some(function (c) { return c && c.kind === k; }) || autos.some(function (c) { return c.kind === k; });
  };

  ['gift', 'fixed', 'bonus'].forEach(function (k) {
    if (freeCount() <= 0 || hasKind(k)) return;
    const best = pool.filter(function (c) { return c.kind === k && !usedCards[c.promo.id]; })[0];
    if (best) take(best);
  });
  // 剩下的位置：定額回饋與回饋加碼比換算回饋率；不夠才輪到首刷禮
  [['fixed', 'bonus'], ['gift']].forEach(function (kinds) {
    pool.forEach(function (c) {
      if (freeCount() > 0 && kinds.indexOf(c.kind) !== -1 && !usedCards[c.promo.id]) take(c);
    });
  });

  let ai = 0;
  for (let i = 0; i < PMC_PICK_MAX && ai < autos.length; i++) {
    if (!slots[i]) slots[i] = autos[ai++];
  }
  const picks = slots.filter(Boolean);

  const usedQ = {};
  picks.forEach(function (c) {
    const manualQ = pmcHasValue_(c.promo.pick_question) ? String(c.promo.pick_question).trim() : '';
    let q = manualQ || pmcAutoQuestion_(c);
    if (!manualQ && usedQ[q]) q = pmcAltQuestion_(c);
    usedQ[q] = true;
    c.question = q;
    c.reason = pmcHasValue_(c.promo.pick_reason) ? String(c.promo.pick_reason).trim() : c.autoReason;
  });
  return picks;
}

function pmcApplyLinkHtml_(link, p, cls, surface) {
  return '<a class="' + cls + '" href="' + pmcEscapeHtml_(link.href) + '" target="_blank" rel="noopener noreferrer' +
    (link.sponsored ? ' sponsored" data-ga-track="1' : '') + '" data-ga-section="' + surface +
    '" data-card-id="' + pmcEscapeHtml_(p.promo.id) + '" data-card-name="' + pmcEscapeHtml_(p.cardName) + '">' +
    (link.label === '立即申辦' ? '<span class="pmc-cta-long">立即</span>申辦' : link.label) + '</a>';
}

function pmcCardImgHtml_(p, cls) {
  const src = 'assets/images/cards/' + encodeURIComponent(p.promo.id) + '.png';
  return '<span class="' + cls + '"><img src="' + pmcEscapeHtml_(src) + '" alt="' + pmcEscapeHtml_(p.cardName) +
    '" loading="lazy" onerror="this.closest(\'.' + cls + '\').style.display=\'none\'"></span>';
}

const PMC_KIND_LABEL = { gift: '首刷禮', fixed: '定額回饋', bonus: '回饋加碼' };

// 頁內索引列（站長 2026-09-23）：站長推薦／行李箱專區／新戶活動。
// 沒產生的區塊不出連結；整區被 promos.js 因過期藏起來時，連結也會一起藏。
function pmcJumpNav_(hasPicks, hasLuggage) {
  return '  <nav class="pmc-jump" aria-label="頁內導覽">' +
    (hasPicks ? '<a href="#picks" data-jump="picks">站長推薦</a>' : '') +
    (hasLuggage ? '<a href="#luggage" data-jump="luggage">行李箱專區</a>' : '') +
    '<a href="#all-promos">新戶活動</a></nav>\n';
}

function pmcRenderPicks_(picks, monthLabel) {
  if (!picks.length) return '';
  const items = picks.map(function (c) {
    const p = c.p;
    return '    <article class="pmc-pick pmc-pick--' + c.kind + '" data-period-end="' + (p.periodEndIso || '') + '">\n' +
      '      <p class="pmc-pick-q">' + pmcEscapeHtml_(c.question) + '</p>\n' +
      '      ' + pmcCardImgHtml_(p, 'pmc-pick-img') + '\n' +
      '      <h3 class="pmc-pick-name">' + pmcEscapeHtml_(p.cardName) + '</h3>\n' +
      '      <div class="pmc-pick-badges"><span class="pmc-kind pmc-kind--' + c.kind + '">' + PMC_KIND_LABEL[c.kind] +
        '</span><span class="promo-ending-badge" hidden></span></div>\n' +
      '      <p class="pmc-pick-headline">' + pmcEscapeHtml_(c.headline) +
        (c.sub ? '<small>' + pmcEscapeHtml_(c.sub) + '</small>' : '') + '</p>\n' +
      '      <p class="pmc-pick-thr">' + pmcEscapeHtml_(c.thr) +
        (c.rateText ? '<span class="pmc-pick-rate">回饋率 ' + pmcEscapeHtml_(c.rateText) + '</span>' : '') + '</p>\n' +
      // 推薦理由＝「為什麼值得辦」，是這張卡最重要的一句話（站長 2026-09-23），給它標題與底色
      (c.reason ? '      <div class="pmc-pick-reason"><span class="pmc-pick-reason-label">推薦理由</span><p>' +
        pmcEscapeHtml_(c.reason) + '</p></div>\n' : '') +
      (c.luggageNote ? '      <p class="pmc-pick-note">' + pmcEscapeHtml_(c.luggageNote) + '</p>\n' : '') +
      '      ' + pmcApplyLinkHtml_(c.link, p, 'promo-apply-btn pmc-pick-cta', 'picks') + '\n' +
      '    </article>';
  }).join('\n');
  return '  <section class="pmc-picks" id="picks" aria-labelledby="pmc-picks-title">\n' +
    '    <div class="pmc-section-head"><h2 id="pmc-picks-title">站長推薦 Top ' + picks.length + '</h2><span>' + pmcEscapeHtml_(monthLabel) + '</span></div>\n' +
    '    <div class="pmc-picks-row">\n' + items + '\n    </div>\n' +
    // 手機橫滑的分頁點：數量、目前位置由 promos.js setupPicksDots() 依實際可見張數產生
    '    <div class="pmc-dots" hidden></div>\n' +
    '  </section>\n';
}

// ---- 行李箱專區 ----
// 等比例的行李箱圖示：viewBox 固定，高度由 CSS 依 --inch 決定（桌機、手機倍率不同）
function pmcSuitcaseSvg_() {
  return '<svg class="pmc-lg-svg" viewBox="0 0 40 64" aria-hidden="true">' +
    '<rect x="13" y="1.5" width="14" height="8" rx="3" fill="none" stroke="#94a3b8" stroke-width="2.5"/>' +
    '<rect x="2" y="8" width="36" height="49" rx="6" fill="#dbe4f5" stroke="#1e40af" stroke-width="2"/>' +
    '<line x1="14" y1="13" x2="14" y2="52" stroke="#1e40af" stroke-opacity=".35" stroke-width="1.5"/>' +
    '<line x1="26" y1="13" x2="26" y2="52" stroke="#1e40af" stroke-opacity=".35" stroke-width="1.5"/>' +
    '<circle cx="9" cy="60" r="3" fill="#475569"/><circle cx="31" cy="60" r="3" fill="#475569"/></svg>';
}

function pmcSelectLuggage_(prepared) {
  return prepared.filter(function (p) {
    return typeof p.promo.luggage_inch === 'number' && p.promo.luggage_inch > 0;
  }).map(function (p) {
    const options = pmcGiftOptions_(p.promo.gift_content);
    const lugs = options.filter(function (o) { return PMC_LUGGAGE_RE.test(o); });
    const lugText = (lugs.length ? lugs : options.slice(0, 1)).join(' 或 ');
    return { p: p, inch: p.promo.luggage_inch,
      gift: lugText + (options.length > 1 ? '（好禮 ' + options.length + ' 選 1）' : ''),
      img: pmcSanitizeUrl_(p.promo.gift_image_url),
      link: pmcApplyLink_(p) };
  }).sort(function (a, b) {
    if (a.inch !== b.inch) return b.inch - a.inch;
    const as = a.p.promo.min_spend || 0, bs = b.p.promo.min_spend || 0;
    if (as !== bs) return as - bs;
    const ae = a.p.periodEndIso || '9999-99-99', be = b.p.periodEndIso || '9999-99-99';
    return ae < be ? -1 : ae > be ? 1 : 0;
  });
}

function pmcRenderLuggage_(items) {
  if (items.length < 2) return '';   // 只有一檔就不成「比較」，整區不出現
  // 版面（站長 2026-09-23 第三輪）：整區是一個淡底的獨立區塊，裡面一檔一張白卡。
  // 卡片：左＝等比例行李箱＋吋數；中＝卡名、贈品、參考價／門檻（倒數徽章掛在這一行尾，
  // 只是提醒，不搶位置）；右＝贈品圖（有圖才有這一欄）；底部一列＝卡片特色＋申辦。
  const rows = items.map(function (l) {
    const p = l.p;
    const v = p.promo.luggage_value;
    const inchText = String(Math.round(l.inch * 10) / 10);
    // 贈品宣傳圖：可點擊放大（promos.js setupGiftLightbox 的委派認 .pmc-lg-thumb）
    const thumb = l.img
      ? '      <button type="button" class="pmc-lg-thumb" aria-label="放大檢視贈品圖"><img src="' + pmcEscapeHtml_(l.img) +
        '" alt="' + pmcEscapeHtml_(p.cardName + ' 贈品') + '" loading="lazy" onerror="this.closest(\'.pmc-lg\').classList.remove(\'pmc-lg--img\');this.closest(\'.pmc-lg-thumb\').remove()"></button>\n'
      : '';
    // 卡片特色：內容借用下方清單同一張卡的 .promo-card-feat（部署時注入），
    // promos.js 依 data-feat-card 找到那張卡再開同一個 modal
    const featBtn = '<button type="button" class="promo-feat-btn pmc-lg-feat" aria-expanded="false" data-feat-card="' +
      pmcEscapeHtml_(p.promo.id) + '">卡片特色<span class="promo-chevron" aria-hidden="true"></span></button>';
    return '    <article class="pmc-lg' + (l.img ? ' pmc-lg--img' : '') + '" data-period-end="' + (p.periodEndIso || '') +
        '" style="--inch:' + l.inch + '">\n' +
      '      <div class="pmc-lg-size">' + pmcSuitcaseSvg_() + '<span class="pmc-lg-inch">' + inchText + '<small>吋</small></span></div>\n' +
      '      <div class="pmc-lg-body">\n' +
      '        <h3 class="pmc-lg-name">' + pmcEscapeHtml_(p.cardName) + '</h3>\n' +
      '        <p class="pmc-lg-gift">' + pmcEscapeHtml_(l.gift) + '</p>\n' +
      '        <div class="pmc-lg-meta"><dl class="pmc-lg-facts"><div><dt>參考價</dt><dd>' +
        (typeof v === 'number' && v > 0 ? pmcEscapeHtml_(pmcMoney_(v)) : '—') + '</dd></div>' +
        '<div><dt>門檻</dt><dd>' + pmcEscapeHtml_(pmcThresholdText_(p.promo)) + '</dd></div></dl>' +
        '<span class="promo-ending-badge" hidden></span></div>\n' +
      '      </div>\n' +
      thumb +
      '      <div class="pmc-lg-actions">' + featBtn +
        (l.link ? pmcApplyLinkHtml_(l.link, p, 'promo-apply-btn pmc-lg-cta', 'luggage') : '') + '</div>\n' +
      '    </article>';
  }).join('\n');
  return '  <section class="pmc-luggage" id="luggage" aria-labelledby="pmc-luggage-title">\n' +
    '    <div class="pmc-section-head"><h2 id="pmc-luggage-title">行李箱專區</h2><span>辦卡送行李箱，尺寸、參考價一次比</span></div>\n' +
    '    <div class="pmc-lg-row">\n' + rows + '\n    </div>\n' +
    '    <p class="pmc-lg-fn">參考價依官網公告價值，或以相同或相近款式的市售價格估算，銀行贈品規格可能不同，僅供參考。</p>\n' +
    '  </section>\n';
}

// ---------- HTML 片段渲染 ----------

// 一檔活動自己的詳情：適用通路／達成條件／活動期間／新戶定義／備註。
// 2026-09-17 站長指正——改版中期這一整塊一度被拿掉，但它是使用者判斷「自己算不算
// 新戶、要做什麼才拿得到」的唯一依據，必須留著；而且同一張卡的多檔活動條件各不相同，
// 所以它掛在「每一檔活動」身上，不是掛在卡片上。
// 附屬列把收合那行的 meta 文字整段移進詳情裡（兩個寬度都是，站長 2026-09-21），
// 收合時那一行只留「詳情 ▾」（主活動那顆維持全稱）。移進來的位置有兩種，由呼叫端決定：
//   leadHtml    ＝ <dl> 之前的一段話（首刷禮的達成條件、回饋加碼的「最多可拿…」）
//   leadRowHtml ＝ <dl> 的第一列（定額回饋的「OPENPOINT」「刷卡金」這種單一名詞，
//                 單獨一段看不懂在講什麼，要掛「回饋類型」標題——站長指定）
function pmcRenderPromoDetail_(p, detailId, leadHtml, leadRowHtml) {
  const promo = p.promo;
  const rows = [];
  if (Array.isArray(promo.bonus_merchants) && promo.bonus_merchants.length) {
    rows.push('<div class="promo-meta-row"><dt>適用通路</dt><dd><span class="promo-merchants-value">' +
      pmcEscapeHtml_(promo.bonus_merchants.join('、')) + '</span></dd></div>');
  }
  if (promo.promo_condition) {
    rows.push('<div class="promo-meta-row"><dt>達成條件</dt><dd>' +
      pmcEscapeHtmlMultiline_(promo.promo_condition) + '</dd></div>');
  }
  let periodValueHtml;
  if (p.periodStartIso && p.periodEndIso) {
    periodValueHtml = '<time datetime="' + p.periodStartIso + '">' + pmcFormatDateDisplay_(p.periodStartIso) +
      '</time> ~ <time datetime="' + p.periodEndIso + '">' + pmcFormatDateDisplay_(p.periodEndIso) + '</time>';
  } else if (p.periodEndIso) {
    periodValueHtml = '至 <time datetime="' + p.periodEndIso + '">' + pmcFormatDateDisplay_(p.periodEndIso) + '</time> 止';
  } else if (p.periodStartIso) {
    periodValueHtml = '<time datetime="' + p.periodStartIso + '">' + pmcFormatDateDisplay_(p.periodStartIso) + '</time> 起';
  } else {
    periodValueHtml = '不限期';
  }
  rows.push('<div class="promo-meta-row"><dt>活動期間</dt><dd>' + periodValueHtml + '</dd></div>');
  if (promo.new_customer_definition) {
    rows.push('<div class="promo-meta-row promo-definition-row"><dt>新戶定義</dt><dd>' +
      pmcEscapeHtmlMultiline_(promo.new_customer_definition) + '</dd></div>');
  }
  // 備註一律完整輸出；收不收合交給 promos.js 客戶端量測（scrollHeight 超過兩行才
  // 套 clamp＋「展開 ▾」）。⚠️ 量測必須在詳情展開之後才做——收合時 display:none，
  // scrollHeight 恆為 0（2026-09-17 原型實測踩到）。
  const notesHtml = promo.notes
    ? '<div class="promo-notes" data-notes-block><div class="promo-notes-label">備註</div>' +
      '<div class="promo-notes-text">' + pmcEscapeHtmlMultiline_(promo.notes) + '</div></div>'
    : '';
  return '<div class="promo-act-detail" id="' + pmcEscapeHtml_(detailId) + '" hidden>' +
    (leadHtml || '') +
    '<dl class="promo-card-meta">' + (leadRowHtml || '') + rows.join('') + '</dl>' +
    notesHtml + '</div>';
}

// 一檔活動（主活動與堆疊層共用同一份標記，只差外層 class）。
// data-period-end 掛在活動上而不是卡片上——同一張卡的多檔活動到期日各不相同，
// promos.js 的「最後 N 天」徽章與過期隱藏都是逐檔判斷。
// 只渲染「最高可拿的那一檔」——第 2 檔起走 pmcRenderPromoSubRow_ 的附屬列
// （2026-09-21 起就沒有第二個呼叫端了，原本的 isMain 參數一併移除）。
function pmcRenderPromoAct_(p, actId) {
  const promo = p.promo;
  const big = pmcRewardBig_(promo);
  const detailId = actId + '-detail';
  const typeBadges = p.types.map(function (t) {
    const bucket = pmcPromoTypeBucket_(t);
    return '<span class="promo-type-badge promo-type-badge--' + bucket + '">' + pmcEscapeHtml_(t) + '</span>';
  }).join('');

  // 縮圖：獎品有活動宣傳圖就用它，沒有就退回卡片圖（站長 2026-09-17）。
  // ⚠️ onerror 要藏掉**整個 .promo-act-thumb 外框**，不能只藏 <img>——外框有 1px 細框，
  // 只藏 img 會留下一個空的方框（2026-09-18 實測）。
  const giftImgUrl = (pmcPromoValue_(promo) === null) ? pmcSanitizeUrl_(promo.gift_image_url) : '';
  const cardImgSrc = 'assets/images/cards/' + encodeURIComponent(p.promo.id || '') + '.png';
  const thumbSrc = giftImgUrl || cardImgSrc;
  const thumbAlt = giftImgUrl ? (p.cardName + ' 活動宣傳圖') : p.cardName;
  const thumbCls = 'promo-act-thumb' + (giftImgUrl ? ' promo-act-thumb--gift' : '');

  const summary = promo.new_customer_summary || '';
  const rewardSub = pmcRewardSub_(promo);

  return '<div class="promo-act is-main" data-period-end="' +
      (p.periodEndIso || '') + '">\n' +
    '  <button type="button" class="promo-act-row" aria-expanded="false" aria-controls="' +
      pmcEscapeHtml_(detailId) + '">\n' +
    '    <span class="' + thumbCls + '"><img src="' + pmcEscapeHtml_(thumbSrc) + '" alt="' +
      pmcEscapeHtml_(thumbAlt) + '" loading="lazy" onerror="this.closest(\'.promo-act-thumb\').style.display=\'none\'"></span>\n' +
    '    <span class="promo-act-body">\n' +
    '      <span class="promo-act-badges">' + typeBadges +
      '<span class="promo-ending-badge" hidden></span></span>\n' +
    '      <span class="promo-act-reward' + (big.isGift ? ' is-gift' : '') + '">' + big.html +
      // 小字可能是空的（首刷禮）——空的時候整個 <small> 不輸出，留一個空標籤會讓
      // .promo-act-reward small 的 margin-top 撐出一條沒有東西的空白
      (rewardSub ? '<small>' + pmcEscapeHtml_(rewardSub) + '</small>' : '') + '</span>\n' +
    (summary ? '      <span class="promo-act-summary">' + pmcEscapeHtml_(summary) + '</span>\n' : '') +
    '      <span class="promo-act-more">活動詳情<span class="promo-chevron" aria-hidden="true"></span></span>\n' +
    '    </span>\n' +
    '  </button>\n' +
    '  ' + pmcRenderPromoDetail_(p, detailId) + '\n' +
    '</div>';
}

// 一張卡一組（2026-09-17 改版）：主活動在白卡裡，同卡其餘活動以「卡疊卡」堆在下面，
// 卡片特色是另一種形狀的抽屜（不能跟堆疊用同一套視覺，否則看起來錯亂——站長指正）。
// 堆疊與特色互斥：展開特色時整疊活動收起，收回特色它們才回來（promos.js 負責）。
// 左欄那句「N 檔活動・最多可拿 …・需分別達成」（站長 2026-09-22 定稿）。
// ⚠️ 不寫「新戶活動」：這頁整頁都在講新戶活動（h1／title／description／每張卡的
//    「新戶定義」都有），左欄這句是版面標籤不是內文，重複那兩個字只是佔寬度。
// 首刷禮沒有現金價值，不能併進金額，改成「＋N 項首刷禮」分開講。
// ⚠️ 這是把同卡多檔的金額**相加**，所以句尾一定要帶「（需分別達成）」——
//    2026-09-17 的「同一張卡的多檔活動各自獨立、不相加」講的是**排序只看單檔最大值**，
//    不是禁止揭露總上限；但每一檔的達成條件都不同，不加這句會被讀成「刷一次就拿得到」
//    （站長 2026-09-21 定稿，原本是「最高可拿」）。
function pmcRailCount_(acts) {
  let cash = 0, gifts = 0;
  acts.forEach(function (p) {
    const v = pmcPromoValue_(p.promo);
    if (v === null) gifts++; else cash += v;
  });
  const parts = [];
  if (cash > 0) parts.push(pmcMoney_(cash));
  if (gifts > 0) parts.push(gifts + ' 項首刷禮');
  if (!parts.length) return acts.length + ' 檔活動';
  return acts.length + ' 檔活動・最多可拿 <b>' + pmcEscapeHtml_(parts.join('＋')) +
    '</b><span class="promo-rail-caveat">・需分別達成</span>';
}

// 第 2 檔起的「附屬列」（做法 A → 2026-09-21 晚上改成「方案 B：值獨佔一行」）：
// 一列兩排的清單列，右側掛獎品圖與展開箭頭。
//
//   ┌ 上排：[類型 chip] 這一檔的「值」            ┐ [獎品圖] 詳情 ▾
//   └ 下排：活動摘要（灰色小字）                  ┘
//
// **值＝這一檔能拿到什麼**，三種類型共用同一個起點（這就是「對齊」的來源）：
//   首刷禮   → 獎品全名（沒有現金價值）
//   回饋加碼 → 回饋率（「10%」）
//   定額回饋 → 金額（「NT$500」）
// ⚠️ 為什麼不能用「欄」來對齊：桌機一條附屬列的內容寬只有 426px，而現行最長的獎品名
//    43 個字、17px 排一行要 731px——比整列還寬。所以對齊只能靠「值自己佔一排」，
//    不能靠把欄位撐寬（站長 2026-09-21 在三案 mockup 中選定方案 B）。
//
// 類型 chip 用 .promo-sub-type，**顏色 token 與主活動的 .promo-type-badge 共用**
// （2026-09-21 就是因為附屬列自己硬寫顏色，同一張卡上「首刷禮」出現粉綠兩色）。
// 形狀不共用：主活動那顆是「從卡框長出來的 label」（只有右下圓角），放進列裡要用一般 pill。
//
// class 刻意沿用 `promo-act-row`：promos.js 的 setupActToggle 靠它做展開收合，
// 這樣附屬列不必另外寫一套互動（樣式用 `.promo-act-row.promo-sub-row` 雙 class 覆蓋，
// 單 class 的 `.promo-sub-row` 會輸給 `.promo-act-row` 的 padding:0）。
//
// anyImg：這一組裡有沒有任何一檔有獎品圖。有的話，沒圖的那幾列也要補一個等寬空位，
// 否則右側的「詳情」會一列一個位置、看起來像沒對齊。
function pmcRenderPromoSubRow_(p, actId, anyImg) {
  const promo = p.promo;
  const detailId = actId + '-detail';
  const value = pmcPromoValue_(promo);
  const isBonus = pmcIsBonus_(promo);
  const isGift = !isBonus && value === null;
  const isVoucher = !isBonus && !isGift;
  const summary = String(promo.new_customer_summary || '');
  const giftName = String(promo.gift_content || '').trim();
  const giftImgUrl = isGift ? pmcSanitizeUrl_(promo.gift_image_url) : '';

  // 上排左側的類型 chip：跟主活動渲染同一組 p.types（少數活動有兩個類型，都輸出）
  // 包一層 .promo-sub-types：那是一個**固定寬度的槽**，讓右邊的「值」在各列對到同一條線。
  // 少數活動有兩個類型（現行 61 檔中 5 檔），那幾列的槽會被撐開、值跟著右移——
  // 用 15/16 的對齊換「不丟掉任何一個類型」，這是刻意的取捨。
  const typeHtml = '<span class="promo-sub-types">' + p.types.map(function (t) {
    return '<span class="promo-sub-type promo-sub-type--' + pmcPromoTypeBucket_(t) + '">' +
      pmcEscapeHtml_(t) + '</span>';
  }).join('') + '</span>';

  // 上排右側的「值」
  const amt = isBonus ? pmcEscapeHtml_(pmcRateDisplay_(promo))
    : isGift ? pmcEscapeHtml_(giftName || '首刷禮')
    : pmcEscapeHtml_(pmcMoney_(value));

  // 詳情最上方的補充說明（收合時看不到）。首刷禮不需要——它的摘要就在下排，
  // 再放一次會變成同一句話出現兩遍。
  const lead = isGift ? '' : String(pmcRewardSub_(promo));

  let thumb = '';
  if (giftImgUrl) {
    thumb = '<span class="promo-sub-thumb promo-sub-thumb--gift"><img src="' +
      pmcEscapeHtml_(giftImgUrl) + '" alt="' + pmcEscapeHtml_(p.cardName + ' 活動宣傳圖') +
      '" loading="lazy" onerror="this.closest(\'.promo-sub-thumb\').style.visibility=\'hidden\'"></span>';
  } else if (anyImg) {
    thumb = '<span class="promo-sub-thumb is-empty" aria-hidden="true"></span>';
  }

  // is-gift 掛在整列上，CSS 靠它處理「獎品名不是數字，字重輕一階且可換行」。
  // 刻意輸出成 class 而不是靠 :has()，對舊瀏覽器是確定的行為。
  return '<div class="promo-act is-sub" data-period-end="' + (p.periodEndIso || '') + '">\n' +
    '  <button type="button" class="promo-act-row promo-sub-row' + (isGift ? ' is-gift' : '') +
      '" aria-expanded="false" aria-controls="' + pmcEscapeHtml_(detailId) + '">\n' +
    '    <span class="promo-sub-head">' + typeHtml +
      '<span class="promo-sub-amt">' + amt + '</span></span>\n' +
    '    <span class="promo-sub-title">' + pmcEscapeHtml_(summary) + '</span>\n' +
    '    <span class="promo-sub-meta"><span class="promo-ending-badge" hidden></span>' + thumb +
      '<span class="promo-sub-more">詳情</span>' +
      '<span class="promo-chevron" aria-hidden="true"></span></span>\n' +
    '  </button>\n' +
    // 定額回饋的補充是「OPENPOINT」「刷卡金」這種單一名詞，單獨一段看不懂在講什麼，
    // 走 <dl> 的第一列並掛上「回饋類型」標題；回饋加碼的是完整句子，走 <dl> 之前的段落。
    '  ' + pmcRenderPromoDetail_(p, detailId,
      (lead && !isVoucher) ? '<p class="promo-sub-summary">' + pmcEscapeHtml_(lead) + '</p>' : '',
      (lead && isVoucher) ? '<div class="promo-meta-row"><dt>回饋類型</dt><dd>' +
        pmcEscapeHtml_(lead) + '</dd></div>' : '') + '\n' +
    '</div>';
}

function pmcRenderCardGroup_(group) {
  const acts = group.items;          // 已依「最高可拿」倒序
  const main = acts[0];
  const cardId = group.cardId;
  const anchorId = group.anchorId;

  const mainHtml = pmcRenderPromoAct_(main, anchorId + '-a1');
  // 這一組裡有沒有任何一檔有獎品圖（決定沒圖的列要不要補等寬空位）
  const anyImg = acts.slice(1).some(function (p) {
    return pmcPromoValue_(p.promo) === null && !!pmcSanitizeUrl_(p.promo.gift_image_url);
  });
  const stackHtml = acts.slice(1).map(function (p, i) {
    return pmcRenderPromoSubRow_(p, anchorId + '-a' + (i + 2), anyImg);
  }).join('\n');

  // CTA：cardApplyCtas 有分潤連結時當主按鈕「立即申辦」；沒有就退用主活動的
  // promo.link（銀行活動頁）、文字改「活動詳情」。同一張卡只出現一次。
  const ctaLink = group.cta ? pmcSanitizeUrl_(group.cta.link) : '';
  const promoLink = pmcSanitizeUrl_(main.promo.link);
  let ctaHtml = '';
  if (ctaLink) {
    ctaHtml = '<a class="promo-apply-btn" href="' + pmcEscapeHtml_(ctaLink) +
      '" target="_blank" rel="noopener noreferrer sponsored" data-ga-track="1" data-card-id="' +
      pmcEscapeHtml_(cardId) + '" data-card-name="' + pmcEscapeHtml_(group.cardName) + '">立即申辦</a>';
  } else if (promoLink) {
    ctaHtml = '<a class="promo-apply-btn" href="' + pmcEscapeHtml_(promoLink) +
      '" target="_blank" rel="noopener noreferrer" data-card-id="' + pmcEscapeHtml_(cardId) + '">活動詳情</a>';
  }

  // 卡片特色：內容由部署時的 tools/build-promos-features.js 注入（它把 js/ 那 12 支
  // 模組載進 Node 的 vm，用主站自己的 getDisplayRate() 算，絕不在這裡另寫一套回饋率
  // 邏輯——見 docs/project/cashback-engine.md 第 6 節「三處實作必須一致」的警告）。
  // 沒跑生成器時這裡是空的，promos.js 會把按鈕一起藏起來，頁面仍然完整可用。
  const featId = anchorId + '-feat';

  const featBtn = '<button type="button" class="promo-feat-btn" aria-expanded="false" aria-controls="' +
    pmcEscapeHtml_(featId) + '">卡片特色<span class="promo-chevron" aria-hidden="true"></span></button>';
  const nameHtml = '<h2 class="promo-card-name">' + pmcEscapeHtml_(group.cardName) + '</h2>';
  const openTag = '<article class="promo-card" id="' + pmcEscapeHtml_(anchorId) + '" data-card-id="' +
    pmcEscapeHtml_(cardId) + '" data-card-name="' + pmcEscapeHtml_(group.cardName) +
    '" data-order-index="' + group.orderIndex + '" data-act-count="' + acts.length +
    '" data-type-buckets="' + pmcEscapeHtml_(group.buckets.join(' ')) + '">\n';
  const featBox = '  <div class="promo-card-feat" id="' + pmcEscapeHtml_(featId) + '" data-feat-for="' +
    pmcEscapeHtml_(cardId) + '" hidden></div>\n';

  const cardImg = 'assets/images/cards/' + encodeURIComponent(cardId) + '.png';
  const thumbHtml = '<span class="promo-rail-thumb"><img src="' + pmcEscapeHtml_(cardImg) +
    '" alt="' + pmcEscapeHtml_(group.cardName) + '" loading="lazy" ' +
    'onerror="this.closest(\'.promo-rail-thumb\').style.display=\'none\'"></span>';

  // ---- 單檔活動的卡（站長 2026-09-21：要更像多檔卡）----
  // 跟多檔卡一樣，先來一個「身分區塊」：放大的卡片圖在上、卡名在圖下面，
  // 活動內容接在底下**整列**展開——而不是舊版「小卡圖在左、文字擠在右半邊」。
  // 兩種骨架共用 .promo-card-rail／.promo-rail-thumb／.promo-card-name，只差在
  // --solo（橫幅，圖在上名在下）與 --side（側欄，桌機時是左邊那一直欄）。
  // 主活動裡那顆卡片圖由 CSS 藏起來（.promo-card-main .promo-act-thumb:not(--gift)），
  // 獎品自己的活動宣傳圖仍然留著——那是這一檔活動獨有的資訊，不是重複。
  // data-act-count 讓 CSS 不必靠 :has() 就能分辨兩種骨架，對舊瀏覽器也是確定的行為。
  // 兩顆按鈕跟多檔卡一樣住在 rail 裡（站長 2026-09-21）：桌機與手機都是
  // 「卡片圖＋名稱 → 按鈕 → 分割線 → 活動內容」。放進 rail 才會在分割線**上方**
  // ——rail 的 border-bottom 就是那條線，按鈕留在 .promo-card-main 裡怎麼排都在線下。
  const actionsHtml = '  <div class="promo-card-actions">\n' + ctaHtml + '\n      ' + featBtn + '\n  </div>\n';
  if (acts.length === 1) {
    return openTag +
      '  <div class="promo-card-rail promo-card-rail--solo">\n' +
      '    <div class="promo-rail-id">\n' +
      '      ' + thumbHtml + '\n' +
      '      ' + nameHtml + '\n' +
      '    </div>\n' +
      '  ' + actionsHtml +
      '  </div>\n' +
      '  <div class="promo-card-main">\n' + mainHtml + '\n  </div>\n' +
      featBox + '</article>';
  }

  // ---- 多檔活動的卡：做法 A「左側品牌欄」（站長 2026-09-21 定案）----
  // 卡圖／卡名／「N 檔活動・最多可拿 …」／申辦鈕／卡片特色全部收進左欄，
  // 右欄上半是最高那一檔的完整卡、下半是第 2 檔起的附屬列。
  // 為什麼不是「卡名橫跨兩欄」（2026-09-20 那版）：那條橫幅裡只有一行短字、
  // 七成是空的，底下又掛著兩根長度差很多的柱子，站長回報看起來怪。身分收進左欄之後，
  // 卡名永遠跟卡圖在一起、不會落單，兩欄長度不一致也不再是問題（左右關係不是上下關係）。
  // 參考：Booking.com「一間飯店、多種房型」、MoneySuperMarket 商品列。
  return openTag +
    '  <div class="promo-card-rail promo-card-rail--side">\n' +
    '    <div class="promo-rail-id">\n' +
    '      ' + thumbHtml + '\n' +
    '      <div class="promo-rail-text">\n' +
    '        ' + nameHtml + '\n' +
    '        <p class="promo-rail-count">' + pmcRailCount_(acts) + '</p>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '    <div class="promo-card-actions">\n' + ctaHtml + '\n      ' + featBtn + '\n' +
    '    </div>\n' +
    '  </div>\n' +
    '  <div class="promo-card-main">\n' + mainHtml + '\n  </div>\n' +
    // 這一區刻意沒有標題：附屬列的形狀（灰底、縮排的一行一檔）已經說明它是
    // 「同一張卡的其他活動」，再加一行「這張卡的其他 N 檔活動」是多餘的
    // （站長 2026-09-21）。檔數在左欄的「N 檔活動」已經講過一次。
    '  <div class="promo-card-stack">\n' + stackHtml + '\n  </div>\n' +
    featBox + '</article>';
}

// 數量括號用半形 (n)，不用全形（） ——2026-07-15 站長回饋：全形括號跟其餘半形
// 內文混排不一致，改半形比較乾淨。
function pmcBuildFilterChips_(total, bucketCounts) {
  const chips = ['<button type="button" class="promo-chip is-active" data-filter="all">全部 (' + total + ')</button>'];
  PMC_CHIP_DEFS.forEach(function (c) {
    const n = bucketCounts[c.key] || 0;
    if (n > 0) {
      // modifier class 讓篩選 chip 帶上該類型的顏色，跟卡片上的類型徽章對得起來
      // （站長 2026-09-21：「讓用戶更容易連結」）。key 與徽章的 bucket 同名。
      chips.push('<button type="button" class="promo-chip promo-chip--' + c.key +
        '" data-filter="' + c.key + '">' + pmcEscapeHtml_(c.label) + ' (' + n + ')</button>');
    }
  });
  // 「即將結束」（2026-09-20 站長需求）：篩出有「最後 N 天／今天截止！」徽章的卡片。
  // ⚠️ 數量**不能**在這裡算——徽章是 promos.js 拿「今天」跟 period_end 逐檔比出來的，
  // 靜態生成當下算的數字隔天就錯（這頁一次匯出可以掛好幾週）。所以這裡只輸出骨架＋
  // hidden，由 promos.js 的 refreshBadgesAndExpiry() 填數字並決定要不要顯示
  // （一張都沒有就整顆不出現）。
  chips.push('<button type="button" class="promo-chip promo-chip--ending" data-filter="ending" id="promos-chip-ending" hidden>即將結束 (<span id="promos-chip-ending-count">0</span>)</button>');
  return chips.join('\n');
}

function pmcBuildJsonLd_(prepared) {
  const items = prepared.map(function (p, idx) {
    return {
      '@type': 'ListItem',
      position: idx + 1,
      // 一律只留卡名（promo_name 有填就用它）；url 指向該檔活動在卡片組內的錨點
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

// 頁面層級結構化資料（2026-07-23 新增）：帶 dateModified 的 CollectionPage，讓答案引擎
// （AEO/GEO）與 Google 讀到「這份新戶活動清單最後更新日」。dateModified 用 updatedIso
// ——只有 promo 內容真的變動時才前進的那個日期，與可見「資料更新於」戳章、sitemap 的
// promos lastmod 同源，三處一致（見 data-pipeline.md 第 9 節）。與 ItemList／BreadcrumbList
// 三個 JSON-LD 並存（同頁多個 <script type="application/ld+json"> 是合法用法）。
function pmcBuildWebPageJsonLd_(updatedIso, title, description) {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: title,
    description: description,
    url: PMC_SITE_URL + '/promos',
    inLanguage: 'zh-Hant',
    dateModified: updatedIso,
    isPartOf: {
      '@type': 'WebSite',
      name: '信用卡回饋大師',
      url: PMC_SITE_URL + '/'
    }
  };
  return JSON.stringify(ld, null, 2).replace(/<\//g, '<\\/');
}

// 麵包屑結構化資料（2026-07-16 新增）：與頁面可見的 .promos-breadcrumb 對應，
// 內容固定（只有兩層：首頁／本頁），不依賴任何動態資料，獨立於 pmcBuildJsonLd_
// 的 ItemList 並存（同頁多個 JSON-LD <script> 是合法用法）。
function pmcBuildBreadcrumbJsonLd_() {
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: PMC_SITE_URL + '/' },
      { '@type': 'ListItem', position: 2, name: '新戶活動', item: PMC_SITE_URL + '/promos' }
    ]
  };
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
'<script type="application/ld+json">\n' + o.breadcrumbJsonLd + '\n</script>\n' +
'<script type="application/ld+json">\n' + o.webPageJsonLd + '\n</script>\n' +
'</head>\n' +
'<body>\n' +
'<div class="promos-container">\n' +
// Header（2026-07-16 v3 全站 header 一致化，同日站長二輪回饋撤回頭像）：與 faq.html
// 同款結構——漢堡（手機）、logo＋站名整塊連回 `/`、導覽「新戶活動」（本頁，
// aria-current）＋「常見問題」→ `/faq`、右側「返回首頁」鈕。跟 faq.html 一樣是
// 手抄件，不是共用元件；faq.html 又是抄 index.html 的 header-top，三邊都要手動
// 同步（見 FAQ-README.md／data-pipeline.md 第 9 節）。
// 站名刻意用 <span> 而非 <h1>：這頁真正的 SEO H1 是下面 hero 區塊的
// 「信用卡新戶活動一覽」，同頁兩個 h1 對文件結構不利。
// 右側原本試過頭像＋精簡 dropdown，站長裁定「副頁頭像做不到主站完整功能
// （無法登出/管理），意義不大」，退回「返回首頁」鈕（同款 faq.html 的
// .back-home-btn，這裡用 promos- 前綴）。
'<header class="promos-header">\n' +
'  <div class="promos-header-top">\n' +
'    <button id="promos-sidebar-toggle-btn" class="promos-sidebar-toggle-btn" aria-label="開啟選單">\n' +
'      <svg width="22" height="22" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z"/></svg>\n' +
'    </button>\n' +
'    <a href="/" class="promos-header-content">\n' +
'      <img src="assets/images/logo-header.png?v=' + o.versionTag + '" alt="" class="promos-header-logo">\n' +
'      <span class="promos-header-title">信用卡回饋大師</span>\n' +
'    </a>\n' +
'    <nav class="promos-header-links" aria-label="站內頁面">\n' +
'      <a href="/promos" class="promos-header-nav-link" aria-current="page">新戶活動</a>\n' +
'      <a href="/faq" class="promos-header-nav-link">常見問題</a>\n' +
'    </nav>\n' +
'    <a href="/" class="promos-back-home-btn" title="返回首頁">\n' +
'      <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16">\n' +
'        <path fill-rule="evenodd" d="M8.354 1.146a.5.5 0 0 1 0 .708L2.707 7.5H14.5a.5.5 0 0 1 0 1H2.707l5.647 5.646a.5.5 0 0 1-.708.708l-6.5-6.5a.5.5 0 0 1 0-.708l6.5-6.5a.5.5 0 0 1 .708 0z"/>\n' +
'      </svg>\n' +
'      <span>返回首頁</span>\n' +
'    </a>\n' +
'  </div>\n' +
'</header>\n' +
'\n' +
// 手機漢堡抽屜（比照 faq.html：抽屜內兩張卡片連回主站兩個頁面）。桌機
// （≥769px）在 promos.css 顯式隱藏，跟 faq.css 對 .sidebar 的處理一樣——這頁沒有
// .app-layout 常駐左欄，不隱藏會版面壞。
'<div class="promos-sidebar-overlay" id="promos-sidebar-overlay"></div>\n' +
'\n' +
'<aside class="promos-sidebar" id="promos-sidebar">\n' +
'  <div class="promos-sidebar-header">\n' +
'    <button class="promos-sidebar-close-btn" id="promos-sidebar-close-btn" aria-label="關閉選單">\n' +
'      <svg width="20" height="20" fill="currentColor" viewBox="0 0 16 16"><path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/></svg>\n' +
'    </button>\n' +
'  </div>\n' +
'  <div class="promos-sidebar-content">\n' +
'    <nav class="promos-sidebar-page-links" aria-label="站內頁面">\n' +
'      <a href="/" class="promos-sidebar-tool-card">\n' +
'        <span class="promos-sidebar-tool-card-emoji" aria-hidden="true">💳</span>\n' +
'        <span class="promos-sidebar-tool-card-text"><strong>回饋比較工具</strong><small>查商家回饋・比較信用卡</small></span>\n' +
'        <span class="promos-sidebar-tool-card-arrow" aria-hidden="true">→</span>\n' +
'      </a>\n' +
'      <a href="/faq" class="promos-sidebar-faq-card">\n' +
'        <span class="promos-sidebar-faq-card-emoji" aria-hidden="true">💬</span>\n' +
'        <span class="promos-sidebar-faq-card-text"><strong>常見問題 FAQ</strong><small>使用教學・功能說明</small></span>\n' +
'        <span class="promos-sidebar-faq-card-arrow" aria-hidden="true">→</span>\n' +
'      </a>\n' +
'    </nav>\n' +
'  </div>\n' +
'</aside>\n' +
'\n' +
'<main class="promos-main">\n' +
// 麵包屑（2026-07-16 新增）：結構化資料另見 <head> 的 BreadcrumbList JSON-LD
// （pmcBuildBreadcrumbJsonLd_）。
'  <nav class="promos-breadcrumb" aria-label="breadcrumb">\n' +
'    <a href="/">首頁</a><span class="promos-breadcrumb-sep" aria-hidden="true">›</span><span aria-current="page">新戶活動</span>\n' +
'  </nav>\n' +
'  <section class="promos-hero">\n' +
'    <h1>信用卡新戶活動一覽</h1>\n' +
'    <div class="promos-hero-intro">\n' +
'      <p>信用卡首刷禮排行榜！新戶辦卡推薦</p>\n' +
'      <p>各大銀行信用卡新戶活動一次比較，為你列出刷卡金、加碼回饋及首刷禮，一次比較多張信用卡新戶活動、快速看懂活動條件及回饋方式。</p>\n' +
'    </div>\n' +
'  </section>\n' +
'\n' +
// 站長推薦＋行李箱專區（2026-09-23）：放在搜尋列之前——搜尋、篩選只作用在下方清單，
// 這兩區固定顯示（站長指定：勾「隱藏我持有的卡片」也不隱藏）。沒資料時是空字串。
(o.picksHtml || o.luggageHtml ? pmcJumpNav_(!!o.picksHtml, !!o.luggageHtml) : '') +
(o.picksHtml || '') + (o.luggageHtml || '') +
// 「新戶活動」標題：完整清單的起點，也是索引列第三個連結的錨點（站長 2026-09-23）
'  <div class="pmc-section-head pmc-list-head" id="all-promos"><h2>新戶活動</h2></div>\n' +
// 卡片名稱搜尋框（2026-07-22 站長需求：比照主站搜尋框，讓用戶輸入卡名快速定位
// 活動）。type=search＋autocomplete/autocorrect/autocapitalize 全關：同 index.html
// 的 #merchant-input，避免手機鍵盤跳 autofill 建議。清除 ✕ 鈕預設 hidden，
// promos.js setupSearch() 偵測到有輸入才顯示；即時 substring 比對 data-card-name，
// 疊加在既有類型/持有卡篩選之上（見 promos.js refreshVisibility）。
// 2026-09-20：搜尋框與「資料更新於」併成同一列（站長：桌機搜尋框不必佔整行）。
// 桌機＝搜尋框靠左（有 max-width）、戳章靠右；手機＝wrap 成兩列，戳章仍右對齊。
'  <div class="promos-search-row">\n' +
'  <div class="promos-search-box">\n' +
'    <div class="promos-search-input-wrap">\n' +
'      <svg class="promos-search-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>\n' +
'      <input type="search" id="promos-search-input" name="promos-card-search" inputmode="search" enterkeyhint="search" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="搜尋卡片名稱及通路名稱" aria-label="搜尋卡片名稱及通路名稱">\n' +
'      <button type="button" id="promos-search-clear-btn" class="promos-search-clear-btn" aria-label="清除輸入" hidden>&times;</button>\n' +
'    </div>\n' +
'  </div>\n' +
// 「資料更新於」戳章：2026-07-23 從頁尾搬到 grid 上方讓用戶一眼看到新鮮度；
// 2026-09-20 再搬進搜尋列的右側（站長）。updatedIso 只在活動內容真的變動時才前進
// （見 exportToJSON 的指紋比對）。<time datetime> 保語意化，機器可讀。
'  <div class="promos-data-update">資料更新於 <time datetime="' + pmcEscapeHtml_(o.updatedIso) + '">' + pmcEscapeHtml_(o.generatedDisplay) + '</time></div>\n' +
'  </div>\n' +
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
    // 排序切換已移除（2026-09-17 站長裁定）：清單固定依「最高可拿」倒序，
    // 不再讓使用者選排序方式。保留的是「類型」chips 與「隱藏我持有的卡片」。

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
// 信用卡警語橫條：跟 index.html 的 .finance-warning-row 一樣是 .promos-container／
// .container 的直接子元素（不包在有 padding 的 <main> 裡），才能 width:100% 貼齊
// 容器左右邊界、底部圓角跟容器本身的圓角無縫銜接（2026-07-29 從 main 內移出到這裡，
// 修正之前套用 max-width+置中的獨立浮動樣式，跟主站不一致）。
'<section class="promos-warning-row" aria-label="信用卡警語">謹慎理財、信用至上</section>\n' +
'</div>\n' +
'\n' +
// Footer：移除「用回饋計算機比比看」按鈕，改放主站的 footer（社群媒體/贊助區塊），
// 複製自 index.html 的 .social-media-footer——主站改動這塊時，這裡要手動同步（同一句
// 提醒也寫進了 docs/project/data-pipeline.md 第 9 節）。
'<footer class="social-media-footer">\n' +
'  <div class="social-media-container">\n' +
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
'      <div class="explore-section">\n' +
'      <p class="social-media-title">探索更多</p>\n' +
'      <div class="social-media-links">\n' +
'        <a href="/faq" class="social-link faq" aria-label="常見問題">\n' +
'          <span class="social-text">常見問題 FAQ ↗</span>\n' +
'        </a>\n' +
'        <a href="/landing" class="social-link about" aria-label="認識 Pick My Card">\n' +
'          <span class="social-text">Pick My Card 是什麼？↗</span>\n' +
'        </a>\n' +
'        <!-- 法務連結（2026-08-20）：全站每頁都要有的隱私權政策入口。\n' +
'             AdSense／Analytics 服務條款要求發布商提供隱私權政策，個資法第 8 條的\n' +
'             告知義務也需要常設入口——新增頁面時記得一起帶上。 -->\n' +
'        <a href="/privacy" class="social-link privacy" aria-label="隱私權政策">\n' +
'            <span class="social-text">隱私權政策</span>\n' +
'        </a>\n' +
'        <!-- 法務連結（2026-09-02）：使用須知與免責聲明獨立頁 /terms。\n' +
'             同樣是每一頁都要有的入口——新增頁面時記得一起帶上。 -->\n' +
'        <a href="/terms" class="social-link privacy" aria-label="使用須知與免責聲明">\n' +
'            <span class="social-text">使用須知與免責聲明</span>\n' +
'        </a>\n' +
'      </div>\n' +
'    </div>\n' +
'</div>\n' +
'</footer>\n' +
'\n' +
// 申辦前 FAQ 收合區塊（<details>，預設關閉，2026-07-29 新增；同日從 <main> 內搬到
// 這裡）：白色框框外、社群 footer 之後、回到頂部鈕之前（2026-09-02 前這個位置的參照
// 是 index.html 的 .disclaimer-footer，那塊當天連同重複的免責聲明一起移除了）。
// 純靜態文案（不吃 exportData），跟其他手抄段落一樣兩邊同步即可。
'<details class="promos-faq">\n' +
'  <summary class="promos-faq-summary">申辦新的信用卡之前，先確認這幾件事<span class="promos-faq-chevron" aria-hidden="true"></span></summary>\n' +
'  <div class="promos-faq-body">\n' +
'    <h3>「新戶」的定義每家銀行不一樣</h3>\n' +
'    <p>最常見的是「核卡前 6 個月內未持有該行任一信用卡正卡」，但也有算 12 個月的，還有幾家是「從未持有這張卡」就算。辦之前先對一下自己的持卡紀錄，避免拿不到新戶禮。</p>\n' +
'\n' +
'    <h3>三種活動類型，拿到的新戶禮不同</h3>\n' +
'    <p><strong>首刷禮</strong>：實體贈品或好禮多選一。門檻通常最高，送達時間通常也最久。</p>\n' +
'    <p><strong>回饋加碼</strong>：指定期間內消費多拿一段百分比。適合在期間內有大筆消費的人。</p>\n' +
'    <p><strong>定額回饋</strong>：刷滿指定金額回饋固定刷卡金。門檻最低，入帳最快。</p>\n' +
'\n' +
'    <h3>「一般消費」通常不包含這些</h3>\n' +
'    <p>稅款、學費、罰鍰、水電瓦斯、電信費、預借現金、基金扣款、年費、悠遊卡自動加值。刷這些通常都累積不到門檻，是沒達標最常見的原因。</p>\n' +
'\n' +
'    <h3>幾乎每檔都要做的三件事</h3>\n' +
'    <p>申請電子帳單、設定帳戶自動扣繳、活動登錄。漏掉任何一項，即使消費條件達成了也拿不到。</p>\n' +
'\n' +
'    <h3>有些銀行還會多要求</h3>\n' +
'    <p>核卡後 30 天內登入指定 App、提交年收入通過門檻證明、期限內消費滿額或滿筆數，完全達成才能符合新戶活動資格。</p>\n' +
'\n' +
'    <h3>贈品不會馬上到</h3>\n' +
'    <p>首刷禮多半在達成條件後 2 到 4 個月才發簡訊通知兌換，刷卡金通常在達成條件後 1 到 3 個月入帳。收到兌換連結後也有期限，逾期視同放棄。</p>\n' +
'\n' +
'    <h3>一戶通常只能領一份</h3>\n' +
'    <p>同一家銀行的多檔新戶活動多半不能疊。同時申辦多張卡，也常以最早核卡的那張認定資格。</p>\n' +
'  </div>\n' +
'</details>\n' +
'\n' +
// 回到頂部浮標（手機版，2026-07-16 新增，比照 index.html／faq.html）：捲動超過
// 300px 才顯示，行為邏輯在 promos.js setupBackToTopButton()。
'<button id="promos-back-to-top-btn" class="promos-back-to-top-btn" title="回到頂部" aria-label="回到頂部">\n' +
'  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 19V6M6 12l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>\n' +
'</button>\n' +
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
const SITE_ORIGIN = 'https://pickmycard.app';

function publishToGitHub(cardsDataContent, promosPageHtml, merchantPages, promosUpdatedIso, homeUpdatedIso) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('請先在「專案設定 → 指令碼屬性」設定 GITHUB_TOKEN');

  const version = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMdd-HHmmss');

  // Cloudflare Pages 免費方案 500 builds/月，push 到 main 每個 commit 觸發一次 build：
  // 舊做法一次匯出 4+ 個 commit ＝ 4+ 個 build，且中間幾個 build 部署的是半新半舊的樹。
  // 改法：除最後一個 commit 外全部加 [CI Skip] 前綴（Cloudflare 認得的跳過標記），
  // cards.version 移到最後、不加標記——整次匯出只觸發這一次 build，build checkout 時
  // 樹上已有本次全部檔案，一次部署到位。version 最後落地也順帶保證前端快取檢查
  // 「版本號前進時，新 cards.data 一定已經在 repo」。
  const skip = '[CI Skip] ';
  commitFileToGitHub('cards.data', cardsDataContent, `${skip}Update cards.data (${version})`, token);
  if (promosPageHtml) {
    commitFileToGitHub('promos.html', promosPageHtml, `${skip}Update promos.html (${version})`, token);
  }

  // 商家落地頁的 HTML 不在這裡生成（2026-08-16 改）：那些頁是 index.html 的複製品，
  // 若由 Apps Script 生成，等於要在 Sheets 腳本裡再存一份 index.html 的版面——就是第三份
  // 會走鐘的副本。改成 Cloudflare Pages build 時跑 tools/build-merchant-pages.js，
  // 從 repo 當下的 index.html ＋ cards.data 現場組出來。這裡只負責把 merchantPages
  // 清單放進 cards.data（上面的 jsonContent），讓 build 端知道要生哪幾頁。

  // sitemap.xml 每次匯出重生。所有 lastmod 都只在「該頁內容真的變動」時才前進（2026-08-16
  // 起商家頁也比照辦理，先前每次匯出都蓋今天＝對 Google 天天喊「我更新了」，內容其實沒動，
  // 久了 Google 反而不信任 lastmod、降低重爬效率）：promos → promosUpdatedIso、
  // 首頁 → homeUpdatedIso（cards.data 內容指紋）、商家頁 → 見 generateSitemapXml_。
  commitFileToGitHub('sitemap.xml', generateSitemapXml_(merchantPages, promosUpdatedIso, homeUpdatedIso), `${skip}Update sitemap.xml (${version})`, token);

  // 唯一不加 [CI Skip] 的 commit：觸發本次匯出僅有的一次 Cloudflare build
  commitFileToGitHub('cards.version', version, `Update cards.version (${version})`, token);

  return version;
}

// MerchantPages 工作表還沒建立時的退路：沒有這個清單，sitemap 會把現有 6 頁整組移除。
// 工作表建好之後這個陣列就不再被用到（但別急著刪，它是工作表被誤刪時的安全網）。
// 與 tools/merchant-pages.fallback.json 是同一份清單，兩邊要一致。
const MERCHANT_FALLBACK_SLUGS = ['蝦皮', 'momo', '高鐵', 'linepay', '中華航空', '中油'];

// 產生 sitemap.xml 全文。lastmod 一律是「該頁內容最後真的變動的日期」，不是匯出日期：
//  - landing/faq：不隨匯出變動 → 固定日期常數（改版時更新這裡）
//  - 首頁 /：homeUpdatedIso（cards.data 內容指紋，首頁內容全由它渲染）
//  - promos：promosUpdatedIso（活動內容指紋，與頁面可見戳章／JSON-LD dateModified 同源）
//  - 商家頁：同樣用 homeUpdatedIso。那些頁＝index.html 版面 ＋ cards.data 算出來的卡片
//    清單，內容會變的來源就是 cards.data，與首頁同一個訊號（2026-08-16 改；在那之前是
//    每次匯出蓋當天，等於對 Google 天天喊更新，久了 lastmod 就不被信任）
// 沒傳的日期一律退回今天（Node harness／第一次生成）。日期都走 pmcTodayISO_() 台北時區。
function generateSitemapXml_(merchantPages, promosUpdatedIso, homeUpdatedIso) {
  const today = pmcTodayISO_();
  const merchantLastmod = homeUpdatedIso || today;
  const urls = [
    { loc: SITE_ORIGIN + '/', lastmod: homeUpdatedIso || today },
    { loc: SITE_ORIGIN + '/landing', lastmod: '2026-08-16' },
    { loc: SITE_ORIGIN + '/faq', lastmod: '2026-08-16' },
    { loc: SITE_ORIGIN + '/terms', lastmod: '2026-09-02' },
    { loc: SITE_ORIGIN + '/promos', lastmod: promosUpdatedIso || today }
  ];
  // 商家頁清單以 MerchantPages 工作表為準（active=FALSE 的不收）；工作表不存在才用退路清單
  const active = (merchantPages || []).filter(function (m) { return m && m.slug && m.active !== false; });
  const slugs = active.length
    ? active.map(function (m) { return m.slug; })
    : MERCHANT_FALLBACK_SLUGS;
  slugs.forEach(function(s) {
    urls.push({ loc: SITE_ORIGIN + '/merchant/' + encodeURIComponent(s), lastmod: merchantLastmod });
  });
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  urls.forEach(function(u) {
    xml += '  <url>\n    <loc>' + u.loc + '</loc>\n    <lastmod>' + u.lastmod + '</lastmod>\n  </url>\n';
  });
  xml += '</urlset>\n';
  return xml;
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
