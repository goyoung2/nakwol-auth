CREATE TABLE admin_operation_previews (
 token TEXT PRIMARY KEY, actor TEXT NOT NULL, client_id TEXT NOT NULL,
 version INTEGER NOT NULL, request_json TEXT NOT NULL, before_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE admin_operations (
 id TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 action TEXT NOT NULL, scope TEXT NOT NULL, target_user_id TEXT, discord_id TEXT,
 reason TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_json TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 result TEXT NOT NULL DEFAULT 'applied', error_code TEXT,
 execution_owner TEXT, execution_until INTEGER,
 UNIQUE(actor,idempotency_key)
);
CREATE INDEX admin_operations_app ON admin_operations(client_id,created_at DESC);
CREATE TABLE admin_operation_deliveries (
 operation_id TEXT NOT NULL REFERENCES admin_operations(id), client_id TEXT NOT NULL,
 control_seq INTEGER NOT NULL, PRIMARY KEY(operation_id,client_id)
);
CREATE TABLE admin_recovery_codes (
 code_hash TEXT PRIMARY KEY, actor TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
 policy_operation_id TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 used_at INTEGER, reason TEXT NOT NULL
);
