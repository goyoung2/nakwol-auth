ALTER TABLE auth_codes ADD COLUMN auth_session_hash TEXT;
CREATE TABLE site_credentials (
 id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL REFERENCES applications(client_id),
 site_origin TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE site_credential_audit (
 id TEXT PRIMARY KEY, credential_id TEXT NOT NULL, client_id TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE server_sessions (
 id TEXT PRIMARY KEY, handle_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
 client_id TEXT NOT NULL, site_origin TEXT NOT NULL, credential_id TEXT NOT NULL REFERENCES site_credentials(id),
 auth_session_hash TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, idle_expires_at INTEGER NOT NULL,
 absolute_expires_at INTEGER NOT NULL, idle_seconds INTEGER NOT NULL, absolute_seconds INTEGER NOT NULL,
 revoked_at INTEGER, source TEXT NOT NULL, verified_at INTEGER NOT NULL, lease_until INTEGER NOT NULL,
 evidence_until INTEGER NOT NULL, policy_version INTEGER NOT NULL
);
CREATE INDEX server_sessions_family ON server_sessions(auth_session_hash);
CREATE INDEX server_sessions_credential ON server_sessions(credential_id);
