INSERT INTO applications(client_id, name, redirect_uris, status, created_at, updated_at)
VALUES (
  'nakwol-auth-selftest',
  'NAKWOL AUTH Self Test',
  '["https://nakwol-auth.sepsd21.workers.dev/demo/callback"]',
  'active',
  unixepoch() * 1000,
  unixepoch() * 1000
)
ON CONFLICT(client_id) DO UPDATE SET
  name = excluded.name,
  redirect_uris = excluded.redirect_uris,
  status = 'active',
  updated_at = excluded.updated_at;
