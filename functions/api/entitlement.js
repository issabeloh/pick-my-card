/* GET /api/entitlement — 查本人是否已購買去廣告（前端的權威來源） */
import { requireUser } from '../_lib/firebase-auth.js';
import { getEntitlement } from '../_lib/db.js';
import { json, fail } from '../_lib/http.js';

export async function onRequestGet({ request, env }) {
    let user;
    try {
        user = await requireUser(request, env);
    } catch (err) {
        return fail(401, '未登入', err);
    }
    try {
        const row = await getEntitlement(env, user.uid);
        return json({ adfree: !!row, grantedAt: row ? row.granted_at : null });
    } catch (err) {
        return fail(500, '查詢權益失敗', err, env);
    }
}
