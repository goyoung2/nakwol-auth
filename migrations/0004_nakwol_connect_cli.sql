PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connect_developers (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'developer' CHECK(role IN ('developer','operator')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by_user_id TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS application_owners (
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK(role = 'owner'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(client_id, user_id),
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_application_owners_user_id ON application_owners(user_id);

CREATE TABLE IF NOT EXISTS connect_device_requests (
  device_code_hash TEXT PRIMARY KEY,
  user_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','consumed','expired')),
  scopes TEXT NOT NULL,
  approved_user_id TEXT,
  expires_at INTEGER NOT NULL,
  interval_seconds INTEGER NOT NULL DEFAULT 3,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  FOREIGN KEY(approved_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_connect_device_requests_user_code ON connect_device_requests(user_code);
CREATE INDEX IF NOT EXISTS idx_connect_device_requests_expires_at ON connect_device_requests(expires_at);

CREATE TABLE IF NOT EXISTS connect_cli_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_connect_cli_tokens_user_id ON connect_cli_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_connect_cli_tokens_expires_at ON connect_cli_tokens(expires_at);

INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at)
VALUES (
  'nakwol-connect-cli',
  'NAKWOL Connect CLI Device Approval',
  '["https://nakwol-auth.sepsd21.workers.dev/connect/cli/device/verify"]',
  'active',
  unixepoch() * 1000,
  unixepoch() * 1000
)
ON CONFLICT(client_id) DO UPDATE SET
  name = excluded.name,
  redirect_uris = excluded.redirect_uris,
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO application_settings(
  client_id, homepage_url, framework, access_policy, owner_user_id, created_at, updated_at
)
VALUES (
  'nakwol-connect-cli',
  'https://nakwol-auth.sepsd21.workers.dev/connect/cli/device/verify',
  'internal',
  'public',
  NULL,
  unixepoch() * 1000,
  unixepoch() * 1000
)
ON CONFLICT(client_id) DO UPDATE SET
  homepage_url = excluded.homepage_url,
  framework = 'internal',
  access_policy = 'public',
  updated_at = excluded.updated_at;

UPDATE applications
SET redirect_uris = '["https://nakwol-auth.sepsd21.workers.dev/admin/apps","https://nakwol-auth.sepsd21.workers.dev/admin/developers"]',
    updated_at = unixepoch() * 1000
WHERE client_id = 'nakwol-connect-admin';

INSERT INTO connect_developers(user_id, role, status, created_at, updated_at, created_by_user_id)
SELECT user_id, 'operator', 'active', unixepoch() * 1000, unixepoch() * 1000, created_by_user_id
FROM auth_operators
ON CONFLICT(user_id) DO UPDATE SET
  role = 'operator',
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO application_owners(client_id, user_id, role, created_at)
SELECT client_id, owner_user_id, 'owner', unixepoch() * 1000
FROM application_settings
WHERE owner_user_id IS NOT NULL
ON CONFLICT(client_id, user_id) DO NOTHING;
