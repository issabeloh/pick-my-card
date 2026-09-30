/**
 * PMC 資料自動化 —— 從監控快照抽「一般消費排除項目」（basicExclusions）
 * ============================================================
 * 這支住在「PMC 資料自動化」試算表，與 benefits-parser.gs / card-benefits-parser.gs /
 * register-link-finder.gs 同一個 Apps Script 專案，共用 callGemini_() / getCardsSheet_()，
 * 本檔不重複定義。（在 Apps Script 編輯器「＋ 檔案」新增指令碼，貼上本檔全文）
 *
 * 解決的問題：Cards Data 新增了 basicExclusions 欄（2026-09-30），前端搜尋走到「基本回饋」
 * fallback 時，命中排除名單的卡改成不顯示（實際刷下去是 0）。但 30 幾張卡的排除名單沒人要
 * 一張一張去官網抄——而「1-監控清單」早就把各銀行一般消費定義頁的全文存在 last_snapshot 了。
 *
 * ── 兩階段 ──────────────────────────────────────────────────
 * 【① 抽取】extractBasicExclusionsFromSnapshots
 *   讀「1-監控清單」中 keywords 看起來是一般消費/排除頁的列（BASICEX_CONFIG.rowKeywordRe），
 *   把 last_snapshot 交給 Gemini 抽出排除項目，**一張卡一列**寫進「5-待審核（一般消費排除）」。
 *   ・候選卡片＝該列的 card_id ＋ cards 欄；AI 只能從候選裡挑（JSON Schema enum 鎖死）
 *   ・已經在待審核表出現過的網址自動跳過（一次跑不完就再按一次接著跑；要重抽某頁就把
 *     待審核表裡那個網址的列刪掉）
 *   ・完全不發網路請求去官網，只讀快照；**1-監控清單 只讀不寫**
 *
 * 【② 寫回】applyBasicExclusionsToCardsData
 *   在待審核表的「核准」欄打 V（可先改 basicExclusions 那格），這支把同一張卡所有打 V 的列
 *   合併去重後，寫進正式 Cards Data 的 basicExclusions 欄。
 *   ⚠️ 安全底線：
 *     - **只寫 basicExclusions 這一欄**，每一格寫入前過 basicExAssertCol_() 驗欄名
 *     - **只寫空白格**：正式表那格已經有值就跳過、列在結果裡（這支的用途是「初次建立」；
 *       之後要更新某張卡，把正式表那格清空再寫回，或直接手改——不會蓋掉你手改過的名單）
 *     - 寫之前跳確認視窗；寫成功才在待審核表蓋「已寫回」章，再按一次不會重複寫
 *
 * 寫完之後：資料檔選單「🎯 卡片管理 → 匯出」，網站才會吃到新名單。
 */

/************** 設定區 **************/
const BASICEX_CONFIG = {
  watchlistSheet: '1-監控清單',
  reviewSheet: '5-待審核（一般消費排除）',
  targetHeader: 'basicExclusions',        // 正式 Cards Data 要寫的欄（唯一允許寫入的欄）
  appliedMark: '已寫回',                   // 寫回成功後把 V 換成這個＋時間戳
  // 哪些監控列算「一般消費/排除頁」：比對該列的 keywords 欄（截圖裡是「一般消費」「不回饋消費項目」
  // 「一般消費項目排除」…）。keywords 空白的列（單卡權益頁、公告頁）不處理。
  rowKeywordRe: /一般消費|排除|不回饋|不計入|不適用回饋/,
  maxSnapshotChars: 30000,                 // 單頁送給 AI 的快照上限
  maxRowsPerRun: 8,                        // 一次最多處理幾個監控列（真正的煞車是下一行）
  maxRunSeconds: 240,                      // Apps Script 單次硬上限 6 分鐘，超過這個秒數就不開新的一列
  colorReview: '#fff3cd'                   // AI 有疑問的列標黃
};

const BASICEX_REVIEW_HEADERS = [
  '核准', '解析時間', 'card_id', 'bank', '來源網址',
  'basicExclusions', 'AI想問的問題', '原文引用'
];

/************** ① 抽取：1-監控清單 last_snapshot → 5-待審核 **************/
function extractBasicExclusionsFromSnapshots() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const watch = ss.getSheetByName(BASICEX_CONFIG.watchlistSheet);
  if (!watch) { ui.alert('找不到「' + BASICEX_CONFIG.watchlistSheet + '」。'); return; }

  const data = watch.getDataRange().getValues();
  const h = data[0].map(function (x) { return String(x).trim(); });
  const c = function (name) { return h.indexOf(name); };
  const cUrl = c('url'), cSnap = c('last_snapshot'), cId = c('card_id'), cCards = c('cards');
  const cBank = c('bank'), cKw = c('keywords'), cActive = c('active');
  if (cUrl < 0 || cSnap < 0 || cKw < 0) {
    ui.alert('「' + BASICEX_CONFIG.watchlistSheet + '」第一列要有 url、last_snapshot、keywords 表頭。');
    return;
  }

  const validIds = getCardIds_();   // 正式 Cards Data 的合法 id（跨檔唯讀）
  const review = basicExEnsureReviewSheet_(ss);
  const doneUrls = basicExReviewedUrls_(review);

  const todo = [];
  const skipped = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const url = String(row[cUrl] || '').trim();
    const kw = String(row[cKw] || '').trim();
    if (!url || !BASICEX_CONFIG.rowKeywordRe.test(kw)) continue;
    if (cActive >= 0 && String(row[cActive]).trim().toUpperCase() === 'FALSE') continue;
    if (doneUrls[url]) continue;

    const bank = cBank >= 0 ? String(row[cBank] || '').trim() : '';
    const label = (bank || '第 ' + (i + 1) + ' 列');
    const snap = String(row[cSnap] || '').trim();
    if (snap.length < 100) { skipped.push(label + '：last_snapshot 是空的或太短'); continue; }

    const ids = [];
    if (cId >= 0) basicExSplit_(row[cId]).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
    if (cCards >= 0) basicExSplit_(row[cCards]).forEach(function (x) { if (ids.indexOf(x) < 0) ids.push(x); });
    const candidates = ids.filter(function (x) { return validIds.indexOf(x) >= 0; });
    const unknown = ids.filter(function (x) { return validIds.indexOf(x) < 0; });
    if (unknown.length) skipped.push(label + '：這些 id 在 Cards Data 找不到，已忽略：' + unknown.join('、'));
    if (candidates.length === 0) { skipped.push(label + '：card_id／cards 欄沒有合法的卡片 id'); continue; }

    todo.push({ url: url, bank: bank, label: label, text: snap, candidates: candidates });
  }

  if (todo.length === 0) {
    ui.alert(['沒有要處理的監控列（符合條件的網址都已在「' + BASICEX_CONFIG.reviewSheet + '」出現過）。',
      '要重抽某一頁：把待審核表裡那個網址的列刪掉再按一次。',
      skipped.length ? '\n略過：\n・' + skipped.join('\n・') : ''].join('\n'));
    return;
  }

  const started = Date.now();
  let pagesDone = 0, rowsWritten = 0;
  const errors = [];
  for (let k = 0; k < todo.length && pagesDone < BASICEX_CONFIG.maxRowsPerRun; k++) {
    if ((Date.now() - started) / 1000 > BASICEX_CONFIG.maxRunSeconds) break;
    const t = todo[k];
    try {
      const groups = basicExAskGemini_(t.bank, t.text.slice(0, BASICEX_CONFIG.maxSnapshotChars), t.candidates);
      rowsWritten += basicExWriteReview_(review, t, groups);
    } catch (e) {
      errors.push(t.label + '：' + e.message);
    }
    pagesDone++;
  }

  const remaining = todo.length - pagesDone;
  ui.alert([
    '完成：處理 ' + pagesDone + ' 個頁面，寫入 ' + rowsWritten + ' 列到「' + BASICEX_CONFIG.reviewSheet + '」。',
    remaining > 0 ? '還剩 ' + remaining + ' 個頁面沒處理——再按一次選單會接著跑。' : '',
    errors.length ? '\n失敗（這幾頁沒寫入，下次會重試）：\n・' + errors.join('\n・') : '',
    skipped.length ? '\n略過：\n・' + skipped.join('\n・') : '',
    '\n👉 下一步：到待審核表逐列檢查 basicExclusions（可直接改那格），沒問題在「核准」打 V，',
    '   再按選單「② 寫回」。標黃的列是 AI 有疑問的，看「AI想問的問題」欄。'
  ].filter(function (x) { return x; }).join('\n'));
}

/************** 問 Gemini：這頁的一般消費排除項目 **************/
function basicExAskGemini_(bank, text, candidates) {
  const systemPrompt = [
    '你是台灣信用卡條款的閱讀助理。輸入是某銀行信用卡官網頁面的純文字（可能含選單等雜訊）。',
    '任務：找出「不列入一般消費／不給任何刷卡回饋」的交易類型（常見標題：一般消費定義、不回饋消費項目、',
    '一般消費不包含、排除項目），輸出成使用者會在搜尋框打的短詞，供比價網站判斷「刷這個沒有回饋」。',
    '',
    '輸出規則：',
    '1. 每個詞 2～10 個字，是使用者會搜尋的說法。例：繳稅、學費、保費、醫療費用、預借現金、',
    '   悠遊卡自動加值、電子票證加值、儲值、代收代付、手續費、年費、分期付款、循環信用利息。',
    '2. 概括類別要展開成常見的具體說法，並保留原說法。例：「公用事業費用（水、電、瓦斯、電信）」→',
    '   公用事業費用、水費、電費、瓦斯費、電信費；「各項稅款」→ 稅款、繳稅；「政府規費」→ 規費、罰鍰。',
    '3. 保留限定詞，不可把限定詞去掉而擴大範圍。例：「超商代收」就輸出「超商代收」，絕不可輸出「超商」；',
    '   「第三方支付儲值」不可輸出成「第三方支付」。',
    '4. 不要輸出單一個字（如「稅」）；不要輸出「經本行認定之其他交易」這類對不到具體項目的概括條款。',
    '5. 有「但…除外」「…不在此限」的例外時：被例外救回來的部分不要放進 items，把例外內容寫進 review_question。',
    '6. 只抽「完全沒有回饋」的排除。只是「不適用加碼、仍有基本回饋」的項目不要列（寫進 review_question 讓人判斷）。',
    '7. 頁面若分卡別列不同名單，就分成多個 group，每組 card_ids 只放適用的卡；同一份名單適用全部候選卡，',
    '   就一組、card_ids 放全部候選卡。card_ids 只能從候選清單挑。',
    '8. 頁面找不到任何排除條款（例如快照只抓到選單、或內容是別的活動）→ groups 回空陣列。',
    '9. evidence 貼原文中排除條款的那一段（原樣摘錄，200 字內）。沒把握就 needs_review=true 並寫出問題。'
  ].join('\n');

  const schema = {
    type: 'OBJECT',
    properties: {
      groups: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            card_ids: { type: 'ARRAY', items: { type: 'STRING', enum: candidates } },
            items: { type: 'ARRAY', items: { type: 'STRING' } },
            evidence: { type: 'STRING' },
            needs_review: { type: 'BOOLEAN' },
            review_question: { type: 'STRING' }
          },
          required: ['card_ids', 'items', 'evidence', 'needs_review']
        }
      }
    },
    required: ['groups']
  };

  const userText = '銀行：' + (bank || '（未填）') + '\n候選卡片 id：' + candidates.join(', ') +
    '\n\n以下是官網頁面文字：\n\n' + text;
  const result = callGemini_(systemPrompt, userText, schema);
  const groups = (result && result.groups) || [];

  // 機械清洗：不在候選裡的 id 丟掉（enum 已鎖，這是第二道）、項目去空白去重、丟掉少於 2 字的
  return groups.map(function (g) {
    const ids = (g.card_ids || []).filter(function (x) { return candidates.indexOf(x) >= 0; });
    const seen = {};
    const items = [];
    (g.items || []).forEach(function (s) {
      const t = String(s || '').trim();
      if (t.length < 2 || seen[t]) return;
      seen[t] = true;
      items.push(t);
    });
    return { card_ids: ids, items: items, evidence: g.evidence || '',
      needs_review: !!g.needs_review, review_question: g.review_question || '' };
  }).filter(function (g) { return g.card_ids.length > 0; });
}

/************** 寫待審核表（一張卡一列） **************/
function basicExWriteReview_(sheet, page, groups) {
  const now = new Date();
  const rows = [];
  const flags = [];
  const covered = {};
  groups.forEach(function (g) {
    g.card_ids.forEach(function (id) {
      covered[id] = true;
      rows.push(['', now, id, page.bank, page.url, g.items.join('、'),
        g.review_question, String(g.evidence).slice(0, 500)]);
      flags.push(g.needs_review || g.items.length === 0);
    });
  });
  // 候選卡 AI 一張都沒分到（或整頁找不到排除條款）→ 仍寫一列標黃，讓這個網址算「處理過」，
  // 也讓站長看得到「這頁抽不到東西」，而不是默默消失、每次按都重跑一次燒額度
  page.candidates.forEach(function (id) {
    if (covered[id]) return;
    rows.push(['', now, id, page.bank, page.url, '',
      'AI 在這頁沒找到適用這張卡的排除條款——快照可能只抓到選單，或排除名單在別頁', '']);
    flags.push(true);
  });
  if (rows.length === 0) return 0;

  const start = sheet.getLastRow() + 1;
  sheet.getRange(start, 1, rows.length, BASICEX_REVIEW_HEADERS.length).setValues(rows);
  flags.forEach(function (f, i) {
    if (f) sheet.getRange(start + i, 1, 1, BASICEX_REVIEW_HEADERS.length).setBackground(BASICEX_CONFIG.colorReview);
  });
  return rows.length;
}

function basicExEnsureReviewSheet_(ss) {
  let sheet = ss.getSheetByName(BASICEX_CONFIG.reviewSheet);
  if (!sheet) {
    sheet = ss.insertSheet(BASICEX_CONFIG.reviewSheet);
    sheet.getRange(1, 1, 1, BASICEX_REVIEW_HEADERS.length).setValues([BASICEX_REVIEW_HEADERS]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const cur = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(function (x) { return String(x).trim(); });
  if (cur.join('|') !== BASICEX_REVIEW_HEADERS.join('|')) {
    throw new Error('「' + BASICEX_CONFIG.reviewSheet + '」的表頭跟程式預期不同（欄位是依位置寫入的）。' +
      '請不要增刪或搬動欄位；要重建就把整個分頁刪掉再按一次。');
  }
  return sheet;
}

function basicExReviewedUrls_(sheet) {
  const map = {};
  const last = sheet.getLastRow();
  if (last < 2) return map;
  const col = BASICEX_REVIEW_HEADERS.indexOf('來源網址') + 1;
  sheet.getRange(2, col, last - 1, 1).getValues().forEach(function (r) {
    const u = String(r[0] || '').trim();
    if (u) map[u] = true;
  });
  return map;
}

/************** ② 寫回：5-待審核 打 V 的列 → 正式 Cards Data 的 basicExclusions 欄 **************/
function applyBasicExclusionsToCardsData() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const review = ss.getSheetByName(BASICEX_CONFIG.reviewSheet);
  if (!review) { ui.alert('找不到「' + BASICEX_CONFIG.reviewSheet + '」——先跑「① 抽取」。'); return; }
  basicExEnsureReviewSheet_(ss);   // 表頭驗證

  const rData = review.getDataRange().getValues();
  const iApprove = BASICEX_REVIEW_HEADERS.indexOf('核准');
  const iId = BASICEX_REVIEW_HEADERS.indexOf('card_id');
  const iItems = BASICEX_REVIEW_HEADERS.indexOf('basicExclusions');

  // 同一張卡可能有多列打 V（例如兩個頁面都列了它）→ 合併去重
  const byCard = {};      // id → { items: [], reviewRows: [] }
  for (let i = 1; i < rData.length; i++) {
    if (!basicExIsChecked_(rData[i][iApprove])) continue;
    const id = String(rData[i][iId] || '').trim();
    if (!id) continue;
    if (!byCard[id]) byCard[id] = { items: [], reviewRows: [] };
    byCard[id].reviewRows.push(i + 1);
    basicExSplit_(rData[i][iItems]).forEach(function (t) {
      if (t.length >= 2 && byCard[id].items.indexOf(t) < 0) byCard[id].items.push(t);
    });
  }

  const cardsSheet = getCardsSheet_();
  const cData = cardsSheet.getDataRange().getValues();
  const cHead = cData[0].map(function (x) { return String(x).trim(); });
  const cId = cHead.indexOf('id');
  const cTarget = cHead.indexOf(BASICEX_CONFIG.targetHeader);
  if (cId < 0) { ui.alert('正式 Cards Data 找不到 id 欄，中止。'); return; }
  if (cTarget < 0) {
    ui.alert('正式 Cards Data 還沒有「' + BASICEX_CONFIG.targetHeader + '」欄。\n' +
      '請先在 Cards Data 第一列找一個空欄，表頭打 ' + BASICEX_CONFIG.targetHeader + '（大小寫要一樣），再按一次。');
    return;
  }
  const rowById = {};
  for (let i = 1; i < cData.length; i++) {
    const id = String(cData[i][cId] || '').trim();
    if (id && rowById[id] === undefined) rowById[id] = i;
  }

  const plan = [];
  const problems = [];
  const alreadyFilled = [];
  Object.keys(byCard).forEach(function (id) {
    const entry = byCard[id];
    if (entry.items.length === 0) { problems.push(id + '：打了 V 但 basicExclusions 是空的，跳過'); return; }
    const r = rowById[id];
    if (r === undefined) { problems.push(id + '：正式 Cards Data 找不到這個 id，跳過'); return; }
    const existing = String(cData[r][cTarget] == null ? '' : cData[r][cTarget]).trim();
    if (existing) { alreadyFilled.push(id); return; }   // 只寫空白格：不蓋掉已有（可能手改過）的名單
    plan.push({ id: id, cardRow: r + 1, value: entry.items.join('、'), count: entry.items.length,
      reviewRows: entry.reviewRows });
  });

  if (plan.length === 0) {
    ui.alert([
      '沒有可以寫回的資料。',
      '請在「' + BASICEX_CONFIG.reviewSheet + '」的「核准」欄對確認過的列打 V。',
      alreadyFilled.length ? '\n正式表已經有值、刻意不覆蓋的卡（要重寫就先把正式表那格清空）：\n・' +
        alreadyFilled.join('、') : '',
      problems.length ? '\n問題：\n・' + problems.join('\n・') : ''
    ].filter(function (x) { return x; }).join('\n'));
    return;
  }

  const preview = plan.slice(0, 12).map(function (p) { return '・' + p.id + '（' + p.count + ' 項）'; }).join('\n');
  const answer = ui.alert('要寫回正式 Cards Data 嗎？',
    '將把 ' + plan.length + ' 張卡的一般消費排除項目寫進正式的「' + cardsSheet.getName() + '」。\n\n' +
    preview + (plan.length > 12 ? '\n…（其餘 ' + (plan.length - 12) + ' 張）' : '') +
    '\n\n只會寫 ' + BASICEX_CONFIG.targetHeader + ' 這一欄、而且只寫空白格，其他欄位一格都不會動。',
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) { ui.alert('已取消，正式表沒有任何變動。'); return; }

  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy/MM/dd HH:mm');
  let done = 0;
  plan.forEach(function (p) {
    basicExAssertCol_(cHead[cTarget]);   // 每一格寫入前最後一道確認
    cardsSheet.getRange(p.cardRow, cTarget + 1).setValue(p.value);
    // 寫成功才蓋章。沒蓋到＝沒寫成功，下次執行會重來
    p.reviewRows.forEach(function (rr) {
      review.getRange(rr, iApprove + 1).setValue(BASICEX_CONFIG.appliedMark + ' ' + stamp);
    });
    done++;
  });

  ui.alert([
    '完成：' + done + ' 張卡的 basicExclusions 已寫進正式 Cards Data。',
    alreadyFilled.length ? '\n正式表已有值、沒覆蓋：' + alreadyFilled.join('、') : '',
    problems.length ? '\n問題：\n・' + problems.join('\n・') : '',
    '\n👉 下一步：資料檔選單「🎯 卡片管理 → 匯出」，網站才會吃到新名單。',
    '   匯出後到網站搜「繳稅」之類的詞，確認排除的卡不再顯示基本回饋。'
  ].filter(function (x) { return x; }).join('\n'));
}

/************** 小工具 **************/
function basicExSplit_(raw) {
  return String(raw == null ? '' : raw)
    .split(/[,，、\n]/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s; });
}

// 「打勾了沒」：V／v／✓／✔／TRUE／1 都算；已經蓋過「已寫回」章的一律不算
function basicExIsChecked_(v) {
  if (v === true) return true;
  const s = String(v == null ? '' : v).trim();
  if (!s || s.indexOf(BASICEX_CONFIG.appliedMark) === 0) return false;
  return ['V', 'v', '✓', '✔', 'TRUE', 'true', '1', 'ｖ', 'Ｖ'].indexOf(s) >= 0;
}

// 寫入正式表前的最後一道鎖：目標欄名必須正好是 basicExclusions
function basicExAssertCol_(headerName) {
  if (String(headerName || '').trim() !== BASICEX_CONFIG.targetHeader) {
    throw new Error('安全檢查失敗：這支程式只允許寫入 ' + BASICEX_CONFIG.targetHeader +
      ' 欄，但拿到的欄名是「' + headerName + '」。已中止，正式表不會被改。');
  }
}
