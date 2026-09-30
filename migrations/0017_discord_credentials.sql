CREATE TABLE discord_credentials (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 access_ciphertext TEXT NOT NULL, refresh_ciphertext TEXT NOT NULL,
 key_version INTEGER NOT NULL, scope TEXT NOT NULL, access_expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','reauth_required')),
 generation INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until INTEGER,
 retry_after INTEGER, last_error TEXT, updated_at INTEGER NOT NULL
);
ALTER TABLE user_reauthentication ADD COLUMN completed_at INTEGER;
CREATE TABLE membership_refresh_policy (
 id INTEGER PRIMARY KEY CHECK(id = 1), legacy_deadline_at INTEGER NOT NULL
);
INSERT INTO membership_refresh_policy(id, legacy_deadline_at)
VALUES (1, CAST(unixepoch('now') * 1000 AS INTEGER) + 30 * 24 * 60 * 60 * 1000);
