PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connect_device_requests (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_action TEXT NOT NULL DEFAULT 'cli_login',
  project_name TEXT,
  framework TEXT,
  homepage_url TEXT,
  approved_user_id TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER,
  FOREIGN KEY(approved_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_connect_device_requests_user_code
  ON connect_device_requests(user_code);
CREATE INDEX IF NOT EXISTS idx_connect_device_requests_expires
  ON connect_device_requests(expires_at);

CREATE TABLE IF NOT EXISTS connect_cli_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  label TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_connect_cli_tokens_user
  ON connect_cli_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_cli_tokens_expires
  ON connect_cli_tokens(expires_at);

UPDATE applications
SET redirect_uris = '["https://nakwol-auth.sepsd21.workers.dev/admin/apps","https://nakwol-auth.sepsd21.workers.dev/connect/device","https://nakwol-auth.sepsd21.workers.dev/admin/developers"]',
    updated_at = unixepoch() * 1000
WHERE client_id = 'nakwol-connect-admin';
