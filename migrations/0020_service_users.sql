CREATE TABLE app_user_relationships (
 client_id TEXT NOT NULL REFERENCES applications(client_id) ON DELETE CASCADE,
 subject TEXT NOT NULL, discord_id TEXT NOT NULL, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
 display_name TEXT, first_authorized_at INTEGER, last_authenticated_at INTEGER, last_observed_at INTEGER,
 observation_received_at INTEGER, last_attempt_at INTEGER, status TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(client_id,subject), UNIQUE(client_id,discord_id)
);
CREATE INDEX service_users_page ON app_user_relationships(client_id,subject);
CREATE TABLE service_user_grants (
 client_id TEXT NOT NULL, discord_id TEXT NOT NULL, conditions_json TEXT NOT NULL, expires_at INTEGER NOT NULL,
 updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(client_id,discord_id)
);
CREATE TABLE service_user_operations (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL, subject TEXT NOT NULL, actor TEXT NOT NULL,
 action TEXT NOT NULL, reason TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_json TEXT NOT NULL,
 before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(client_id,actor,idempotency_key)
);
CREATE TABLE service_user_observations (
 client_id TEXT NOT NULL, subject TEXT NOT NULL, bucket INTEGER NOT NULL,
 site_origin TEXT NOT NULL, observed_at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(client_id,subject,bucket),
 FOREIGN KEY(client_id,subject) REFERENCES app_user_relationships(client_id,subject) ON DELETE CASCADE
);
CREATE TABLE service_anonymous_attempts (
 client_id TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL,
 PRIMARY KEY(client_id,bucket)
);
CREATE TABLE service_observation_drops (
 client_id TEXT NOT NULL, site_origin TEXT NOT NULL, bucket INTEGER NOT NULL, dropped INTEGER NOT NULL,
 PRIMARY KEY(client_id,site_origin,bucket)
);
CREATE TRIGGER service_auth_code AFTER INSERT ON auth_codes BEGIN
 INSERT INTO app_user_relationships(client_id,subject,discord_id,user_id,display_name,first_authorized_at,last_authenticated_at,status)
 SELECT NEW.client_id,lower(hex(randomblob(18))),i.provider_user_id,u.id,u.display_name,NEW.created_at,NEW.created_at,'authorized'
 FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=NEW.user_id AND i.provider='discord'
 ON CONFLICT(client_id,discord_id) DO UPDATE SET user_id=excluded.user_id,display_name=excluded.display_name,
 first_authorized_at=COALESCE(first_authorized_at,excluded.first_authorized_at),last_authenticated_at=MAX(COALESCE(last_authenticated_at,0),excluded.last_authenticated_at),status='authorized';
END;
CREATE TRIGGER service_token AFTER INSERT ON access_tokens BEGIN
 INSERT INTO app_user_relationships(client_id,subject,discord_id,user_id,display_name,first_authorized_at,last_authenticated_at,status)
 SELECT NEW.client_id,lower(hex(randomblob(18))),i.provider_user_id,u.id,u.display_name,NEW.created_at,NEW.created_at,'authorized'
 FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=NEW.user_id AND i.provider='discord'
 ON CONFLICT(client_id,discord_id) DO UPDATE SET user_id=excluded.user_id,display_name=excluded.display_name,
 first_authorized_at=COALESCE(first_authorized_at,excluded.first_authorized_at),last_authenticated_at=MAX(COALESCE(last_authenticated_at,0),excluded.last_authenticated_at),status='authorized';
END;
CREATE TRIGGER service_server_session AFTER INSERT ON server_sessions BEGIN
 INSERT INTO app_user_relationships(client_id,subject,discord_id,user_id,display_name,first_authorized_at,last_authenticated_at,status)
 SELECT NEW.client_id,lower(hex(randomblob(18))),i.provider_user_id,u.id,u.display_name,NEW.created_at,NEW.created_at,'authorized'
 FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=NEW.user_id AND i.provider='discord'
 ON CONFLICT(client_id,discord_id) DO UPDATE SET user_id=excluded.user_id,display_name=excluded.display_name,
 first_authorized_at=COALESCE(first_authorized_at,excluded.first_authorized_at),last_authenticated_at=MAX(COALESCE(last_authenticated_at,0),excluded.last_authenticated_at),status='authorized';
END;
CREATE TRIGGER service_rejection AFTER INSERT ON auth_events WHEN NEW.event_type IN ('authorize.access_denied','discord.login.access_denied','access.support') AND NEW.client_id IS NOT NULL AND NEW.user_id IS NOT NULL BEGIN
 INSERT INTO app_user_relationships(client_id,subject,discord_id,user_id,display_name,last_attempt_at,status)
 SELECT NEW.client_id,lower(hex(randomblob(18))),i.provider_user_id,u.id,u.display_name,NEW.created_at,'denied'
 FROM auth_identities i JOIN users u ON u.id=i.user_id WHERE i.user_id=NEW.user_id AND i.provider='discord'
 ON CONFLICT(client_id,discord_id) DO UPDATE SET user_id=excluded.user_id,display_name=excluded.display_name,last_attempt_at=excluded.last_attempt_at,status='denied';
END;
CREATE TRIGGER service_anonymous AFTER INSERT ON auth_events WHEN NEW.user_id IS NULL AND NEW.client_id IS NOT NULL AND NEW.event_type='discord.login.error' BEGIN
 INSERT INTO service_anonymous_attempts VALUES(NEW.client_id,CAST(NEW.created_at/86400000 AS INTEGER)*86400000,1)
 ON CONFLICT(client_id,bucket) DO UPDATE SET count=count+1;
END;
INSERT INTO app_user_relationships(client_id,subject,discord_id,user_id,display_name,first_authorized_at,last_authenticated_at,status)
 SELECT activity.client_id,lower(hex(randomblob(18))),i.provider_user_id,u.id,u.display_name,MIN(activity.at),MAX(activity.at),'authorized'
 FROM (SELECT client_id,user_id,created_at AS at FROM auth_codes UNION ALL SELECT client_id,user_id,created_at FROM access_tokens UNION ALL SELECT client_id,user_id,created_at FROM server_sessions) activity
 JOIN auth_identities i ON i.user_id=activity.user_id AND i.provider='discord' JOIN users u ON u.id=i.user_id
 GROUP BY activity.client_id,i.provider_user_id;
