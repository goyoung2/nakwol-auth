ALTER TABLE membership_qualifications ADD COLUMN developer_selectable INTEGER NOT NULL DEFAULT 0 CHECK(developer_selectable IN (0,1));

UPDATE applications
SET redirect_uris = (SELECT json_group_array(value) FROM (
  SELECT DISTINCT value FROM json_each(applications.redirect_uris)
  UNION SELECT 'https://nakwol-auth.sepsd21.workers.dev/developer/apps'
  UNION SELECT 'https://nakwol-auth-vercel.vercel.app/developer/apps'
)), updated_at = unixepoch() * 1000
WHERE client_id = 'nakwol-connect-admin';
