import type { Env } from './types';
import type { MembershipRow } from './types';
import { getAuthLabPrivilege } from './platform-access';
import { parseRequiredRoleIds, RoleSettingsError } from './role-settings';

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
  readonly requested_at: number | null;
  readonly grant_status: string | null;
};

class AccessSnapshotError extends Error {}

export async function inspectApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  const row = await env.DB.prepare(
    `SELECT a.status AS application_status, s.access_policy, u.id AS user_id,
       COALESCE(u.display_name, '') AS display_name, u.avatar_url, COALESCE(u.status, '') AS user_status,
       m.is_guild_member, m.role AS membership_role, m.status AS membership_status, m.checked_at, m.role_ids,
       rr.role_ids AS required_role_ids, r.requested_at,
       (SELECT g.status FROM application_access_grants g
          JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = g.discord_user_id
          WHERE i.user_id = input.user_id AND g.client_id = input.client_id) AS grant_status
     FROM (SELECT ? AS user_id, ? AS client_id) input
     LEFT JOIN users u ON u.id = input.user_id
     LEFT JOIN applications a ON a.client_id = input.client_id
     LEFT JOIN application_settings s ON s.client_id = input.client_id
     LEFT JOIN memberships m ON m.user_id = input.user_id AND m.guild_id = ?
     LEFT JOIN application_role_requirements rr ON rr.client_id = input.client_id
     LEFT JOIN user_reauthentication r ON r.user_id = input.user_id`
  ).bind(userId, clientId, env.NAKWOL_GUILD_ID).first<AccessSnapshot>();
  if (!row) throw new AccessSnapshotError('AUTHORIZATION_SNAPSHOT_UNAVAILABLE');
  const user = row.user_id ? {
    id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url, status: row.user_status,
    membership: {
      is_guild_member: Boolean(row.is_guild_member),
      is_member: row.membership_role === 'member' && row.membership_status === 'active' && Boolean(row.is_guild_member),
      role: row.membership_role ?? 'user', checked_at: row.checked_at,
    },
  } : null;
  return { user, access: await diagnoseSnapshot(env, userId, row, user, requireMember) };
}

export async function diagnoseApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  return (await inspectApplicationAccess(env, userId, clientId, requireMember)).access;
}

async function diagnoseSnapshot(env: Env, userId: string, row: AccessSnapshot,
  user: AccessUser | null, requireMember: boolean) {
  const policy: ApplicationAccessPolicy = row.access_policy === 'public' ? 'guest'
    : row.access_policy === 'guest' || row.access_policy === 'admin' || row.access_policy === 'lab' ? row.access_policy : 'member';
  let requiredValue: unknown = [];
  if (row.required_role_ids !== null) {
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
  const result = (allowed: boolean, reason: string) => ({ allowed, reason, policy,
    season_role_id: seasonRole, role_ids: roles, missing_role_ids: [seasonRole, ...requiredRoles].filter(id => id && !roles.includes(id)),
    checked_at: user?.membership.checked_at ?? null, manual_grant: grant?.status === 'active',
    reauthentication_requested_at: reauth?.requested_at ?? null,
    reauthentication_status: reauth ? (Number(user?.membership.checked_at ?? 0) > reauth.requested_at ? 'completed' : 'pending') : null });
  if (application?.status !== 'active') return result(false, 'APP_DISABLED');
  if (!user || user.status !== 'active') return result(false, 'USER_DISABLED');
  if (reauth && Number(user.membership.checked_at ?? 0) <= reauth.requested_at) return result(false, 'REAUTHENTICATION_REQUIRED');
  // Explicit service grants replace member role requirements, never AUTH operator/lab privileges.
  if ((policy === 'member' || policy === 'guest') && grant?.status === 'active') return result(true, 'MANUAL_GRANT');
  if (policy === 'member' || requireMember || requiredRoles.length > 0) {
    const checkedAt = Number(user.membership.checked_at);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > Date.now() || Date.now() - checkedAt >= MEMBERSHIP_MAX_AGE_MS) return result(false, 'MEMBERSHIP_REFRESH_REQUIRED');
    if (!seasonRole) return result(false, 'SEASON_ROLE_NOT_CONFIGURED');
    if (!roles.includes(seasonRole)) return result(false, 'SEASON_ROLE_MISSING');
    if (!user.membership.is_member) return result(false, 'MEMBERSHIP_INACTIVE');
    if (!requiredRoles.every(id => roles.includes(id))) return result(false, 'ADDITIONAL_ROLE_MISSING');
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
