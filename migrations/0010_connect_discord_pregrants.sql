PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connect_developer_pregrants (
  discord_user_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'developer' CHECK(role IN ('developer','operator')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  linked_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  linked_at INTEGER,
  created_by_user_id TEXT,
  FOREIGN KEY(linked_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_connect_developer_pregrants_linked_user
  ON connect_developer_pregrants(linked_user_id);

ALTER TABLE connect_developers
  ADD COLUMN grant_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE connect_developers
  ADD COLUMN discord_user_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_developers_discord_user_id
  ON connect_developers(discord_user_id)
  WHERE discord_user_id IS NOT NULL;