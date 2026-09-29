ALTER TABLE application_access_grants ADD COLUMN expires_at INTEGER;
UPDATE application_access_grants SET expires_at = updated_at + 604800000;
CREATE TABLE application_access_denies (
  scope TEXT NOT NULL, discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  reason TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id),
  updated_at INTEGER NOT NULL, expires_at INTEGER,
  PRIMARY KEY(scope, discord_user_id)
);
CREATE TABLE auth_policy_revision (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO auth_policy_revision VALUES(1,0);
CREATE TABLE auth_policy_settings (
  scope TEXT PRIMARY KEY, version INTEGER NOT NULL, settings_json TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id), updated_at INTEGER NOT NULL
);
CREATE TABLE auth_policy_operations (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, version INTEGER NOT NULL,
  actor TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
  before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  delivery_status TEXT NOT NULL DEFAULT 'pending'
);
CREATE TABLE auth_policy_previews (
  token TEXT PRIMARY KEY, actor TEXT NOT NULL, scope TEXT NOT NULL,
  version INTEGER NOT NULL, patch_json TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE service_management_rate_limits (
  bucket_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
);
