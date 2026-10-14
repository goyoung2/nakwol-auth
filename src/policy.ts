import { sha256Base64Url } from './crypto';
import type { Env } from './types';
import type { MembershipRow } from './types';
import { getAuthLabPrivilege } from './platform-access';
import { parseRequiredRoleIds, RoleSettingsError } from './role-settings';
import { evaluateQualificationSnapshot } from './qualifications';

export const MEMBERSHIP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const NAKWOL_CONNECT_POLICY_VERSION = '0.2.0';
export type ApplicationAccessPolicy = 'guest' | 'member' | 'admin' | 'lab';

export async function getApplicationAccessPolicy(env: Env, clientId: string): Promise<ApplicationAccessPolicy> {
  const row = await env.DB.prepare(
    `SELECT access_policy FROM application_settings WHERE client_id = ?`
  ).bind(clientId).first<{ access_policy: string }>();

  if (row?.access_policy === 'public') return 'guest';
  if (
    row?.access_policy === 'guest' ||
    row?.access_policy === 'member' ||
    row?.access_policy === 'admin' ||
    row?.access_policy === 'lab'
  ) return row.access_policy;

  return 'member';
}

export async function isPlatformAdmin(env: Env, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT ao.user_id
       FROM auth_operators ao
       JOIN users u ON u.id = ao.user_id
      WHERE ao.user_id = ? AND u.status = 'active'
      LIMIT 1`
  ).bind(userId).first<{ user_id: string }>();
  return Boolean(row?.user_id);
}

export async function isApplicationAccessAllowed(env: Env, userId: string, clientId: string, requireMember = false): Promise<boolean> {
  return (await diagnoseApplicationAccess(env, userId, clientId, requireMember)).allowed;
}

type AccessUser = {
  readonly id: string; readonly display_name: string; readonly avatar_url: string | null; readonly status: string;
  readonly membership: { readonly is_guild_member: boolean; readonly is_member: boolean;
    readonly role: MembershipRow['role']; readonly checked_at: number | null; };
};

type AccessSnapshot = {
  readonly application_name: string;
  readonly redirect_uris: string;
  readonly token_expires_at: number | null;
  readonly application_status: string | null;
  readonly access_policy: string | null;
  readonly user_id: string | null;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly user_status: string;
  readonly is_guild_member: number | null;
  readonly membership_role: MembershipRow['role'] | null;
  readonly membership_status: string | null;
  readonly checked_at: number | null;
  readonly role_ids: string | null;
  readonly required_role_ids: string | null;
  readonly qualification_client_id: string | null;
  readonly qualification_match_mode: string | null;
  readonly qualification_ids: string | null;
  readonly qualifications: string | null;
  readonly requested_at: number | null;
  readonly grant_status: string | null;
};

class AccessSnapshotError extends Error {}

export async function inspectApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  return inspectAccessSnapshot(env, userId, clientId, requireMember, null);
}

export async function inspectApplicationTokenAccess(env: Env, token: string, clientId: string, requireMember = false) {
  return inspectAccessSnapshot(env, '', clientId, requireMember, await sha256Base64Url(token));
}

async function inspectAccessSnapshot(env: Env, userId: string, clientId: string, requireMember: boolean, tokenHash: string | null) {
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT a.name AS application_name, a.redirect_uris, t.expires_at AS token_expires_at, a.status AS application_status, s.access_policy, u.id AS user_id,
       COALESCE(u.display_name, '') AS display_name, u.avatar_url, COALESCE(u.status, '') AS user_status,
       m.is_guild_member, m.role AS membership_role, m.status AS membership_status, m.checked_at, m.role_ids,
       rr.role_ids AS required_role_ids, r.requested_at,
       qr.client_id AS qualification_client_id, qr.match_mode AS qualification_match_mode, qr.qualification_ids,
       (SELECT json_group_array(json_object('id', q.id, 'role_id', q.role_id, 'status', q.status))
          FROM membership_qualifications q WHERE q.id IN
            (SELECT value FROM json_each(CASE WHEN json_valid(qr.qualification_ids) THEN qr.qualification_ids ELSE '[]' END))) AS qualifications,
       (SELECT g.status FROM application_access_grants g
          JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = g.discord_user_id
          WHERE i.user_id = u.id AND g.client_id = input.client_id) AS grant_status
     FROM (SELECT ? AS user_id, ? AS client_id) input
     LEFT JOIN access_tokens t ON t.token_hash = ? AND t.client_id = input.client_id
       AND t.revoked_at IS NULL AND t.expires_at > ?
       AND NOT EXISTS (SELECT 1 FROM user_reauthentication tr WHERE tr.user_id = t.user_id AND t.created_at <= tr.requested_at)
     LEFT JOIN users u ON u.id = CASE WHEN ? IS NULL THEN input.user_id ELSE t.user_id END
     LEFT JOIN applications a ON a.client_id = input.client_id
     LEFT JOIN application_settings s ON s.client_id = input.client_id
     LEFT JOIN memberships m ON m.user_id = u.id AND m.guild_id = ?
     LEFT JOIN application_role_requirements rr ON rr.client_id = input.client_id
     LEFT JOIN application_qualification_requirements qr ON qr.client_id = input.client_id
     LEFT JOIN user_reauthentication r ON r.user_id = u.id`
  ).bind(userId, clientId, tokenHash, now, tokenHash, env.NAKWOL_GUILD_ID).first<AccessSnapshot>();
  if (!row) throw new AccessSnapshotError('AUTHORIZATION_SNAPSHOT_UNAVAILABLE');
  const user = row.user_id ? {
    id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url, status: row.user_status,
    membership: {
      is_guild_member: Boolean(row.is_guild_member),
      is_member: row.membership_role === 'member' && row.membership_status === 'active' && Boolean(row.is_guild_member),
      role: row.membership_role ?? 'user', checked_at: row.checked_at,
    },
  } : null;
  const access = await diagnoseSnapshot(env, user?.id ?? '', row, user, requireMember);
  const effectiveUser = user && access.allowed && access.qualification_mode === 'custom' && access.reason === 'POLICY_ALLOWED'
    ? { ...user, membership: { ...user.membership, is_member: true, global_is_member: user.membership.is_member, scope: 'application' as const } }
    : user;
  return { user: effectiveUser, access, tokenExpiresAt: row.token_expires_at,
    application: row.application_status === null ? null : { client_id: clientId, name: row.application_name,
      redirect_uris: row.redirect_uris, status: row.application_status } };
}

export async function diagnoseApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  return (await inspectApplicationAccess(env, userId, clientId, requireMember)).access;
}

async function diagnoseSnapshot(env: Env, userId: string, row: AccessSnapshot,
  user: AccessUser | null, requireMember: boolean) {
  const policy: ApplicationAccessPolicy = row.access_policy === 'public' ? 'guest'
    : row.access_policy === 'guest' || row.access_policy === 'admin' || row.access_policy === 'lab' ? row.access_policy : 'member';
  let requiredValue: unknown = [];
  const customQualifications = row.qualification_client_id != null;
  if (!customQualifications && row.required_role_ids !== null) {
    try { requiredValue = JSON.parse(row.required_role_ids); }
    catch (error) {
      if (error instanceof SyntaxError) throw new RoleSettingsError('Invalid stored role requirements');
      throw error;
    }
  }
  const requiredRoles = parseRequiredRoleIds(requiredValue);
  const membership = { role_ids: row.role_ids };
  const reauth = row.requested_at === null ? null : { requested_at: row.requested_at };
  const grant = { status: row.grant_status };
  const application = { status: row.application_status };
  let parsed: unknown = null;
  try { parsed = JSON.parse(membership?.role_ids ?? 'null'); } catch { parsed = null; }
  const roles: string[] = Array.isArray(parsed) && parsed.every((id: unknown) => typeof id === 'string') ? parsed : [];
  const seasonRole = env.NAKWOL_MEMBER_ROLE_ID?.trim() || '';
  const qualification = customQualifications ? evaluateQualificationSnapshot({ match_mode: row.qualification_match_mode,
    qualification_ids: row.qualification_ids, qualifications: row.qualifications }, roles) : null;
  const result = (allowed: boolean, reason: string) => ({ allowed, reason, policy,
    qualification_mode: customQualifications ? 'custom' : 'legacy', qualification_match_mode: qualification?.match_mode ?? null,
    qualification_ids: qualification?.qualification_ids ?? [],
    season_role_id: seasonRole, role_ids: roles, missing_role_ids: qualification?.missing_role_ids ?? [seasonRole, ...requiredRoles].filter(id => id && !roles.includes(id)),
    checked_at: user?.membership.checked_at ?? null, manual_grant: grant?.status === 'active',
    reauthentication_requested_at: reauth?.requested_at ?? null,
    reauthentication_status: reauth ? (Number(user?.membership.checked_at ?? 0) > reauth.requested_at ? 'completed' : 'pending') : null });
  if (application?.status !== 'active') return result(false, 'APP_DISABLED');
  if (!user || user.status !== 'active') return result(false, 'USER_DISABLED');
  if (reauth && Number(user.membership.checked_at ?? 0) <= reauth.requested_at) return result(false, 'REAUTHENTICATION_REQUIRED');
  if (customQualifications && policy !== 'member') return result(false, 'QUALIFICATION_CONFIGURATION_INVALID');
  // Explicit service grants replace member role requirements, never AUTH operator/lab privileges.
  if ((policy === 'member' || policy === 'guest') && grant?.status === 'active') return result(true, 'MANUAL_GRANT');
  if (policy === 'member' || requireMember || requiredRoles.length > 0 || customQualifications) {
    const checkedAt = Number(user.membership.checked_at);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > Date.now() || Date.now() - checkedAt >= MEMBERSHIP_MAX_AGE_MS) return result(false, 'MEMBERSHIP_REFRESH_REQUIRED');
    if (qualification) {
      if (!qualification.valid) return result(false, 'QUALIFICATION_CONFIGURATION_INVALID');
      if (!user.membership.is_guild_member) return result(false, 'MEMBERSHIP_INACTIVE');
      if (!qualification.matched) return result(false, 'QUALIFICATION_MISSING');
    } else {
      if (!seasonRole) return result(false, 'SEASON_ROLE_NOT_CONFIGURED');
      if (!roles.includes(seasonRole)) return result(false, 'SEASON_ROLE_MISSING');
      if (!user.membership.is_member) return result(false, 'MEMBERSHIP_INACTIVE');
      if (!requiredRoles.every(id => roles.includes(id))) return result(false, 'ADDITIONAL_ROLE_MISSING');
    }
  }
  switch (policy) {
    case 'guest':
    case 'member': return result(true, 'POLICY_ALLOWED');
    case 'admin': {
      const allowed = await isPlatformAdmin(env, userId);
      return result(allowed, allowed ? 'POLICY_ALLOWED' : 'AUTH_OPERATOR_REQUIRED');
    }
    case 'lab': {
      const privilege = await getAuthLabPrivilege(env, userId);
      return result(privilege.canUseLab, privilege.canUseLab ? 'POLICY_ALLOWED' : 'LAB_PRIVILEGE_REQUIRED');
    }
  }
}
