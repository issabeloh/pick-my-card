/**
 * 站長推薦：一鍵填入目前的自動問句／推薦理由（2026-09-23）
 *
 * 用途：讓站長有現成的句子可以改，不用從空白開始寫。
 * 用法：跟 cards-export.gs 放在**同一個** Apps Script 專案（它直接呼叫那邊的
 *       pmcRowToPromo_、pmcSelectPicks_ 等函數），在編輯器選 fillPickSuggestions 執行。
 *
 * 它做的事：
 *   1. 用跟匯出完全相同的規則，算出「現在這一刻」會上榜的 5 檔活動
 *   2. 只在那 5 列的 pick_question／pick_reason **空白**時寫入自動產生的句子
 *   3. 絕不覆寫已經有字的儲存格，也不動 pick_rank
 *
 * ⚠️ 寫進去的句子就變成「手動」了：之後改了 voucher_amount、min_spend 等數字，
 *    這些句子**不會**跟著更新。想恢復自動，把儲存格清空即可。
 * ⚠️ 只填這 5 列、不填全部活動：句子全填滿的話，兩檔活動可能出現一模一樣的問句
 *    （自動模式會避開重複，手動文字則照寫）。
 */
function fillPickSuggestions() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('New Cardholder Promos');
  if (!sheet) throw new Error('找不到 New Cardholder Promos 工作表');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const qCol = headers.indexOf('pick_question');
  const rCol = headers.indexOf('pick_reason');
  if (qCol < 0 || rCol < 0) throw new Error('第一列找不到 pick_question 或 pick_reason 欄位');

  const ctas = readNewCardholderPromos().cardApplyCtas;
  const today = pmcTodayISO_();
  const prepared = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue;
    const active = getValue(row, headers, 'active');
    if (active !== true && active !== 'TRUE' && active !== 'true') continue;
    if (!isPromoRow_(row, headers)) continue;
    const id = String(getValue(row, headers, 'id') || '');
    const promo = pmcRowToPromo_(row, headers, id);
    const endIso = pmcNormalizeDate_(promo.period_end);
    if (endIso && endIso < today) continue;
    prepared.push({ promo: promo, cta: ctas[id] || null, cardName: id, periodEndIso: endIso, sheetRow: i + 1 });
  }

  const picks = pmcSelectPicks_(prepared);
  const log = [];
  picks.forEach(function (c, idx) {
    const r = c.p.sheetRow;
    const wrote = [];
    if (String(data[r - 1][qCol]).trim() === '' && c.question) {
      sheet.getRange(r, qCol + 1).setValue(c.question); wrote.push('問句');
    }
    if (String(data[r - 1][rCol]).trim() === '' && c.reason) {
      sheet.getRange(r, rCol + 1).setValue(c.reason); wrote.push('理由');
    }
    log.push((idx + 1) + '. 第 ' + r + ' 列 ' + c.promo.id + '（' + PMC_KIND_LABEL[c.kind] + '）：' +
      (wrote.length ? '已填入' + wrote.join('、') : '原本就有字，未更動'));
  });

  const msg = '目前的站長推薦（' + picks.length + ' 檔）：\n' + log.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* 從編輯器執行時沒有 UI，看執行記錄即可 */ }
}
