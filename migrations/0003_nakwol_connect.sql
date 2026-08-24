PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_operators (
  user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at INTEGER NOT NULL,
  created_by_user_id TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS application_settings (
  client_id TEXT PRIMARY KEY,
  homepage_url TEXT,
  framework TEXT NOT NULL DEFAULT 'other',
  access_policy TEXT NOT NULL DEFAULT 'member',
  owner_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(client_id) REFERENCES applications(client_id) ON DELETE CASCADE,
  FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_application_settings_owner
  ON application_settings(owner_user_id);

INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at)
VALUES (
  'nakwol-connect-admin',
  'NAKWOL Connect Admin',
  '["https://nakwol-auth.sepsd21.workers.dev/admin/apps"]',
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
  'nakwol-connect-admin',
  'https://nakwol-auth.sepsd21.workers.dev/admin/apps',
  'internal',
  'public',
  NULL,
  unixepoch() * 1000,
  unixepoch() * 1000
)
ON CONFLICT(client_id) DO UPDATE SET
  homepage_url = excluded.homepage_url,
  framework = excluded.framework,
  access_policy = 'public',
  updated_at = excluded.updated_at;

INSERT INTO application_settings(
  client_id, homepage_url, framework, access_policy, owner_user_id, created_at, updated_at
)
SELECT
  client_id,
  'https://siege-calculator.pages.dev/',
  'vite',
  'public',
  NULL,
  unixepoch() * 1000,
  unixepoch() * 1000
FROM applications
WHERE client_id = 'siege-calculator'
ON CONFLICT(client_id) DO NOTHING;
