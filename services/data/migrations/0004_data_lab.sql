PRAGMA foreign_keys = ON;

INSERT INTO data_applications(client_id, status, created_at, updated_at)
VALUES ('nakwol-data-lab', 'active', unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(client_id) DO UPDATE SET
  status = 'active',
  updated_at = excluded.updated_at;

INSERT INTO data_application_scopes(client_id, scope, created_at) VALUES
  ('nakwol-data-lab', 'profile:read', unixepoch() * 1000),
  ('nakwol-data-lab', 'profile:write', unixepoch() * 1000),
  ('nakwol-data-lab', 'roster:read', unixepoch() * 1000),
  ('nakwol-data-lab', 'roster:write', unixepoch() * 1000),
  ('nakwol-data-lab', 'equipment:read', unixepoch() * 1000),
  ('nakwol-data-lab', 'equipment:write', unixepoch() * 1000),
  ('nakwol-data-lab', 'decks:read', unixepoch() * 1000),
  ('nakwol-data-lab', 'decks:write', unixepoch() * 1000)
ON CONFLICT(client_id,scope) DO NOTHING;
