CREATE TABLE membership_qualifications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE application_qualification_requirements (
  client_id TEXT PRIMARY KEY REFERENCES applications(client_id) ON DELETE CASCADE,
  match_mode TEXT NOT NULL CHECK(match_mode IN ('any', 'all')),
  qualification_ids TEXT NOT NULL CHECK(json_valid(qualification_ids) AND json_type(qualification_ids) = 'array'),
  updated_at INTEGER NOT NULL
);

CREATE TRIGGER qualification_policy_settings_insert
BEFORE INSERT ON application_settings
WHEN NEW.access_policy <> 'member' AND EXISTS (
  SELECT 1 FROM application_qualification_requirements WHERE client_id = NEW.client_id
)
BEGIN
  SELECT RAISE(ABORT, 'CUSTOM_QUALIFICATIONS_ACTIVE');
END;

CREATE TRIGGER qualification_policy_settings_update
BEFORE UPDATE OF access_policy, client_id ON application_settings
WHEN NEW.access_policy <> 'member' AND EXISTS (
  SELECT 1 FROM application_qualification_requirements WHERE client_id = NEW.client_id
)
BEGIN
  SELECT RAISE(ABORT, 'CUSTOM_QUALIFICATIONS_ACTIVE');
END;

CREATE TRIGGER qualification_policy_requirements_insert
BEFORE INSERT ON application_qualification_requirements
WHEN COALESCE((SELECT access_policy FROM application_settings WHERE client_id = NEW.client_id), 'member') <> 'member'
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_POLICY_REQUIRED');
END;

CREATE TRIGGER qualification_policy_requirements_update
BEFORE UPDATE ON application_qualification_requirements
WHEN COALESCE((SELECT access_policy FROM application_settings WHERE client_id = NEW.client_id), 'member') <> 'member'
BEGIN
  SELECT RAISE(ABORT, 'MEMBER_POLICY_REQUIRED');
END;
