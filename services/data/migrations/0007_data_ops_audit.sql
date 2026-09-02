PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS data_ops_audit_log (
  id TEXT PRIMARY KEY,
  operator_user_id TEXT NOT NULL,
  target_user_id TEXT,
  target_account_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('SEARCH_ACCOUNT', 'VIEW_ACCOUNT', 'VIEW_DECK')),
  request_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_ops_audit_operator_created
  ON data_ops_audit_log(operator_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_data_ops_audit_target_account_created
  ON data_ops_audit_log(target_account_id, created_at DESC)
  WHERE target_account_id IS NOT NULL;