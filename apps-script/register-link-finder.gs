/**
 * PMC 資料自動化 —— 找出「銀行官方登錄連結」（registerLink_N）
 * ============================================================
 * 這支住在「PMC 資料自動化」試算表，與 benefits-parser.gs / card-benefits-parser.gs
 * 同一個 Apps Script 專案，共用它們的 callGemini_() / getCardsSheet_()，本檔不重複定義。
 *
 * 解決的問題：Cards Data 新增了 registerLink_N 欄（2026-09-08），但既有 33 張卡、
 * 400 多個槽位沒有人要一格一格去官網找登錄頁網址；而且「哪些活動要登錄」本身就很難掃——
 * Cards Data 的槽位太多了。
 *
 * ── 兩階段，刻意分開 ────────────────────────────────────────────
 * 【第一階段】標出需登錄的活動（markRegisterSlotsInDraft）
 *   純機械、不呼叫 AI、不用額度、幾秒跑完全部卡片。
 *   站長寫 conditions_N 時本來就會寫「需登錄」「須當月登錄活動」「需登錄且限量」，
 *   所以「這個槽位要不要登錄」根本不用問 AI——比對「登錄」兩個字就好，而且 100% 準。
 *   ・黃底＝要登錄、還沒有連結（等你補）
 *   ・綠底＝要登錄、連結已經有了
 *   ・順手把 conditions_N 裡「已經寫在裡面」的登錄網址抓出來填進 registerLink_N
 *
 * 【第二階段】用監控快照找剩下的連結（fillRegisterLinksFromSnapshots）
 *   只處理第一階段標黃的槽位（要登錄、但沒有連結），拿「1-監控清單」的 last_snapshot
 *   問 Gemini。一次 maxCardsPerRun 張卡。第一階段沒標黃的槽位完全不會問 AI。
 *
 * ⚠️⚠️ 安全底線（這支會寫到「資料檔」，是全站資料的來源）：
 *   - **絕不寫正式的 Cards Data**。只寫 draftSheet（Cards Data 的完整複本），
 *     每個寫入點都先過 regLinkAssertDraft_()。站長複核後自己貼回去
 *   - **1-監控清單 只讀不寫**，完全不碰 last_snapshot
 *   - **AI 回的網址必須逐字出現在 snapshot 裡**才採用（regLinkVerifyInSnapshot_）。
 *     這是硬性機械檢查，不是靠 prompt 拜託——LLM 生一個「看起來很合理」的銀行網址
 *     是這個任務最可能出的錯，而錯的登錄連結會把用戶帶到 404，比沒有連結更糟
 *   - 只收 https 網址（沿用 card-benefits-parser.gs 的 normalizeRegisterLink_）
 *
 * ⚠️ 草稿分頁建在**資料檔**裡（跟 Cards Data 同一本），不是建在自動化檔。
 *    Apps Script 的 sheet.copyTo(ss) 本來就能跨檔複製，這裡是複製到來源自己那一本，
 *    連跨檔都不算——跨檔存取靠的是 getCardsSheet_() 的 CARDS_SPREADSHEET_ID，
 *    checkAdExclusionsForAllCards 早就在用同一條路。
 */

/************** 設定區 **************/
const REGLINK_CONFIG = {
  watchlistSheet: '1-監控清單',
  draftSheetName: 'Cards Data-登錄連結草稿',
  noteHeader: '登錄連結說明',
  aiStatusHeader: 'AI 搜尋狀態',
  maxCardsPerRun: 3,        // 第二階段一張卡＝一次 Gemini 呼叫。先設小值試水溫，順了再調大
  maxSnapshotChars: 40000,  // 單張卡送給 AI 的官網文字上限
  maxSlots: 22,             // Cards Data 的槽位上限（與 cards-export.gs 的迴圈一致）
  colorNeedLink: '#fff3cd', // 黃：要登錄、還沒有連結
  colorHasLink: '#d4edda'   // 綠：要登錄、連結已經有了
};

// 「這個槽位要登錄」的判斷：conditions 裡有「登錄」兩個字。
// ⚠️ 反向詞要先排除——「免登錄」「無需登錄」是「不用登錄」的意思，剛好相反。
const REGLINK_NEGATIVE_RE = /(免|不需|不用|無需|無須|毋須|毋需)登錄/;

/************** 第一階段：標出需登錄的活動（不呼叫 AI） **************/
function markRegisterSlotsInDraft() {
  const ui = SpreadsheetApp.getUi();
  const cardsSheet = getCardsSheet_();                 // benefits-parser.gs：資料檔的正式 Cards Data
  const draft = regLinkEnsureDraftSheet_(cardsSheet, ui);
  if (!draft) return;
  regLinkAssertDraft_(draft);

  const data = draft.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const idCol = headers.indexOf('id');
  const noteCol = headers.indexOf(REGLINK_CONFIG.noteHeader);
  if (idCol < 0 || noteCol < 0) {
    ui.alert('草稿分頁表頭不對（找不到 id 或「' + REGLINK_CONFIG.noteHeader +
      '」欄）——把草稿分頁刪掉重跑一次讓它重建。');
    return;
  }

  // 底色一次讀、一次寫（33 列 × 兩三百欄逐格 setBackground 會慢到爆）
  const backgrounds = draft.getRange(1, 1, data.length, headers.length).getBackgrounds();
  const notes = [];
  let cardsWithNeed = 0, needSlots = 0, extracted = 0;

  for (let i = 1; i < data.length; i++) {
    if (!String(data[i][idCol] || '').trim()) { notes.push([data[i][noteCol]]); continue; }

    const lines = [];
    let rowNeed = 0;

    for (let n = 1; n <= REGLINK_CONFIG.maxSlots; n++) {
      const condCol = headers.indexOf('conditions_' + n);
      const linkCol = headers.indexOf('registerLink_' + n);
      if (condCol < 0) continue;

      const conditions = String(data[i][condCol] || '').trim();
      if (!regLinkNeedsRegister_(conditions)) continue;

      rowNeed++;
      needSlots++;

      // conditions 裡可能已經寫了登錄網址（站長手寫的），直接撈出來用
      let link = linkCol >= 0 ? normalizeRegisterLink_(data[i][linkCol]) : '';
      let source = link ? '已填' : '';
      if (!link) {
        const inline = regLinkExtractFromConditions_(conditions);
        if (inline) {
          link = inline;
          source = '從 conditions 取得';
          extracted++;
          if (linkCol >= 0) {
            draft.getRange(i + 1, linkCol + 1).setValue(link);
            data[i][linkCol] = link;
          }
        }
      }

      const color = link ? REGLINK_CONFIG.colorHasLink : REGLINK_CONFIG.colorNeedLink;
      backgrounds[i][condCol] = color;
      if (linkCol >= 0) backgrounds[i][linkCol] = color;

      lines.push('槽 ' + n + '：' + regLinkSlotSummary_(headers, data[i], n) +
        (link ? '｜✅ ' + source + '：' + link : '｜⬜ 還沒有登錄連結'));
    }

    if (rowNeed) cardsWithNeed++;
    notes.push([lines.length ? lines.join('\n') : '（這張卡沒有任何 conditions 提到「登錄」）']);
  }

  draft.getRange(1, 1, data.length, headers.length).setBackgrounds(backgrounds);
  draft.getRange(2, noteCol + 1, notes.length, 1).setValues(notes).setWrap(true);

  ui.alert(
    '第一階段完成（沒有呼叫 AI、沒有用掉任何額度）\n\n' +
    '・' + cardsWithNeed + ' 張卡、共 ' + needSlots + ' 個槽位的 conditions 提到「登錄」\n' +
    '・其中 ' + extracted + ' 個的登錄網址本來就寫在 conditions 裡，已直接填進 registerLink_N\n\n' +
    '底色：黃＝要登錄但還沒有連結、綠＝連結已經有了。\n' +
    'conditions_N 與 registerLink_N 兩格都會上色，方便你橫向掃。\n' +
    '「' + REGLINK_CONFIG.noteHeader + '」欄逐槽位列出了回饋率／上限／適用通路。\n\n' +
    '接下來要讓 AI 去監控快照裡找剩下那些黃色的連結，按選單第二項。'
  );
}

// 「需要登錄」判斷：整串 conditions 是全形分號分隔的多個條件，逐條看——
// 「免登錄」那條要排除，但同一串裡別條寫「需登錄」時仍然算要登錄。
function regLinkNeedsRegister_(conditions) {
  if (!conditions) return false;
  return conditions.split(/[；;]/).some(function (clause) {
    return clause.indexOf('登錄') >= 0 && !REGLINK_NEGATIVE_RE.test(clause);
  });
}

// 從 conditions 撈出登錄網址。
// ⚠️ 不可以「看到 https 就抓」：實測 cards.data 裡三個帶網址的 conditions，其中兩個是
//    永豐的「指定店家清單 https://…」——那是通路清單頁，不是登錄頁，抓了就是錯的。
//    正確做法是逐條看：**同一條**條件裡同時有「登錄」與網址，才是登錄連結。
//    （兆豐 BT21 那條「需登錄（https://…）」就會正確命中。）
function regLinkExtractFromConditions_(conditions) {
  const clauses = String(conditions || '').split(/[；;]/);
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    if (clause.indexOf('登錄') < 0 || REGLINK_NEGATIVE_RE.test(clause)) continue;
    const m = clause.match(/https?:\/\/[^\s，。、；;）)】」\]]+/);
    if (m) {
      const url = normalizeRegisterLink_(m[0].replace(/[.,、。，]+$/, ''));
      if (url) return url;
    }
  }
  return '';
}

// 機械產生的活動摘要（回饋率／上限／適用通路／分類）。
// 刻意不問 AI：這四樣 Cards Data 裡本來就有，機械讀比 AI 轉述準。
// 官網的「活動名稱」不在 Cards Data 裡，那個由第二階段的 AI 補（找得到的話）。
function regLinkSlotSummary_(headers, row, n) {
  const get = function (name) {
    const c = headers.indexOf(name + '_' + n);
    return c < 0 ? '' : String(row[c] == null ? '' : row[c]).trim();
  };
  const rate = get('rate');
  const cap = get('cap');
  const items = get('items');
  const category = get('category');

  const itemList = items.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
  const itemText = itemList.length > 4
    ? itemList.slice(0, 4).join('、') + ' 等 ' + itemList.length + ' 個通路'
    : itemList.join('、');

  return [
    (rate ? rate + '% 回饋' : '(無回饋率)'),
    (cap ? '上限 NT$' + cap : '無上限'),
    (itemText ? '適用 ' + itemText : '(無適用通路)'),
    (category ? '分類：' + category : '')
  ].filter(function (x) { return x; }).join('，');
}

/************** 第二階段：用監控快照找剩下的連結（呼叫 AI） **************/
function fillRegisterLinksFromSnapshots() {
  const ui = SpreadsheetApp.getUi();
  const cardsSheet = getCardsSheet_();
  const dataFile = cardsSheet.getParent();

  const draft = dataFile.getSheetByName(REGLINK_CONFIG.draftSheetName);
  if (!draft) {
    ui.alert('還沒有草稿分頁——先按選單「標出需登錄的活動（不用 AI）」跑第一階段。');
    return;
  }
  regLinkAssertDraft_(draft);

  const snapshotsByCard = regLinkBuildSnapshotIndex_();
  if (Object.keys(snapshotsByCard).length === 0) {
    ui.alert('「' + REGLINK_CONFIG.watchlistSheet + '」裡沒有任何有 last_snapshot 的列——' +
      '先讓監控跑過一輪再來。');
    return;
  }

  const data = draft.getDataRange().getValues();
  const headers = data[0].map(function (h) { return String(h).trim(); });
  const idCol = headers.indexOf('id');
  const nameCol = headers.indexOf('name');
  const noteCol = headers.indexOf(REGLINK_CONFIG.noteHeader);
  const statusCol = headers.indexOf(REGLINK_CONFIG.aiStatusHeader);
  if (idCol < 0 || noteCol < 0 || statusCol < 0) {
    ui.alert('草稿分頁表頭不對——把草稿分頁刪掉重跑第一階段讓它重建。');
    return;
  }

  const backgrounds = draft.getRange(1, 1, data.length, headers.length).getBackgrounds();
  let processed = 0, skipped = 0, remaining = 0, found = 0, rejected = 0;
  const failures = [];

  for (let i = 1; i < data.length; i++) {
    const cardId = String(data[i][idCol] || '').trim();
    if (!cardId) continue;
    if (String(data[i][statusCol] || '').trim()) { skipped++; continue; }   // 這張卡跑過了

    // 只找「第一階段標黃的」——要登錄、但還沒有連結的槽位
    const pendingNumbers = regLinkPendingSlots_(headers, data[i]);
    if (pendingNumbers.length === 0) {
      draft.getRange(i + 1, statusCol + 1).setValue('不用問 AI（沒有缺連結的登錄槽位）');
      continue;
    }

    if (processed >= REGLINK_CONFIG.maxCardsPerRun) { remaining++; continue; }

    const snapshots = snapshotsByCard[cardId] || [];
    if (snapshots.length === 0) {
      draft.getRange(i + 1, statusCol + 1)
        .setValue('跳過：1-監控清單 裡沒有這張卡的 last_snapshot');
      processed++;
      continue;
    }

    const cardName = nameCol >= 0 ? String(data[i][nameCol] || '').trim() : cardId;
    let result;
    try {
      result = regLinkAskGemini_(cardName,
        regLinkPendingSlotDetails_(headers, data[i], pendingNumbers), snapshots);
    } catch (e) {
      failures.push(cardId + '：' + e.message);
      continue;   // 不寫狀態欄 → 下次執行會自動重試這張卡
    }

    const snapshotText = snapshots.map(function (s) { return s.text; }).join('\n');
    const addedLines = [];

    (result || []).forEach(function (item) {
      const slotN = parseInt(item.slot, 10);
      if (pendingNumbers.indexOf(slotN) < 0) return;   // AI 亂填不在清單裡的槽位 → 丟掉

      const link = normalizeRegisterLink_(item.register_link);
      if (!link) return;

      // ⚠️ 硬性檢查：網址必須逐字出現在官網原文裡
      if (!regLinkVerifyInSnapshot_(link, snapshotText)) {
        rejected++;
        addedLines.push('⚠️ 槽 ' + slotN + '：AI 給的網址不在官網原文裡，已丟棄（' +
          link.slice(0, 80) + '）');
        return;
      }

      const linkCol = headers.indexOf('registerLink_' + slotN);
      if (linkCol < 0) {
        addedLines.push('⚠️ 槽 ' + slotN + '：草稿沒有 registerLink_' + slotN + ' 欄，沒寫入：' + link);
        return;
      }

      draft.getRange(i + 1, linkCol + 1).setValue(link);
      backgrounds[i][linkCol] = REGLINK_CONFIG.colorHasLink;
      const condCol = headers.indexOf('conditions_' + slotN);
      if (condCol >= 0) backgrounds[i][condCol] = REGLINK_CONFIG.colorHasLink;
      found++;
      addedLines.push('槽 ' + slotN + '：✅ AI 從官網找到' +
        (item.activity_name ? '（活動名稱：' + String(item.activity_name).trim() + '）' : '') +
        '：' + link + '\n    原文佐證：' + String(item.evidence || '').trim());
    });

    if (addedLines.length) {
      const prev = String(data[i][noteCol] || '').trim();
      draft.getRange(i + 1, noteCol + 1)
        .setValue((prev ? prev + '\n' : '') + addedLines.join('\n')).setWrap(true);
    }
    draft.getRange(i + 1, statusCol + 1)
      .setValue('已搜尋（找到 ' + addedLines.filter(function (l) { return l.indexOf('✅') >= 0; }).length +
        ' / 待找 ' + pendingNumbers.length + '）');
    processed++;
  }

  draft.getRange(1, 1, data.length, headers.length).setBackgrounds(backgrounds);

  ui.alert([
    '本輪處理 ' + processed + ' 張卡，找到 ' + found + ' 個登錄連結。',
    skipped ? '跳過 ' + skipped + ' 張（已搜尋過）。' : '',
    remaining ? '還有 ' + remaining + ' 張沒跑到——再按一次選單接著跑。' : '需要搜尋的卡片都跑完了。',
    rejected ? '⚠️ 丟棄 ' + rejected + ' 個「不在官網原文裡」的網址（已記在說明欄）。' : '',
    failures.length ? '\n失敗（下次執行會自動重試）：\n' + failures.join('\n') : '',
    '\n貼回正式 Cards Data 時記得用「選擇性貼上 → 只貼值」，不然黃綠底色會一起貼過去。'
  ].filter(function (x) { return x; }).join('\n'));
}

// 這一列還缺連結的登錄槽位編號
function regLinkPendingSlots_(headers, row) {
  const pending = [];
  for (let n = 1; n <= REGLINK_CONFIG.maxSlots; n++) {
    const condCol = headers.indexOf('conditions_' + n);
    if (condCol < 0) continue;
    if (!regLinkNeedsRegister_(String(row[condCol] || ''))) continue;
    const linkCol = headers.indexOf('registerLink_' + n);
    if (linkCol >= 0 && normalizeRegisterLink_(row[linkCol])) continue;   // 已經有連結
    pending.push(n);
  }
  return pending;
}

/************** 草稿分頁：Cards Data 的完整複本 ＋ 兩欄說明 **************/
// 每次重建都是複製「當下的」正式 Cards Data，所以草稿永遠不會是舊資料。
// 草稿建在資料檔裡（跟 Cards Data 同一本），不是自動化檔。
function regLinkEnsureDraftSheet_(cardsSheet, ui) {
  const dataFile = cardsSheet.getParent();
  const existing = dataFile.getSheetByName(REGLINK_CONFIG.draftSheetName);
  if (existing) return existing;

  const answer = ui.alert(
    '要建立草稿分頁嗎？',
    '會在「' + dataFile.getName() + '」複製一份現在的「' + cardsSheet.getName() +
    '」成為「' + REGLINK_CONFIG.draftSheetName + '」，所有標色與登錄連結只寫進這份草稿。\n\n' +
    '正式 Cards Data 不會被修改。',
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return null;

  const draft = cardsSheet.copyTo(dataFile);
  draft.setName(REGLINK_CONFIG.draftSheetName);
  regLinkAssertDraft_(draft);   // 改名沒成功就不准往下寫（下面幾行會寫表頭）

  const lastCol = draft.getLastColumn();
  draft.getRange(1, lastCol + 1).setValue(REGLINK_CONFIG.noteHeader);
  draft.setColumnWidth(lastCol + 1, 560);
  draft.getRange(1, lastCol + 2).setValue(REGLINK_CONFIG.aiStatusHeader);
  draft.setColumnWidth(lastCol + 2, 220);
  draft.setFrozenRows(1);
  return draft;
}

// 寫入前的最後一道保險：確認拿到的真的是草稿分頁，不是正式 Cards Data
function regLinkAssertDraft_(sheet) {
  if (!sheet || sheet.getName() !== REGLINK_CONFIG.draftSheetName) {
    throw new Error('安全檢查失敗：登錄連結只能寫進「' + REGLINK_CONFIG.draftSheetName +
      '」，拿到的卻是「' + (sheet ? sheet.getName() : 'null') + '」');
  }
  return sheet;
}

/************** 讀「1-監控清單」的 last_snapshot，歸到卡片身上（只讀不寫） **************/
// 回傳 { card_id: [{ url, text }, ...] }。
// 一列可能對到多張卡：card_id 欄是主要對象，cards 欄（逗號分隔）是這一頁還涵蓋哪些卡
// ——銀行的公告總覽頁常常一頁蓋好幾張卡，那種頁的登錄連結也要歸給每一張。
function regLinkBuildSnapshotIndex_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REGLINK_CONFIG.watchlistSheet);
  if (!sheet) return {};

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};
  const h = data[0].map(function (x) { return String(x).trim(); });
  const cSnap = h.indexOf('last_snapshot');
  const cId = h.indexOf('card_id');
  const cCards = h.indexOf('cards');
  const cUrl = h.indexOf('url');
  if (cSnap < 0) return {};

  const byCard = {};
  for (let i = 1; i < data.length; i++) {
    const text = String(data[i][cSnap] || '').trim();
    if (!text) continue;
    const url = cUrl >= 0 ? String(data[i][cUrl] || '').trim() : '';

    const ids = [];
    if (cId >= 0) {
      const primary = String(data[i][cId] || '').trim();
      if (primary) ids.push(primary);
    }
    if (cCards >= 0) {
      String(data[i][cCards] || '').split(/[,，、]/).forEach(function (x) {
        const t = x.trim();
        if (t && ids.indexOf(t) < 0) ids.push(t);
      });
    }

    ids.forEach(function (id) {
      if (!byCard[id]) byCard[id] = [];
      byCard[id].push({ url: url, text: text });
    });
  }
  return byCard;
}

/************** 問 Gemini：這些槽位的登錄連結在官網哪裡？ **************/
function regLinkAskGemini_(cardName, pendingSlots, snapshots) {
  const systemPrompt = [
    '你是信用卡權益資料的整理助理。我已經知道哪些活動需要登錄了（下面會給你槽位編號），',
    '你的唯一任務是：在銀行官網的原始文字裡，找出這些活動的「登錄頁網址」。',
    '',
    '【最重要的規則】',
    '1. register_link **只能是官網原文裡逐字出現過的網址**。不可以自己組、自己猜、自己補全，',
    '   也不可以把活動說明頁或通路清單頁的網址當成登錄頁。找不到就不要回那個槽位——',
    '   寧可漏掉，也不要給錯的連結（我這邊有機械檢查，網址沒出現在原文裡會被直接丟掉）。',
    '2. 只回 https:// 開頭的完整網址。App 專屬 scheme（cathaybk://、linepay:// 之類）、',
    '   App Store／Google Play 下載頁一律不要回。',
    '3. 只能在 App 內操作的活動（「請至本行APP登錄」「打開App→我的優惠→登錄」）→ 不要回。',
    '4. slot 只能填我給你的那些編號，不要自己發明、也不要回沒列在清單裡的槽位。',
    '5. 完全找不到是很常見的正常結果，直接回空陣列。',
    '',
    '【activity_name】官網如果有這檔活動的名稱（如「夏日饗樂」「新戶首刷禮」「台灣Pay天天1.5%」），',
    '  填進去；沒有就留空。回饋率、上限、適用通路我這邊已經有了，你不用重複。',
    '【evidence】把官網原文裡「講到要登錄、並且出現這個網址」的那一小段原句貼回來（50 字內）。'
  ].join('\n');

  const slotLines = pendingSlots.map(function (s) {
    return '槽位 ' + s.slot + '：適用通路=' + (s.items || '(空)') +
      '｜分類=' + (s.category || '(無)') +
      '｜條件原文=' + (s.conditions || '(無)');
  }).join('\n');

  let snapText = snapshots.map(function (s) {
    return '--- 來源頁：' + (s.url || '(未填網址)') + ' ---\n' + s.text;
  }).join('\n\n');
  if (snapText.length > REGLINK_CONFIG.maxSnapshotChars) {
    snapText = snapText.slice(0, REGLINK_CONFIG.maxSnapshotChars);
  }

  const userText = [
    '卡片：' + cardName,
    '',
    '【需要找登錄連結的槽位】',
    slotLines,
    '',
    '【銀行官網原始文字（監控快照）】',
    snapText
  ].join('\n');

  const schema = {
    type: 'OBJECT',
    properties: {
      links: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            slot: { type: 'INTEGER', description: '槽位編號，只能用我給你的那些' },
            register_link: { type: 'STRING', description: '官網原文裡逐字出現過的 https 登錄頁網址' },
            activity_name: { type: 'STRING', description: '官網的活動名稱，沒有就留空' },
            evidence: { type: 'STRING', description: '官網原文裡的那一小段原句（50 字內）' }
          },
          required: ['slot', 'register_link', 'evidence']
        }
      }
    },
    required: ['links']
  };

  const result = callGemini_(systemPrompt, userText, schema);   // benefits-parser.gs
  return (result && result.links) || [];
}

// 給 AI 的 pending 槽位要帶上下文（通路/分類/條件原文），這裡把編號展開成物件
function regLinkPendingSlotDetails_(headers, row, pendingNumbers) {
  return pendingNumbers.map(function (n) {
    const get = function (name) {
      const c = headers.indexOf(name + '_' + n);
      return c < 0 ? '' : String(row[c] == null ? '' : row[c]).trim();
    };
    return { slot: n, items: get('items'), category: get('category'), conditions: get('conditions') };
  });
}

/************** 硬性檢查：網址必須逐字出現在官網原文裡 **************/
// 為什麼要有：LLM 產生「看起來很像那家銀行」的網址是這個任務最可能出的錯，
// 而錯的登錄連結會把用戶帶到 404 或別家頁面，比沒有連結更糟。
// 比對前把尾端標點與斜線去掉——snapshot 常見「…請至 https://x.com/reg 登錄。」這種黏標點的情況。
function regLinkVerifyInSnapshot_(link, snapshotText) {
  if (!link || !snapshotText) return false;
  const trimmed = link.replace(/[.,;:)\]}、。，）]+$/, '').replace(/\/+$/, '');
  if (!trimmed) return false;
  return snapshotText.indexOf(trimmed) >= 0;
}
