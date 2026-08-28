/* ============================================================
 * functions/_lib/mail.js — 購買成功的感謝信
 *
 * 為什麼是 HTTP API 而不是 SMTP：Cloudflare Workers/Pages Functions 沒有
 * raw TCP，寄不了 SMTP。`firebase-functions/` 那支用 nodemailer + Gmail SMTP
 * 的做法在這裡**不能重用**。
 *
 * 預設走 Resend（Cloudflare 官方文件現在指的就是它，免費額度每月 3,000 封；
 * 舊教學講的 MailChannels 免費方案已於 2024-08-31 終止，不要再照抄）。
 * 端點可用 PMC_MAIL_ENDPOINT 覆寫，換供應商時不必改程式碼。
 *
 * ⚠️ 兩條鐵則：
 *   1. **寄信失敗絕不能影響開通**。權益是用戶花錢買的，信只是禮貌。
 *      所有錯誤都吞掉並用 console.error 記錄，永遠不往上拋。
 *   2. **只在「這次真的第一次開通」時寄**（grantAdfree 回報有寫入才寄），
 *      否則 webhook 重送會讓用戶收到一疊重複的信。
 *
 * 沒設定 PMC_MAIL_API_KEY／PMC_MAIL_FROM 時整個功能靜默停用——上線前
 * 還沒申請好也不會壞掉。
 * ============================================================ */

const DEFAULT_ENDPOINT = 'https://api.resend.com/emails';

/** HTML 內容一律經過這裡。金額與訂單編號都是我方產生的，但不留例外。 */
function esc(text) {
    return String(text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function buildThanksEmail({ amount, tip, tradeNo, siteOrigin }) {
    const site = siteOrigin || 'https://pickmycard.app';
    const hasTip = Number(tip) > 0;
    const subject = hasTip
        ? `感謝加碼支持！廣告已移除（訂單 ${tradeNo}）`
        : `感謝支持！廣告已移除（訂單 ${tradeNo}）`;

    // 開場依有無加碼換句話，後面那段站長的自述兩種情況都要出現
    const opening = hasTip
        ? `我是 Pick My Card 的作者，Issabel。謝謝你！你付了 NT$${amount}，其中 NT$${tip} 是你自願加碼的支持。這對一個人營運的網站是很大的鼓勵！`
        : `我是 Pick My Card 的作者，Issabel。謝謝你的支持！這對一個人營運的網站是很大的鼓勵！`;
    const story = '我從想要解決自己的日常煩惱，到推出給身邊的人用，再到大力推廣給台灣人用，'
        + '經歷好多驚喜和挫折。建立和經營這個網站讓我學到很多，也享受致力做出最好用的網站的過程。';
    const amountLine = `· 付款金額：NT$${amount}${hasTip ? `（底價 NT$${amount - tip} ＋ 加碼 NT$${tip}）` : ''}`;

    const text = [
        opening,
        '',
        story,
        '',
        '【你獲得的權益】',
        '· Pick My Card 所有頁面不再載入廣告',
        '· 權益綁定你的帳號，永久有效，不會自動續扣',
        '· 換手機、換瀏覽器，用同一個帳號登入就同樣生效',
        '',
        '【訂單資訊】',
        `· 訂單編號：${tradeNo}`,
        amountLine,
        '',
        `如果登入後仍然看到廣告，請到 ${site} 開啟「我的帳號」查看權益狀態；`,
        '若有任何問題，直接回覆這封信或用網站上的「回報錯誤」聯絡我們。',
        '',
        '— Issabel｜Pick My Card 信用卡回饋大師',
    ].join('\n');

    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.8;color:#1f2937;max-width:560px">
<p>${esc(opening)}</p>
<p>${esc(story)}</p>
<p style="margin:22px 0 6px"><strong>你獲得的權益</strong></p>
<ul style="margin:0;padding-left:20px">
<li>Pick My Card 所有頁面不再載入廣告</li>
<li>權益綁定你的帳號，永久有效，不會自動續扣</li>
<li>換手機、換瀏覽器，用同一個帳號登入就同樣生效</li>
</ul>
<p style="margin:22px 0 6px"><strong>訂單資訊</strong></p>
<ul style="margin:0;padding-left:20px">
<li>訂單編號：${esc(tradeNo)}</li>
<li>付款金額：NT$${esc(amount)}${hasTip ? `（底價 NT$${esc(amount - tip)} ＋ 加碼 NT$${esc(tip)}）` : ''}</li>
</ul>
<p style="margin-top:22px;color:#6b7280;font-size:13px">
如果登入後仍然看到廣告，請到 <a href="${esc(site)}">${esc(site)}</a> 開啟「我的帳號」查看權益狀態；
若有任何問題，直接回覆這封信或用網站上的「回報錯誤」聯絡我們。</p>
<p style="margin-top:22px;color:#6b7280;font-size:13px">— Issabel｜Pick My Card 信用卡回饋大師</p>
</div>`;

    return { subject, text, html };
}

/**
 * 寄出感謝信。永遠不丟例外——回傳 { sent } / { skipped } / { failed } 供記錄。
 * 沒有收件人（訂單沒存到 email）時直接跳過。
 */
export async function sendPurchaseThanks(env, { to, amount, tip, tradeNo }) {
    const siteOrigin = env.PMC_SITE_ORIGIN || 'https://pickmycard.app';
    const apiKey = env.PMC_MAIL_API_KEY || '';
    const from = env.PMC_MAIL_FROM || '';
    if (!apiKey || !from) return { skipped: 'mail-not-configured' };
    if (!to) return { skipped: 'no-recipient' };

    try {
        const { subject, text, html } = buildThanksEmail({ amount, tip, tradeNo, siteOrigin });
        const res = await fetch(env.PMC_MAIL_ENDPOINT || DEFAULT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify({
                from,
                to: [to],
                subject,
                text,
                html,
                ...(env.PMC_MAIL_REPLY_TO ? { reply_to: env.PMC_MAIL_REPLY_TO } : {}),
            }),
        });
        if (!res.ok) {
            const detail = (await res.text()).slice(0, 300);
            console.error(`[paywall] 感謝信寄送失敗 HTTP ${res.status}：${detail}（訂單 ${tradeNo}）`);
            return { failed: res.status };
        }
        return { sent: true };
    } catch (err) {
        // 這裡吞掉是刻意的：寄信失敗不能連累開通（見檔頭鐵則 1）
        console.error('[paywall] 感謝信寄送例外（不影響權益）：' + (err && err.message ? err.message : err));
        return { failed: 'exception' };
    }
}

/**
 * 給開通流程用的便利包裝：直接吃 orders 那一列。
 * 呼叫端只在 grantAdfree 回報「這次真的寫入」時才呼叫它。
 */
export async function thankBuyer(env, order) {
    if (!order) return { skipped: 'no-order' };
    return await sendPurchaseThanks(env, {
        to: order.email,
        amount: order.amount,
        tip: Number(order.tip) || 0,
        tradeNo: order.trade_no,
    });
}
