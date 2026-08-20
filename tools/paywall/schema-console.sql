CREATE TABLE IF NOT EXISTS orders (
  trade_no       TEXT PRIMARY KEY,
  uid            TEXT NOT NULL,
  email          TEXT,
  amount         INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     INTEGER NOT NULL,
  paid_at        INTEGER,
  provider_txn_id TEXT,
  payment_type   TEXT,
  rtn_code       INTEGER,
  rtn_msg        TEXT,
  raw            TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_uid_status ON orders (uid, status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE TABLE IF NOT EXISTS entitlements (
  uid        TEXT PRIMARY KEY,
  product    TEXT NOT NULL DEFAULT 'adfree',
  granted_at INTEGER NOT NULL,
  trade_no   TEXT,
  source     TEXT
);
