PRAGMA foreign_keys = ON;

INSERT INTO data_applications(client_id, status, created_at, updated_at)
VALUES ('nakwol-my-data', 'active', unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(client_id) DO UPDATE SET
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO data_application_scopes(client_id, scope, created_at) VALUES
  ('nakwol-my-data', 'profile:read', unixepoch() * 1000),
  ('nakwol-my-data', 'profile:write', unixepoch() * 1000),
  ('nakwol-my-data', 'roster:read', unixepoch() * 1000),
  ('nakwol-my-data', 'roster:write', unixepoch() * 1000),
  ('nakwol-my-data', 'equipment:read', unixepoch() * 1000),
  ('nakwol-my-data', 'equipment:write', unixepoch() * 1000),
  ('nakwol-my-data', 'decks:read', unixepoch() * 1000),
  ('nakwol-my-data', 'decks:write', unixepoch() * 1000)
ON CONFLICT(client_id,scope) DO NOTHING;
