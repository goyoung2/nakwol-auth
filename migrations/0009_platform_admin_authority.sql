PRAGMA foreign_keys = ON;

-- Preserve any historical Discord-derived membership admin as an explicit
-- NAKWOL platform operator before removing admin semantics from membership.
INSERT INTO auth_operators(user_id, role, created_at, created_by_user_id)
SELECT m.user_id, 'operator', unixepoch() * 1000, NULL
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.role = 'admin' AND u.status = 'active'
ON CONFLICT(user_id) DO NOTHING;

-- One-time compatibility bridge: Connect "operator" already meant a trusted
-- whole-platform app operator. Existing active operators inherit platform
-- admin now, but future Connect operator grants do not automatically sync.
INSERT INTO auth_operators(user_id, role, created_at, created_by_user_id)
SELECT cd.user_id,
       'operator',
       CASE WHEN cd.created_at > 0 THEN cd.created_at ELSE unixepoch() * 1000 END,
       cd.created_by_user_id
FROM connect_developers cd
JOIN users u ON u.id = cd.user_id
WHERE cd.role = 'operator'
  AND cd.status = 'active'
  AND u.status = 'active'
ON CONFLICT(user_id) DO NOTHING;

-- Discord membership proves membership only. Remove the historical admin
-- meaning while preserving the fact that a previously-active admin was a
-- verified guild member.
UPDATE memberships
SET role = CASE WHEN is_guild_member = 1 THEN 'member' ELSE 'user' END,
    status = CASE WHEN is_guild_member = 1 THEN 'active' ELSE 'inactive' END
WHERE role = 'admin';
