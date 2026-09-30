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
 *   ・正式 Cards Data 的 basicExclusions **已經有值的卡直接跳過**（站長手填的就是答案，不重抽）
 *   ・命名一致（2026-09-30 站長要求：同一個東西不同銀行要寫成同一個字）：
 *     「既有名稱表」＝正式表已填的名單＋待審核表已核准的列＋站長手寫的範例答案，送給 AI 要求同義逐字沿用，
 *     AI 回來後再用 basicExNormKey_() 機械對一次（大小寫／全半形／空白／括號不同的寫法收斂成既有寫法）
 *   ・站長手寫的台新答案（BASICEX_EXAMPLE）當成 few-shot 範例放進 prompt——示範「以使用者會輸入的字來寫、
 *     舉例要拆開列、被例外救回的卡要拿掉」這些光靠規則講不清楚的寫法
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

// 站長親手寫的標準答案（2026-09-30），當 few-shot 範例＋既有名稱表的種子。
// source 只取台新「權益不回饋項目」頁的排除表與例外表（整頁快照含大量選單雜訊，放進來只會浪費額度）。
// 答案是 taishin-richart 的：7-11、全家（台新Pay 綁 Richart 仍有回饋）與部分歐洲國家（Richart 例外有回饋）都已拿掉。
// ⚠️ 改答案寫法＝改所有銀行的命名基準，改之前想清楚；想加範例就再開一個常數，不要把這份改成別張卡的
const BASICEX_EXAMPLE = {
  card: 'taishin-richart',
  source: '信用卡權益不回饋消費項目 不回饋消費項目 說明(使用各種支付方式皆不提供回饋) ' +
    '媒體服務 YouTube、Spotify、TikTok 抖音、Apple媒體服務(即消費明細含「APPLE.COM/BILL或APPLE COM BILL」者，例如：iTunes、iCloud、App Store..等)、' +
    'Google產品或服務(即消費明細含「Google」者，例如：Google Play、Google Drive..等)。 ' +
    '部分歐洲國家實體商店交易 包含奧地利、比利時…英國、冰島、列支敦斯登及挪威等國家實體商店之消費。 ' +
    '境外投資平台交易 eToro或相類似境外投資交易平台。 博奕類交易 博奕類交易不回饋，包含賭博、賭場消費、賭博籌碼等。 ' +
    '分期交易 特約商店分期付款交易及單筆消費分期0利率之交易。 加值服務 儲值卡(如悠遊卡/icash卡/一卡通)自動加值、Samsung Pay悠遊卡加值。 ' +
    '指定量販店、超商消費 大全聯、全聯福利中心及便利商店(7-11/全家/萊爾富/OK超商等)消費，包含線上購物和各種支付方式。 ' +
    '各項代扣繳費用 含水費/電費/瓦斯費、電信費、eTag自動儲值、學費等。 指定保費 躉繳保費、投資型保費、三商美邦保費、彈性繳保費。 ' +
    '醫藥交易 臺北醫學大學附設醫院費用。 停車費 各縣市路邊停車費。 ' +
    '各繳費平台交易 包含但不限於線上支付/臨櫃繳款，如 e-Bill 全國繳費 / i 繳費 / 醫指付 / 電子化繳費稅處理平台(含電信費、醫療院所費用、社區管理費等) / ' +
    '公務機關暨醫療院所信用卡繳費平臺 / 台新繳費中心(含台新繳費中心網頁/Richart Life APP/Richart APP/行動銀行等通路)等)繳納之各項費用。 ' +
    '聯合信用卡處理中心交易 透過「聯合信用卡處理中心」提供之信用卡小額支付特約商店之消費(如停車場/麥當勞等同性質連鎖速食店等)。 ' +
    '規費、罰鍰 政府規費、違規罰鍰。 預借現金及其手續費、代償他行卡金額 含預借現金及其手續費、預借現金分期金及其手續費、代償他行信用卡/現金卡/小額信貸等之金額。 ' +
    '稅費 個人綜合所得稅、所得稅分期付款期金及其手續費、查核定稅(房屋稅/地價稅/牌照稅等)、公路養管費(原燃料費)。 ' +
    '其他 違約金、循環利息、基金交易及其手續費、信用卡年費及一般信用卡相關手續費(如掛失手續費/調閱簽單手續費等)。 ' +
    '【例外】指定卡別消費例外回饋項目 例外回饋項目 例外回饋卡別(有回饋的卡別) ' +
    '部分歐洲國家實體交易 台新Richart卡、卓富無限卡、環球無限卡…。 ' +
    'Apple媒體服務 以街口支付綁定街口聯名卡付款屬一般消費享1%回饋無上限；其他支付方式不回饋。 ' +
    '電信代扣繳 環球無限卡、遠傳friDay聯名卡。 ' +
    '量販店、便利商店消費 1. 於街口支付APP綁定街口聯名卡之掃碼消費類型，仍享有街口幣回饋。 ' +
    '2. 於7-11及全家以台新Pay綁定台新 Richart卡消費，並切換「Pay著刷」或「天天刷」方案仍享有台新Point(信用卡)回饋，其他方式不回饋。 ' +
    '3. 於大全聯店內使用大全聯實體信用卡或全支付綁定信用卡消費，仍享有福利點回饋。 ' +
    '學費 環球無限卡、台新商務卡。 水/電/瓦斯費代扣繳、eTag自動儲值 環球無限卡',
  answer: [
    'YouTube', 'Spotify', 'TikTok 抖音', 'Apple媒體服務', 'iTunes', 'iCloud', 'App Store',
    'Google Play', 'Google Drive', 'Google產品或服務', 'eToro',
    '悠遊卡自動加值', 'icash卡自動加值', '一卡通自動加值', 'Samsung Pay悠遊卡加值',
    '大全聯', '全聯福利中心', '萊爾富', 'OK超商',
    '水費', '電費', '瓦斯費', '電信費', 'eTag自動儲值', '學費',
    '躉繳保費', '投資型保費', '三商美邦保費', '彈性繳保費',
    '臺北醫學大學附設醫院費用', '路邊停車費',
    'e-Bill全國繳費', 'i繳費', '醫指付', '電子化繳費稅處理平台', '醫療院所費用', '社區管理費',
    '公務機關暨醫療院所信用卡繳費平臺', '台新繳費中心網頁繳費', 'Richart Life APP繳費', 'Richart APP繳費', '行動銀行繳費',
    '小額支付平台', '麥當勞', '政府規費', '違規罰鍰',
    '預借現金及其手續費', '預借現金分期金及其手續費', '代償他行信用卡/現金卡/小額信貸',
    '個人綜合所得稅', '所得稅分期付款期金及其手續費', '房屋稅', '地價稅', '牌照稅', '公路養管費(原燃料費)',
    '違約金', '循環利息', '基金交易及其手續費', '信用卡年費', '一般信用卡相關手續費'
  ]
};

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
  const filled = basicExReadFilledCards_();              // 正式表已經有名單的卡 → 不重抽
  const vocab = basicExBuildVocabulary_(filled, review);  // 命名一致用的既有名稱表

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
    const already = candidates.filter(function (x) { return filled.ids[x]; });
    const open = candidates.filter(function (x) { return !filled.ids[x]; });
    if (already.length) skipped.push(label + '：正式表已有名單、不重抽：' + already.join(','));
    if (open.length === 0) continue;

    todo.push({ url: url, bank: bank, label: label, text: snap, candidates: open });
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
      const groups = basicExAskGemini_(t.bank, t.text.slice(0, BASICEX_CONFIG.maxSnapshotChars), t.candidates, vocab);
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
function basicExAskGemini_(bank, text, candidates, vocab) {
  const systemPrompt = [
    '你是台灣信用卡條款的閱讀助理。輸入是某銀行信用卡官網頁面的純文字（可能含選單等雜訊）。',
    '任務：找出「不列入一般消費／不給任何刷卡回饋」的項目（常見標題：一般消費定義、不回饋消費項目、',
    '一般消費不包含、排除項目），整理成比價網站用的名單：使用者在搜尋框輸入名單上的字時，網站會告訴他「刷這張卡沒有回饋」。',
    '',
    '寫法規則（最重要的是第 1、2 條，請仔細看最後的範例）：',
    '1. 以「使用者會在搜尋框輸入的字」來寫：商家名、服務名、繳費項目名。使用者會直接打 iTunes，不會打「Apple媒體服務」。',
    '2. 原文有舉例（如…／例如…／含…／括號列舉）時，每個例子各自獨立成一項，並保留類別名本身。',
    '   例：「Apple媒體服務(例如iTunes、iCloud、App Store)」→ Apple媒體服務、iTunes、iCloud、App Store。',
    '3. 一句話涵蓋多個品牌或多種稅費時，各自具名：「儲值卡(悠遊卡/icash卡/一卡通)自動加值」→ 悠遊卡自動加值、',
    '   icash卡自動加值、一卡通自動加值；「查核定稅(房屋稅/地價稅/牌照稅)」→ 房屋稅、地價稅、牌照稅；各繳費平台逐一列名。',
    '4. 保留限定詞，絕不可去掉限定詞擴大範圍：「躉繳保費」不可寫成「保費」、「超商代收」不可寫成「超商」、',
    '   「路邊停車費」不可寫成「停車費」。',
    '5. 不列「地區型」「交易方式型」的排除（例：部分歐洲國家實體商店、特約商店分期付款、單筆分期0利率、博奕類交易）',
    '   ——那些不是使用者會搜尋的商家或繳費項目。',
    '6. 例外：頁面常有「例外回饋項目／有回饋的卡別」或「但…除外」。某項目對某張候選卡有例外回饋（任何條件下仍有回饋），',
    '   就不要放進那張卡的 items；只救回其中一部分時，只拿掉被救回的那部分（例：台新 Richart 用台新Pay 在 7-11、全家仍有回饋',
    '   → Richart 不列 7-11、全家，但大全聯、全聯福利中心、萊爾富、OK超商 照列）。因此不同卡可能要分成不同 group。',
    '   例外內容與你的處理方式寫進 review_question。',
    '7. 只列「完全沒有回饋」的項目。只是「不適用加碼、仍有基本回饋」的不要列（寫進 review_question 讓人判斷）。',
    '8. 名稱一致：使用者訊息裡有「既有名稱表」，意思相同的項目必須逐字沿用表中的寫法，不可自創同義詞。',
    '9. 不要輸出單一個字（如「稅」）、不要以「等」結尾、不要輸出「經本行認定之其他交易」這類對不到具體項目的概括條款。',
    '10. 頁面分卡別列不同名單就分成多個 group，每組 card_ids 只放適用的卡；同一份名單適用全部候選卡就一組。',
    '    card_ids 只能從候選清單挑。頁面找不到任何排除條款（快照只抓到選單、內容是別的活動）→ groups 回空陣列。',
    '11. evidence 貼原文中排除條款的那一段（原樣摘錄，200 字內）。沒把握就 needs_review=true 並寫出問題。',
    '',
    '【範例】（站長親手寫的標準答案，寫法以此為準）',
    '卡片：' + BASICEX_EXAMPLE.card,
    '原文：' + BASICEX_EXAMPLE.source,
    '答案 items：' + BASICEX_EXAMPLE.answer.join(',')
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
    '\n\n既有名稱表（意思相同就逐字沿用這裡的寫法）：\n' + vocab.names.join(',') +
    '\n\n以下是官網頁面文字：\n\n' + text;
  const result = callGemini_(systemPrompt, userText, schema);
  const groups = (result && result.groups) || [];

  // 機械清洗：不在候選裡的 id 丟掉（enum 已鎖，這是第二道）、去掉結尾的「等」、
  // 對到既有名稱表的換成既有寫法、去重、丟掉少於 2 字的
  return groups.map(function (g) {
    const ids = (g.card_ids || []).filter(function (x) { return candidates.indexOf(x) >= 0; });
    const seen = {};
    const items = [];
    (g.items || []).forEach(function (s) {
      let t = String(s || '').trim().replace(/[,，、]/g, ' ').trim();
      if (t.length > 2) t = t.replace(/等$/, '');
      const key = basicExNormKey_(t);
      if (vocab.byKey[key]) t = vocab.byKey[key];
      if (t.length < 2 || seen[key]) return;
      seen[key] = true;
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
      rows.push(['', now, id, page.bank, page.url, g.items.join(','),
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
    plan.push({ id: id, cardRow: r + 1, value: entry.items.join(','), count: entry.items.length,
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

/************** 正式表已有名單的卡＋命名一致用的既有名稱表 **************/
// 跨檔唯讀正式 Cards Data 的 basicExclusions 欄。欄不存在就當作全部沒填（抽取照跑，寫回時才會要求建欄）
function basicExReadFilledCards_() {
  const out = { ids: {}, names: [] };
  const sheet = getCardsSheet_();
  const data = sheet.getDataRange().getValues();
  const head = data[0].map(function (x) { return String(x).trim(); });
  const cId = head.indexOf('id');
  const cT = head.indexOf(BASICEX_CONFIG.targetHeader);
  if (cId < 0 || cT < 0) return out;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][cId] || '').trim();
    const items = basicExSplit_(data[i][cT]);
    if (!id || items.length === 0) continue;
    out.ids[id] = true;
    items.forEach(function (t) { out.names.push(t); });
  }
  return out;
}

// 既有名稱表：正式表（站長核可過）→ 待審核表已核准的列 → 站長範例答案，先出現的寫法為準。
// byKey：正規化鑰匙 → 標準寫法，AI 回來的項目用它機械收斂
function basicExBuildVocabulary_(filled, review) {
  const vocab = { names: [], byKey: {} };
  const add = function (t) {
    const name = String(t || '').trim();
    const key = basicExNormKey_(name);
    if (name.length < 2 || !key || vocab.byKey[key]) return;
    vocab.byKey[key] = name;
    vocab.names.push(name);
  };
  filled.names.forEach(add);
  const last = review.getLastRow();
  if (last >= 2) {
    const iApprove = BASICEX_REVIEW_HEADERS.indexOf('核准');
    const iItems = BASICEX_REVIEW_HEADERS.indexOf('basicExclusions');
    review.getRange(2, 1, last - 1, BASICEX_REVIEW_HEADERS.length).getValues().forEach(function (r) {
      const mark = String(r[iApprove] == null ? '' : r[iApprove]).trim();
      if (basicExIsChecked_(r[iApprove]) || mark.indexOf(BASICEX_CONFIG.appliedMark) === 0) {
        basicExSplit_(r[iItems]).forEach(add);
      }
    });
  }
  BASICEX_EXAMPLE.answer.forEach(add);
  return vocab;
}

// 比對用鑰匙：全形轉半形、小寫、去空白與常見標點。只用來判斷「是不是同一個寫法」，不改變顯示
function basicExNormKey_(s) {
  return String(s || '')
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .toLowerCase()
    .replace(/[\s　()（）·・.\-_]/g, '');
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
