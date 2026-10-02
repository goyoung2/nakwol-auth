CREATE TABLE service_setups (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL REFERENCES applications(client_id),
 version INTEGER NOT NULL, document_json TEXT NOT NULL, request_json TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX service_setups_actor_app ON service_setups(actor_id,client_id,updated_at);
CREATE TABLE service_setup_creations (
 actor_id TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL, client_id TEXT NOT NULL UNIQUE,
 request_json TEXT NOT NULL, mutation_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(actor_id,idempotency_key)
);
CREATE TABLE service_setup_credentials (
 setup_id TEXT PRIMARY KEY REFERENCES service_setups(id), credential_id TEXT NOT NULL UNIQUE REFERENCES site_credentials(id)
);
