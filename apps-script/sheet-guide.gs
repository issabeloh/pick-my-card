/**
 * 使用說明（2026-10-04 新增）
 *
 * 這是備份副本——實際執行版貼在「PMC 資料自動化」試算表的 Apps Script 專案裡
 * （新增指令碼檔案「使用說明」）。與 benefits-parser.gs 同一個專案。
 *
 * 選單「📖 使用說明」做三件事：
 *   1. 建立／更新最前面的「0-使用說明」分頁：我想做什麼 → 在哪填 → 按哪個 → 結果在哪 → 然後
 *   2. 在每個分頁的表頭加「備註」（滑鼠移到表頭右上角有黑色小三角的格子就會跳出來）：
 *      這欄填什麼、填了會怎樣、下一步
 *   3. 跳到「0-使用說明」分頁
 *
 * 為什麼用表頭備註、不在表格裡放一列範例：每支程式都是「第 2 列起每一列都是資料」，
 * 範例列會被當成真的資料拿去解析或監控。備註不佔列，程式完全看不到。
 *
 * 只寫「0-使用說明」分頁和表頭備註，其他任何格子都不動。可以重複按，每次都是覆蓋成最新版。
 * 還沒出現的分頁會跳過——那個分頁第一次被程式建出來之後，再按一次就會補上。
 */

const GUIDE_SHEET = '0-使用說明';
// 流程圖（給人看的完整版）。改版時重新發布同一個網址即可
const GUIDE_FLOW_URL = 'https://claude.ai/artifact/Ak6AfxZfsK1jAHN8vhDw7L';

// 每個分頁、每一欄的備註。key＝表頭文字（完全一致才會加）；
// 「3-貼上原文」三張表的表頭是一長串說明文字，改用 '#A' '#B' 這種欄位字母指定。
const GUIDE_NOTES = {
  '1-監控清單': {
    'url': '填：要盯的官網網址\n→ 每次「① 查官網變動」都會抓這頁跟上次比',
    'card_id': '填：單卡頁填 Cards Data 的正式 id（如 esun-kumamon）\n多卡公告頁留空\n→ 變動通知靠它知道是哪張卡',
    'bank': '填：銀行名\n多卡頁一定要填（通知信靠它認人）',
    'watch_type': '填：card＝單卡權益頁、bank＝多卡公告頁\n留空＝程式依 card_id 自動判斷',
    'cards': '選填：多卡頁涵蓋哪幾張卡，填正式 id，逗號分隔\n例：febank-jaccard,febank-giftcard',
    'active': '填：TRUE＝要監控、FALSE＝暫停',
    'fetch_via': '留空＝直接抓\n抓回來是空殼或缺內容 → 填 jina',
    'keywords': '選填：這頁專用的關鍵字，逗號分隔\n公告頁填卡名，例：永豐SPORT卡,幣倍',
    'min_diff_chars': '選填：變動少於幾個字就不通知（預設 30）\n公告標題頁建議填 10',
    'check_days': '選填：最少隔幾天才抓一次\n走 jina 的列建議填 7（省額度）',
    'last_snapshot': '程式填的上次內容，不要動',
    'last_checked': '程式填的上次檢查時間，不要動'
  },

  '2-變動通知': {
    '實質變動': '程式填\n是＝回饋可能變了，優先看',
    '所屬活動': '程式填：這次變動在官網哪一檔活動底下',
    'AI摘要': '程式填：第一行是重點，第二行起是具體名單或條件\n信心「低」的要回官網確認',
    '信心': '程式填：低＝AI 沒把握，回官網看一眼',
    '狀態': '程式填「待解析」\n按「AI 拆新戶活動：變動通知裡的」之後變「已解析」\n清空這格可以重跑',
    '公開摘要': '給用戶看的一句話（60 字內）\n程式先放 AI 摘要第一行，改成白話後\n→ 在「公開／封存／刪除」打「公開」',
    '公開卡片': '這則異動要顯示在哪幾張卡的詳情頁\n填正式 id，逗號分隔（程式已先填好）',
    '公開／封存／刪除': '打字決定這列怎麼處理，留空＝還沒決定：\n・公開 → 發到網站「近期異動」\n・封存 → 搬到「2-封存（變動通知）」\n・刪除 → 刪掉（會再問一次）\n\n下一步：按「② 處理變動通知」\n公開的要等下次「匯出 JSON」才上網站',
    // 舊欄名（2026-08-15 前叫「公開」）：還沒改名的分頁也看得到說明
    '公開': '打字決定這列怎麼處理，留空＝還沒決定：\n・公開 → 發到網站「近期異動」\n・封存 → 搬到「2-封存（變動通知）」\n・刪除 → 刪掉（會再問一次）\n\n下一步：按「② 處理變動通知」',
    '寫入活動': '這列的活動要寫進卡片資料 → 打 V\n\n下一步：按「AI 拆卡片活動」\n→ 結果在「4-待審核（活動更新）」\n→ 這格自動變「已解析」\n\n多卡公告頁會失敗：把「公開卡片」改成要寫的那一張 id 再打 V',
    '變動段落': '程式存的：這次多了(＋)、少了(－)哪些字',
    '舊文字': '程式存的上一版官網全文（查證用）',
    '新文字': '程式存的這一版官網全文（查證用）'
  },

  '3-貼上原文（卡片活動）': {
    '#A': '貼：已上線卡片的活動原文\n只貼你要寫的那幾檔，不用整頁\n一列＝一張卡\n\n原文就在 2-變動通知 的話，直接在那列「寫入活動」打 V 比較快',
    '#B': '必填：Cards Data 裡的 card_id\n例：esun-kumamon',
    '#C': '選填：來源網址',
    '#D': '程式填：已解析／失敗＋原因\n下一步：到「4-待審核（活動更新）」\n清空這格可以重跑'
  },
  '3-貼上原文（新戶活動）': {
    '#A': '貼：新戶／首刷活動原文\n一列＝一段原文，可以一次貼很多列',
    '#B': '選填：card_id（如 esun-kumamon）\n多卡頁可填多個，逗號分隔\n打錯字會直接失敗；不確定就留空，AI 會自己判斷',
    '#C': '選填：來源網址',
    '#D': '程式填：已解析／失敗＋原因\n下一步：到「4-待審核（新戶活動）」\n清空這格可以重跑'
  },
  '3-貼上原文（新卡）': {
    '#A': '貼：還沒上線的新卡，整頁權益原文\n一列＝一張卡',
    '#B': '選填：想用的 id（如 fubon-jcard）\n留空 AI 會自己擬',
    '#C': '選填：官網網址',
    '#D': '選填：一般消費／排除說明頁的原文\n用來判斷一般消費有沒有排除廣告',
    '#E': '程式填：已解析／失敗＋原因\n下一步：到「4-待審核（新卡-基本）」和「（新卡-組別）」\n清空這格可以重跑'
  },

  '4-待審核（活動更新）': {
    '核准': '你把這列貼進 Cards Data 之後打 V\n（只是給你自己看的記號，程式不讀）',
    '建議槽位N': '要貼到 Cards Data 的哪個 rate_N',
    '回饋組成原文': '這組回饋怎麼組成（官網原句），先看這欄理解結構',
    'rate': '從這欄到 hideInDisplay 整段複製\n→ 貼到 Cards Data 該卡的 rate_N 那一格開始',
    'cashbackModel': '黃底＝要你手填，看同列「程式備註」的候選',
    'needs_review': 'TRUE＝AI 沒把握，看「AI想問的問題」',
    '疑似對應槽位': '・對應既有 rate_N → 覆蓋那一槽\n・新增 → 貼到建議的空槽\n・基本欄位（藍底）→ 改 Cards Data 的那一欄，不是槽位\n・同現值（灰底）→ 不用動'
  },
  '4-待審核（新卡-組別）': {
    '核准': '你把這列貼進 Cards Data 之後打 V\n（只是給你自己看的記號，程式不讀）',
    '建議槽位N': '要貼到 Cards Data 的哪個 rate_N',
    '回饋組成原文': '這組回饋怎麼組成（官網原句），先看這欄理解結構',
    'rate': '從這欄到 hideInDisplay 整段複製\n→ 貼到 Cards Data 這張卡的 rate_N 那一格開始',
    'cashbackModel': '黃底＝要你手填，看同列「程式備註」的候選',
    'needs_review': 'TRUE＝AI 沒把握，看「AI想問的問題」'
  },
  '4-待審核（新卡-基本）': {
    '核准': '你把這列貼進 Cards Data 之後打 V\n（只是給你自己看的記號，程式不讀）',
    'id': '從這欄到 airport_lounge 整段複製\n→ 貼到 Cards Data 新的一列',
    'levelSettings': '分級卡要手填（程式只填得出最簡單的分級）',
    'needs_review': 'TRUE＝AI 沒把握，看「AI想問的問題」'
  },
  '4-待審核（新戶活動）': {
    '核准': '你把這列貼進正式新戶活動表之後打 V\n（只是給你自己看的記號，程式不讀）',
    'id': '從這欄到最後整段複製\n→ 貼到 PMC 管理系統的新戶活動表',
    'needs_review': 'TRUE＝AI 沒把握，看「AI想問的問題」'
  }
};

// 「0-使用說明」分頁的主表：一列＝一件你想做的事
const GUIDE_TASKS = [
  ['我想…', '先在哪裡做', '按選單', '結果在哪', '然後'],
  ['看官網有沒有變',
    '不用做（每天自動跑）',
    '① 查官網變動（想馬上看才按）',
    '2-變動通知＋Email',
    '讀 AI摘要，決定這列要公開、寫入卡片，還是收掉'],
  ['讓用戶看到某個異動',
    '2-變動通知：「公開摘要」改成一句白話，「公開／封存／刪除」打「公開」',
    '② 處理變動通知',
    'PMC 管理系統的「變動紀錄」',
    '下次「匯出 JSON」後出現在網站卡片詳情頁'],
  ['收掉處理完的列',
    '2-變動通知：「公開／封存／刪除」打「封存」或「刪除」',
    '② 處理變動通知',
    '2-封存（變動通知）',
    '—'],
  ['把既有卡的活動寫進卡片資料',
    '2-變動通知：該列「寫入活動」打 V\n（原文不在監控頁 → 3-貼上原文（卡片活動）貼原文＋card_id）',
    'AI 拆卡片活動',
    '4-待審核（活動更新）',
    '看「疑似對應槽位」，把 rate→hideInDisplay 貼進 Cards Data，核准打 V'],
  ['寫新戶活動（監控抓到的）',
    '不用做（狀態「待解析」的列會被處理）',
    'AI 拆新戶活動：變動通知裡的',
    '4-待審核（新戶活動）',
    '從 id 到最後貼進新戶活動表，核准打 V'],
  ['寫新戶活動（自己找到的）',
    '3-貼上原文（新戶活動）：A 貼原文，B 填 card_id（選填）',
    'AI 拆新戶活動：我貼的',
    '4-待審核（新戶活動）',
    '同上'],
  ['加一張新卡',
    '3-貼上原文（新卡）：A 貼整頁權益原文',
    'AI 拆新卡：我貼的',
    '4-待審核（新卡-基本）＋（新卡-組別）',
    '基本那列貼成 Cards Data 新的一列；組別逐列貼進 rate_N']
];

function openSheetGuide() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const noted = applyGuideNotes_(ss);
  const sheet = writeGuideSheet_(ss);
  ss.setActiveSheet(sheet);
  ss.toast('已更新 ' + noted + ' 個分頁的表頭說明（滑鼠移到表頭就看得到）', '📖 使用說明', 6);
}

// 表頭備註：一張表一次 setNotes 整列，不逐格呼叫（快、也不會撞執行時間上限）
function applyGuideNotes_(ss) {
  let count = 0;
  Object.keys(GUIDE_NOTES).forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet || sheet.getLastColumn() < 1) return;
    const width = sheet.getLastColumn();
    const range = sheet.getRange(1, 1, 1, width);
    const headers = range.getValues()[0].map(function (h) { return String(h).trim(); });
    const notes = range.getNotes()[0].slice();
    let changed = false;
    const spec = GUIDE_NOTES[name];
    Object.keys(spec).forEach(function (key) {
      const at = key.charAt(0) === '#'
        ? key.charCodeAt(1) - 65                       // '#A' → 0
        : headers.indexOf(key);
      if (at < 0 || at >= width) return;              // 這張表沒有這欄：跳過
      notes[at] = spec[key];
      changed = true;
    });
    if (changed) { range.setNotes([notes]); count++; }
  });
  return count;
}

function writeGuideSheet_(ss) {
  let sheet = ss.getSheetByName(GUIDE_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(GUIDE_SHEET, 0);   // 放最前面
  }
  sheet.clear();

  sheet.getRange('A1').setValue('PMC 資料自動化：怎麼用').setFontSize(16).setFontWeight('bold');
  sheet.getRange('A2').setValue('完整流程圖（有圖）：' + GUIDE_FLOW_URL);
  sheet.getRange('A3').setValue('每個分頁的表頭都有說明：滑鼠移到表頭（右上角有黑色小三角的格子），就會跳出「填什麼、填了會怎樣、下一步」。');

  const top = 5;
  const table = sheet.getRange(top, 1, GUIDE_TASKS.length, GUIDE_TASKS[0].length);
  table.setValues(GUIDE_TASKS).setWrap(true).setVerticalAlignment('top');
  sheet.getRange(top, 1, 1, GUIDE_TASKS[0].length)
    .setFontWeight('bold').setBackground('#e8eaed');
  sheet.getRange(top + 1, 1, GUIDE_TASKS.length - 1, 1).setFontWeight('bold');
  sheet.getRange(top + 1, 3, GUIDE_TASKS.length - 1, 1).setBackground('#e6f4ea');   // 按選單那欄：綠底好找

  let r = top + GUIDE_TASKS.length + 1;
  const extra = [
    ['記住三件事'],
    ['1. 程式只會寫進「4-待審核」，正式的 Cards Data 和新戶活動表永遠是你自己貼。'],
    ['2. 狀態格寫「已解析」的列不會重跑；要重跑就把那格清空。'],
    ['3. 新分頁第一次出現後，再按一次「📖 使用說明」，那個分頁的表頭說明就會補上。'],
    [''],
    ['不常用的按鈕都在「其他工具」裡：檢查監控清單、檢查廣告排除（每月）、登錄連結 1~4。']
  ];
  sheet.getRange(r, 1, extra.length, 1).setValues(extra);
  sheet.getRange(r, 1).setFontWeight('bold');

  [180, 320, 220, 220, 340].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setFrozenRows(0);
  return sheet;
}
