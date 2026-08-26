PRAGMA foreign_keys = ON;

CREATE TABLE data_registry_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE game_formations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE game_warbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  quality TEXT,
  type TEXT,
  related_tactic_id TEXT,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(related_tactic_id) REFERENCES game_tactics(id) ON DELETE SET NULL
);
CREATE INDEX idx_game_warbooks_related_tactic ON game_warbooks(related_tactic_id);

UPDATE data_schema_meta SET value = '2' WHERE key = 'schema_version';
