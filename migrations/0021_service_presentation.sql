CREATE TABLE service_presentations (
 client_id TEXT PRIMARY KEY REFERENCES applications(client_id), version INTEGER NOT NULL DEFAULT 0,
 draft TEXT NOT NULL, published_version INTEGER, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, mutation_id TEXT NOT NULL
);
CREATE TABLE service_presentation_versions (
 client_id TEXT NOT NULL REFERENCES applications(client_id), version INTEGER NOT NULL, document TEXT NOT NULL,
 created_at INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY(client_id,version)
);
CREATE TABLE service_brand_assets (
 client_id TEXT NOT NULL REFERENCES applications(client_id), id TEXT NOT NULL, mime TEXT NOT NULL,
 bytes BLOB NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL,
 actor TEXT NOT NULL, PRIMARY KEY(client_id,id)
);
CREATE TABLE service_presentation_audit (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, version INTEGER NOT NULL, action TEXT NOT NULL,
 actor TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL
);
