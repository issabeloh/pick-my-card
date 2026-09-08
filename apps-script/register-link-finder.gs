/**
 * PMC 資料自動化 —— 找出「銀行官方登錄連結」（registerLink_N）
 * ============================================================
 * 這支住在「PMC 資料自動化」試算表，與 benefits-parser.gs / card-benefits-parser.gs
 * 同一個 Apps Script 專案，共用它們的 callGemini_() / getCardsSheet_()，本檔不重複定義。
 *
 * 解決的問題：Cards Data 新增了 registerLink_N 欄（2026-09-08），但既有 33 張卡、
 * 400 多個槽位沒有人要一格一格去官網找登錄頁網址。而「1-監控清單」的 last_snapshot
 * 本來就存著每一頁官網的完整文字——登錄連結十之八九就在裡面，只是沒人去撈。
 *
 * 做什麼：
 *   1. 讀「1-監控清單」每一列的 last_snapshot，依 card_id / cards 欄歸到卡片身上
 *   2. 讀資料檔 Cards Data 每張卡的槽位（rate/cap/items/category/conditions/period）
 *   3. 每張卡問一次 Gemini：「這些槽位裡，哪一個在官網文字裡有登錄連結？」
 *   4. 把結果寫進資料檔的**草稿分頁**（Cards Data-登錄連結草稿），並在最右邊
 *      新增「登錄連結說明」欄，寫下每個填入槽位的活動摘要供站長複核
 *
 * ⚠️⚠️ 安全底線（這支會寫到「資料檔」，是全站資料的來源）：
 *   - **絕不寫正式的 Cards Data**。只寫 draftSheet，而且每次寫入前都再確認一次分頁名稱
 *     （regLinkAssertDraft_）。草稿是 Cards Data 的完整複本，站長複核後自己貼回去
 *   - **1-監控清單 只讀不寫**，完全不碰 last_snapshot
 *   - **AI 回的網址必須逐字出現在 snapshot 裡**才採用（regLinkVerifyInSnapshot_）。
 *     這條是硬性機械檢查，不是靠 prompt 拜託——LLM 生一個「看起來很合理」的銀行網址
 *     是這個任務最可能出的錯，而錯的登錄連結比沒有連結更糟
 *   - 只收 https 網址（沿用 card-benefits-parser.gs 的 normalizeRegisterLink_）
 *
 * 使用方式：
 *   選單「🤖 權益自動化 → 找登錄連結：1-監控清單 → Cards Data 草稿」
 *   一次最多處理 maxCardsPerRun 張卡（Apps Script 單次 6 分鐘上限），
 *   「登錄連結說明」已經有值的卡會自動跳過 → 再按一次選單就接著跑剩下的。
 *   要整批重跑：把草稿分頁刪掉，重新執行（會重新複製一份最新的 Cards Data）。
 */

/************** 設定區 **************/
const REGLINK_CONFIG = {
  watchlistSheet: '1-監控清單',
  cardsSheetName: 'Cards Data',
  draftSheetName: 'Cards Data-登錄連結草稿',
  noteHeader: '登錄連結說明',
  maxCardsPerRun: 8,        // 一張卡＝一次 Gemini 呼叫，8 張約 2–4 分鐘
  maxSnapshotChars: 40000,  // 單張卡送給 AI 的官網文字上限（多列 snapshot 合併後截斷）
  maxSlots: 22              // Cards Data 的槽位上限（與 cards-export.gs 的迴圈一致）
};

/************** 入口 **************/
function fillRegisterLinksFromSnapshots() {
  const ui = SpreadsheetApp.getUi();
  const cardsSheet = getCardsSheet_();               // benefits-parser.gs：資料檔的正式 Cards Data
  const dataFile = cardsSheet.getParent();

  const draft = regLinkEnsureDraftSheet_(cardsSheet, dataFile, ui);
  if (!draft) return;                                 // 使用者在確認視窗按了取消

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
  if (idCol < 0 || noteCol < 0) {
    ui.alert('草稿分頁的表頭不對（找不到 id 或「' + REGLINK_CONFIG.noteHeader + '」欄）——' +
      '把草稿分頁刪掉重跑一次讓它重建。');
    return;
  }

  let processed = 0, skipped = 0, remaining = 0;
  let filledSlots = 0, rejectedLinks = 0;
  const failures = [];

  for (let i = 1; i < data.length; i++) {
    const cardId = String(data[i][idCol] || '').trim();
    if (!cardId) continue;

    // 已經跑過的卡跳過（「登錄連結說明」有值＝處理過，即使結論是「沒找到」）
    if (String(data[i][noteCol] || '').trim()) { skipped++; continue; }

    if (processed >= REGLINK_CONFIG.maxCardsPerRun) { remaining++; continue; }

    const cardName = nameCol >= 0 ? String(data[i][nameCol] || '').trim() : cardId;
    const snapshots = snapshotsByCard[cardId] || [];
    const slots = regLinkReadSlots_(headers, data[i]);

    // 沒有 snapshot 或沒有槽位 → 不用問 AI，直接標註原因（下次不再重試）
    if (snapshots.length === 0 || slots.length === 0) {
      const why = snapshots.length === 0
        ? '（監控清單裡沒有這張卡的 last_snapshot——在 1-監控清單 補一列這張卡的官網頁面後重跑）'
        : '（Cards Data 這一列沒有任何有效槽位）';
      draft.getRange(i + 1, noteCol + 1).setValue(why);
      processed++;
      continue;
    }

    let result;
    try {
      result = regLinkAskGemini_(cardName, slots, snapshots);
    } catch (e) {
      failures.push(cardId + '：' + e.message);
      continue;   // 不寫說明欄 → 下次執行會自動重試這張卡
    }

    const noteLines = [];
    const snapshotText = snapshots.map(function (s) { return s.text; }).join('\n');

    (result || []).forEach(function (item) {
      const slotN = parseInt(item.slot, 10);
      if (!(slotN >= 1 && slotN <= REGLINK_CONFIG.maxSlots)) return;

      const link = normalizeRegisterLink_(item.register_link);   // card-benefits-parser.gs：只放行 http/https
      if (!link) return;

      // ⚠️ 硬性檢查：網址必須逐字出現在官網原文裡。AI 生一個「看起來很合理」的銀行
      //    網址是這個任務最可能出的錯，而錯的登錄連結比沒有連結更糟。
      if (!regLinkVerifyInSnapshot_(link, snapshotText)) {
        rejectedLinks++;
        noteLines.push('⚠️ 槽 ' + slotN + '：AI 給的網址不在官網原文裡，已丟棄（' +
          link.slice(0, 80) + '）');
        return;
      }

      const linkCol = headers.indexOf('registerLink_' + slotN);
      if (linkCol < 0) {
        noteLines.push('⚠️ 槽 ' + slotN + '：草稿沒有 registerLink_' + slotN +
          ' 欄，連結沒寫入（先在正式 Cards Data 補這一欄，再刪草稿重跑）：' + link);
        return;
      }

      draft.getRange(i + 1, linkCol + 1).setValue(link);
      filledSlots++;
      noteLines.push('槽 ' + slotN + '：' + String(item.summary || '（AI 沒給摘要）').trim() +
        ' → ' + link);
    });

    draft.getRange(i + 1, noteCol + 1)
      .setValue(noteLines.length ? noteLines.join('\n') : '（這張卡的官網文字裡找不到登錄連結）');
    if (noteLines.length) {
      draft.getRange(i + 1, noteCol + 1).setWrap(true);
    }
    processed++;
  }

  const msg = [
    '完成本輪：處理 ' + processed + ' 張卡，填入 ' + filledSlots + ' 個登錄連結。',
    skipped ? '跳過 ' + skipped + ' 張（已處理過）。' : '',
    remaining ? '還有 ' + remaining + ' 張沒跑到——再按一次選單就接著跑。' : '全部卡片都處理完了。',
    rejectedLinks ? '⚠️ 丟棄 ' + rejectedLinks + ' 個「不在官網原文裡」的網址（已記在說明欄）。' : '',
    failures.length ? '\n失敗（下次執行會自動重試）：\n' + failures.join('\n') : '',
    '\n結果寫在資料檔的「' + REGLINK_CONFIG.draftSheetName + '」分頁。' +
    '正式 Cards Data 完全沒有被動到——複核「' + REGLINK_CONFIG.noteHeader +
    '」欄之後，自己把 registerLink_N 那幾欄貼回去。'
  ].filter(function (x) { return x; }).join('\n');
  ui.alert(msg);
}

/************** 草稿分頁：Cards Data 的完整複本 ＋ 最右邊一欄「登錄連結說明」 **************/
// 每次重建都是複製「當下的」正式 Cards Data，所以草稿永遠不會是舊資料。
function regLinkEnsureDraftSheet_(cardsSheet, dataFile, ui) {
  const existing = dataFile.getSheetByName(REGLINK_CONFIG.draftSheetName);
  if (existing) return existing;    // 續跑：沿用現有草稿（說明欄有值的卡會被跳過）

  const answer = ui.alert(
    '要建立草稿分頁嗎？',
    '會在資料檔複製一份現在的「' + REGLINK_CONFIG.cardsSheetName + '」成為「' +
    REGLINK_CONFIG.draftSheetName + '」，登錄連結只寫進這份草稿。\n\n' +
    '正式 Cards Data 不會被修改。',
    ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return null;

  const draft = cardsSheet.copyTo(dataFile);
  draft.setName(REGLINK_CONFIG.draftSheetName);

  // 最右邊補「登錄連結說明」欄
  const lastCol = draft.getLastColumn();
  draft.getRange(1, lastCol + 1).setValue(REGLINK_CONFIG.noteHeader);
  draft.setColumnWidth(lastCol + 1, 520);
  draft.setFrozenRows(1);
  return draft;
}

// 寫入前的最後一道保險：確認拿到的真的是草稿分頁，不是正式 Cards Data。
// （目前每個寫入點都是先經過 regLinkEnsureDraftSheet_ 才拿到 sheet，這支是給日後
//   有人重構、不小心把 cardsSheet 傳進來時用的。）
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

/************** 讀 Cards Data 一列的槽位（給 AI 當「這張卡有哪些活動」的對照表） **************/
function regLinkReadSlots_(headers, row) {
  const get = function (name) {
    const c = headers.indexOf(name);
    return c < 0 ? '' : String(row[c] == null ? '' : row[c]).trim();
  };
  const slots = [];
  for (let n = 1; n <= REGLINK_CONFIG.maxSlots; n++) {
    const items = get('items_' + n);
    const rate = get('rate_' + n);
    if (!items && !rate) continue;           // 空槽
    slots.push({
      slot: n,
      rate: rate,
      cap: get('cap_' + n),
      items: items,
      category: get('category_' + n),
      conditions: get('conditions_' + n),
      period: get('period_' + n) || (get('periodStart_' + n) + '~' + get('periodEnd_' + n)).replace(/^~$/, ''),
      existing_link: get('registerLink_' + n)
    });
  }
  return slots;
}

/************** 問 Gemini：哪個槽位有登錄連結？ **************/
function regLinkAskGemini_(cardName, slots, snapshots) {
  const systemPrompt = [
    '你是信用卡權益資料的整理助理。任務：從銀行官網的原始文字裡，找出「哪些回饋活動需要登錄、',
    '而且官網有給登錄頁網址」，並把網址對應到我給你的槽位編號。',
    '',
    '【最重要的規則】',
    '1. register_link **只能是官網原文裡逐字出現過的網址**。你不可以自己組、自己猜、自己補全、',
    '   也不可以把活動說明頁的網址當成登錄頁。找不到就不要回那個槽位——寧可漏掉，也不要給錯的連結。',
    '2. 只回 https:// 開頭的完整網址。App 專屬 scheme（cathaybk://、linepay:// 之類）、',
    '   App Store／Google Play 下載頁一律不要回。',
    '3. 只能在 App 內操作的活動（「請至本行APP登錄」「打開App→我的優惠→登錄」）→ 不要回那個槽位。',
    '4. 一個槽位最多一個連結。同一個登錄頁對應到多個槽位是正常的，各自回一筆。',
    '5. 這張卡完全找不到任何登錄連結是很常見的正常結果，直接回空陣列。',
    '',
    '【summary 怎麼寫】給站長人工複核用的一句話，一定要包含：',
    '  ・回饋率（如「5%」）',
    '  ・回饋/消費上限（如「消費上限 NT$7,500」；沒有就寫「無上限」）',
    '  ・適用通路（照槽位的 items 寫，太多就寫前幾個＋「等」）',
    '  ・官網如果有活動名稱（如「夏日饗樂」「新戶首刷禮」），一定要寫進去',
    '  範例：「夏日饗樂：指定餐廳 5% 回饋，消費上限 NT$7,500，適用星巴克、路易莎、藏壽司等」',
    '',
    '【evidence】把官網原文裡「講到要登錄、並且出現這個網址」的那一小段原句貼回來（50 字內）。',
    '',
    '⚠️ 我給你的槽位清單就是這張卡在資料庫裡的全部活動。slot 只能填那些編號，不要自己發明。'
  ].join('\n');

  const slotLines = slots.map(function (s) {
    return [
      '槽位 ' + s.slot + '：',
      '  回饋率=' + (s.rate || '(空)'),
      '  消費上限=' + (s.cap || '(無)'),
      '  適用通路=' + (s.items || '(空)'),
      '  分類=' + (s.category || '(無)'),
      '  條件=' + (s.conditions || '(無)'),
      '  期間=' + (s.period || '(無)')
    ].join('\n');
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
    '【這張卡在資料庫裡的槽位】',
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
            summary: { type: 'STRING', description: '含回饋率、上限、適用通路、活動名稱的一句話' },
            evidence: { type: 'STRING', description: '官網原文裡的那一小段原句（50 字內）' }
          },
          required: ['slot', 'register_link', 'summary', 'evidence']
        }
      }
    },
    required: ['links']
  };

  const result = callGemini_(systemPrompt, userText, schema);   // benefits-parser.gs
  return (result && result.links) || [];
}

/************** 硬性檢查：網址必須逐字出現在官網原文裡 **************/
// 為什麼要有：LLM 產生「看起來很像那家銀行」的網址是這個任務最可能出的錯，
// 而錯的登錄連結會把用戶帶到 404 或別家頁面，比沒有連結更糟。
// 比對前把尾端的標點與斜線去掉——snapshot 常見「…請至 https://x.com/reg 登錄。」這種黏標點的情況。
function regLinkVerifyInSnapshot_(link, snapshotText) {
  if (!link || !snapshotText) return false;
  const trimmed = link.replace(/[.,;:)\]}、。，）]+$/, '').replace(/\/+$/, '');
  if (!trimmed) return false;
  return snapshotText.indexOf(trimmed) >= 0;
}
