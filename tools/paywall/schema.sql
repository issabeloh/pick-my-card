-- Pick My Card — 去廣告付費牆的 D1 資料表
-- 套用：wrangler d1 execute pick-my-card --remote --file=tools/paywall/schema.sql
--
-- 為什麼不用 Firestore：現行規則允許用戶讀寫自己的 users/{uid}，
-- 付費旗標放那等於用戶可自行開通。權益必須放在用戶碰不到的地方。

CREATE TABLE IF NOT EXISTS orders (
  trade_no       TEXT PRIMARY KEY,   -- 送給綠界的 MerchantTradeNo
  uid            TEXT NOT NULL,      -- Firebase uid（建單當下就綁定）
  email          TEXT,
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | failed
  created_at     INTEGER NOT NULL,
  paid_at        INTEGER,
  provider_txn_id TEXT,   -- 金流商端的交易 ID（OEN 的 data.id／綠界的 TradeNo）
  payment_type   TEXT,
  rtn_code       INTEGER,
  rtn_msg        TEXT,
  raw            TEXT,
  deleted_at     INTEGER   -- 帳號刪除時去識別化的時間（email/raw 已清空）                -- 綠界原始回呼，對帳/客訴時的證據
);

CREATE INDEX IF NOT EXISTS idx_orders_uid_status ON orders (uid, status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);

CREATE TABLE IF NOT EXISTS entitlements (
  uid        TEXT PRIMARY KEY,       -- 一人一份，永久買斷
  product    TEXT NOT NULL DEFAULT 'adfree',
  granted_at INTEGER NOT NULL,
  trade_no   TEXT,
  source     TEXT                    -- ecpay-notify | ecpay-query | manual
);
