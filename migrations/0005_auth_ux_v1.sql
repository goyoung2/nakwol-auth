PRAGMA foreign_keys = ON;

INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at)
VALUES (
  'nakwol-account-center',
  'NAKWOL Account Center',
  '["https://nakwol-auth.sepsd21.workers.dev/account"]',
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
  'nakwol-account-center',
  'https://nakwol-auth.sepsd21.workers.dev/account',
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
  owner_user_id = NULL,
  updated_at = excluded.updated_at;

INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at)
VALUES (
  'nakwol-auth-lab',
  'NAKWOL AUTH Lab',
  '["https://nakwol-auth.sepsd21.workers.dev/lab"]',
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
  'nakwol-auth-lab',
  'https://nakwol-auth.sepsd21.workers.dev/lab',
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
  owner_user_id = NULL,
  updated_at = excluded.updated_at;
