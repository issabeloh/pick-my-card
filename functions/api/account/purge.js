/* ============================================================
 * POST /api/account/purge — 刪除帳號時一併清掉付費牆這邊的個人資料
 *
 * 由前端的「刪除帳號與全部資料」流程呼叫（必須在 Firebase 帳號被刪除**之前**，
 * 否則就拿不到能證明身分的 ID token 了）。
 *
 * 兩種資料、兩種處置——這是刻意的區分：
 *   entitlements：純粹是「這個 uid 有權益」的個人資料 → 直接刪除
 *   orders：交易憑證，涉及對帳與退款爭議，不能刪 → 改為去識別化：
 *           清掉 email 與金流商回呼原文（可能含個資），保留訂單編號、
 *           金額、時間與金流商交易編號。uid 留著但已無意義——Firebase 帳號
 *           刪掉後那串 uid 不再對應任何人，等同匿名代號，卻仍能讓你在
 *           爭議發生時把站內訂單與金流商後台的紀錄對起來。
 * ============================================================ */
import { requireUser } from '../../_lib/firebase-auth.js';
import { requireDB } from '../../_lib/db.js';
import { json, fail } from '../../_lib/http.js';

export async function onRequestPost({ request, env }) {
    let user;
    try {
        user = await requireUser(request, env);
    } catch (err) {
        return fail(401, '未登入', err);
    }

    try {
        const db = requireDB(env);
        const now = Date.now();

        // 權益：直接刪除
        const ent = await db.prepare('DELETE FROM entitlements WHERE uid = ?').bind(user.uid).run();

        // 訂單：保留交易事實，抹掉可識別個人的欄位
        const ord = await db
            .prepare("UPDATE orders SET email = NULL, raw = NULL, deleted_at = ? WHERE uid = ? AND deleted_at IS NULL")
            .bind(now, user.uid)
            .run();

        console.error(`[paywall] 帳號刪除清理：uid=${user.uid} 權益 ${ent.meta?.changes || 0} 筆、訂單去識別化 ${ord.meta?.changes || 0} 筆`);
        return json({ ok: true, entitlementsDeleted: ent.meta?.changes || 0, ordersAnonymised: ord.meta?.changes || 0 });
    } catch (err) {
        return fail(500, '清除付費資料失敗，請稍後再試', err, env);
    }
}
