ALTER TABLE server_sessions ADD COLUMN control_version INTEGER NOT NULL DEFAULT 0;
CREATE TABLE gate_control_outbox (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(16)))),
 client_id TEXT NOT NULL, policy_operation_id TEXT, created_at INTEGER NOT NULL DEFAULT (CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),
 status TEXT NOT NULL DEFAULT 'pending', published_at INTEGER, observed_at INTEGER
);
CREATE INDEX gate_control_pending ON gate_control_outbox(client_id,status,seq);
CREATE UNIQUE INDEX gate_control_operation ON gate_control_outbox(operation_id);
CREATE INDEX gate_control_policy_operation ON gate_control_outbox(policy_operation_id,status);
CREATE INDEX auth_policy_operations_scope_version ON auth_policy_operations(scope,version);
CREATE INDEX gate_control_version ON gate_control_outbox(client_id,seq);
CREATE INDEX server_sessions_control ON server_sessions(client_id,revoked_at,absolute_expires_at);
INSERT INTO gate_control_outbox(client_id) SELECT client_id FROM applications;
CREATE TRIGGER control_app_insert AFTER INSERT ON applications BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_app_update AFTER UPDATE OF status,redirect_uris ON applications WHEN NEW.status IS NOT OLD.status OR NEW.redirect_uris IS NOT OLD.redirect_uris BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_policy_insert AFTER INSERT ON auth_policy_settings BEGIN
 INSERT INTO gate_control_outbox(client_id,policy_operation_id) SELECT client_id,(SELECT id FROM auth_policy_operations WHERE scope=NEW.scope AND version=NEW.version LIMIT 1) FROM applications WHERE NEW.scope='global' OR NEW.scope='app:'||client_id;
END;
CREATE TRIGGER control_policy_update AFTER UPDATE ON auth_policy_settings BEGIN
 INSERT INTO gate_control_outbox(client_id,policy_operation_id) SELECT client_id,(SELECT id FROM auth_policy_operations WHERE scope=NEW.scope AND version=NEW.version LIMIT 1) FROM applications WHERE NEW.scope='global' OR NEW.scope='app:'||client_id;
END;
CREATE TRIGGER control_deny_insert AFTER INSERT ON application_access_denies BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT client_id FROM applications WHERE NEW.scope='global' OR NEW.scope='app:'||client_id;
END;
CREATE TRIGGER control_deny_update AFTER UPDATE ON application_access_denies BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT client_id FROM applications WHERE NEW.scope='global' OR NEW.scope='app:'||client_id;
END;
CREATE TRIGGER control_user AFTER UPDATE OF status ON users WHEN NEW.status IS NOT OLD.status BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.id;
END;
CREATE TRIGGER control_reauth_insert AFTER INSERT ON user_reauthentication BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER control_reauth_update AFTER UPDATE ON user_reauthentication BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER control_session AFTER UPDATE OF revoked_at ON server_sessions WHEN NEW.revoked_at IS NOT OLD.revoked_at BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_family BEFORE DELETE ON auth_sessions BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE auth_session_hash=OLD.token_hash;
END;
CREATE TRIGGER control_credential AFTER UPDATE OF revoked_at ON site_credentials WHEN NEW.revoked_at IS NOT OLD.revoked_at BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_membership AFTER UPDATE OF role,role_ids,status,is_guild_member ON memberships WHEN NEW.role IS NOT OLD.role OR NEW.role_ids IS NOT OLD.role_ids OR NEW.status IS NOT OLD.status OR NEW.is_guild_member IS NOT OLD.is_guild_member BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER control_grant_update AFTER UPDATE ON application_access_grants BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_grant_insert AFTER INSERT ON application_access_grants BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_settings_insert AFTER INSERT ON application_settings BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_settings_update AFTER UPDATE OF access_policy ON application_settings WHEN NEW.access_policy IS NOT OLD.access_policy BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_rules_delete AFTER DELETE ON application_role_requirements BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(OLD.client_id);
END;
CREATE TRIGGER control_membership_delete BEFORE DELETE ON memberships BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER control_discord_state AFTER UPDATE OF state ON discord_credentials WHEN NEW.state IS NOT OLD.state BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER control_operator_delete AFTER DELETE ON auth_operators BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER control_developer_update AFTER UPDATE OF role,status ON connect_developers WHEN NEW.role IS NOT OLD.role OR NEW.status IS NOT OLD.status BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER control_developer_delete BEFORE DELETE ON connect_developers BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER control_grant_delete BEFORE DELETE ON application_access_grants BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(OLD.client_id);
END;
CREATE TRIGGER control_settings_delete BEFORE DELETE ON application_settings BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(OLD.client_id);
END;
CREATE TRIGGER control_identity_update AFTER UPDATE OF user_id,provider,provider_user_id ON auth_identities WHEN NEW.user_id IS NOT OLD.user_id OR NEW.provider IS NOT OLD.provider OR NEW.provider_user_id IS NOT OLD.provider_user_id BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id IN (NEW.user_id,OLD.user_id);
END;
CREATE TRIGGER control_identity_delete BEFORE DELETE ON auth_identities BEGIN
 INSERT INTO gate_control_outbox(client_id) SELECT DISTINCT client_id FROM server_sessions WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER control_rules_insert AFTER INSERT ON application_role_requirements BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
CREATE TRIGGER control_rules_update AFTER UPDATE ON application_role_requirements BEGIN
 INSERT INTO gate_control_outbox(client_id) VALUES(NEW.client_id);
END;
