-- Diagnostics are operational evidence only, never an authorization grant.
CREATE TABLE diagnostic_reports (
  reference TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  capability_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  received_at INTEGER,
  browser_json TEXT,
  network_json TEXT NOT NULL,
  writes INTEGER NOT NULL DEFAULT 0 CHECK(writes BETWEEN 0 AND 4)
);
CREATE INDEX diagnostic_reports_app_time ON diagnostic_reports(client_id,created_at DESC);
CREATE TABLE diagnostic_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL REFERENCES diagnostic_reports(reference) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  network_json TEXT NOT NULL
);
CREATE INDEX diagnostic_stages_reference ON diagnostic_stages(reference,id);
CREATE TABLE diagnostic_rate_guards (
  guard_hash TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
ALTER TABLE oauth_requests ADD COLUMN diagnostic_ref TEXT;
