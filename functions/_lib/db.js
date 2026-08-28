/* ============================================================
 * functions/_lib/db.js — D1 存取層（訂單與去廣告權益）
 * 區塊目錄（Grep 關鍵字）：
 *  - 建立訂單    → "createOrder"
 *  - 查訂單      → "getOrder"
 *  - 標記已付款  → "markOrderPaid"
 *  - 授予權益    → "grantAdfree"
 *  - 查權益      → "getEntitlement"
 *
 * ⚠️ 權益（entitlements）只有這裡會寫，而這裡只跑在伺服器上。
 *    絕不把付費旗標放進 Firestore 的 users/{uid}——那份文件用戶自己寫得動，
 *    等於誰都能自行開通。
 * ============================================================ */

export function requireDB(env) {
    if (!env.DB) throw new Error('D1 綁定 DB 未設定（Cloudflare Pages → Settings → Functions → D1 bindings）');
    return env.DB;
}

export async function createOrder(env, { tradeNo, uid, email, amount, tip }) {
    await requireDB(env)
        .prepare('INSERT INTO orders (trade_no, uid, email, amount, tip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(tradeNo, uid, email, amount, Number(tip) || 0, 'pending', Date.now())
        .run();
}

export async function getOrder(env, tradeNo) {
    return await requireDB(env)
        .prepare('SELECT * FROM orders WHERE trade_no = ?')
        .bind(tradeNo)
        .first();
}

/**
 * 標記訂單結果。回傳 true 代表「這次呼叫真的把訂單從未付款翻成已付款」，
 * false 代表早就處理過了——綠界會重送通知，靠這個回傳值做冪等。
 */
export async function markOrderPaid(env, tradeNo, info) {
    const res = await requireDB(env)
        .prepare(
            `UPDATE orders
                SET status = 'paid', paid_at = ?, provider_txn_id = ?, payment_type = ?,
                    rtn_code = ?, rtn_msg = ?, raw = ?
              WHERE trade_no = ? AND status != 'paid'`,
        )
        .bind(Date.now(), info.providerTxnId || null, info.paymentType || null,
              info.rtnCode ?? null, info.rtnMsg || null, info.raw || null, tradeNo)
        .run();
    return (res.meta?.changes || 0) > 0;
}

/** 建單後補寫金流商的交易 ID（OEN 的 data.id）。只補空值，不覆寫。 */
export async function setOrderProviderTxn(env, tradeNo, txnId) {
    await requireDB(env)
        .prepare('UPDATE orders SET provider_txn_id = ? WHERE trade_no = ? AND provider_txn_id IS NULL')
        .bind(txnId, tradeNo)
        .run();
}

export async function markOrderFailed(env, tradeNo, info) {
    await requireDB(env)
        .prepare(
            `UPDATE orders SET status = 'failed', rtn_code = ?, rtn_msg = ?, raw = ?
              WHERE trade_no = ? AND status = 'pending'`,
        )
        .bind(info.rtnCode ?? null, info.rtnMsg || null, info.raw || null, tradeNo)
        .run();
}

/**
 * 授予永久去廣告權益。INSERT OR IGNORE：重複授予是安全的（冪等）。
 * 回傳 true 代表「這次真的寫進去了」——webhook 重送時會是 false。
 * 感謝信靠這個判斷才不會重複寄（見 _lib/mail.js 檔頭鐵則 2）。
 */
export async function grantAdfree(env, uid, { tradeNo, source }) {
    const res = await requireDB(env)
        .prepare('INSERT OR IGNORE INTO entitlements (uid, product, granted_at, trade_no, source) VALUES (?, ?, ?, ?, ?)')
        .bind(uid, 'adfree', Date.now(), tradeNo || null, source || 'ecpay')
        .run();
    return !!(res && res.meta && res.meta.changes > 0);
}

export async function getEntitlement(env, uid) {
    return await requireDB(env)
        .prepare("SELECT * FROM entitlements WHERE uid = ? AND product = 'adfree'")
        .bind(uid)
        .first();
}

/** 該用戶最近一筆未完成訂單（前端「我付了但沒開通」時拿來自我修復）。 */
export async function latestPendingOrder(env, uid) {
    return await requireDB(env)
        .prepare("SELECT * FROM orders WHERE uid = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
        .bind(uid)
        .first();
}
