import type { Env } from './types';
import { getUserWithMembership } from './store';
import { getAuthLabPrivilege } from './platform-access';
import { getRequiredRoleIds } from './role-settings';
import { resolveAuthPolicy } from './auth-policy-settings';

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

export async function diagnoseApplicationAccess(env: Env, userId: string, clientId: string, requireMember = false) {
  return evaluateAccess(env, userId, clientId, { requireMember });
}

export async function evaluateAccess(env: Env, userId: string, clientId: string, options: { requireMember?: boolean; expiresAt?: number; now?: number } = {}) {
  const now = options.now ?? Date.now();
  const requireMember = options.requireMember ?? false;
  const resolved = await resolveAuthPolicy(env, clientId);
  const boundary = Math.min(options.expiresAt ?? Infinity, now + resolved.effective.accessTokenSeconds * 1000);

  const policy = await getApplicationAccessPolicy(env, clientId);
  const user = await getUserWithMembership(env, userId);
  const requiredRoles = await getRequiredRoleIds(env, clientId);
  const membership = await env.DB.prepare(`SELECT role_ids FROM memberships WHERE user_id = ? AND guild_id = ?`)
    .bind(userId, env.NAKWOL_GUILD_ID).first<{ role_ids: string }>();
  let parsed: unknown = null;
  try { parsed = JSON.parse(membership?.role_ids ?? 'null'); } catch { parsed = null; }
  const roles: string[] = Array.isArray(parsed) && parsed.every((id: unknown) => typeof id === 'string') ? parsed : [];
  const seasonRole = env.NAKWOL_MEMBER_ROLE_ID?.trim() || '';
  const reauth = await env.DB.prepare(`SELECT requested_at FROM user_reauthentication WHERE user_id = ?`)
    .bind(userId).first<{ requested_at: number }>();
  const grant = await env.DB.prepare(`SELECT g.status, g.expires_at FROM application_access_grants g
    JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = g.discord_user_id
    WHERE i.user_id = ? AND g.client_id = ?`).bind(userId, clientId).first<{ status: string; expires_at: number | null }>();
  const grantActive = grant?.status === 'active' && Number.isSafeInteger(grant.expires_at) && Number(grant.expires_at) > now;
  const result = (allowed: boolean, reason: string, source: 'role' | 'manual-grant' | 'guest' | 'admin' | 'lab' | 'none' = 'none', validUntil = boundary) => ({ allowed, reason, policy,
    source, validUntil: allowed ? Math.min(boundary, validUntil) : now, policyVersion: resolved.policyVersion, effectivePolicy: resolved.effective,
    season_role_id: seasonRole, role_ids: roles, missing_role_ids: [seasonRole, ...requiredRoles].filter(id => id && !roles.includes(id)),
    checked_at: user?.membership.checked_at ?? null, manual_grant: grantActive,
    reauthentication_requested_at: reauth?.requested_at ?? null,
    reauthentication_status: reauth ? (Number(user?.membership.checked_at ?? 0) > reauth.requested_at ? 'completed' : 'pending') : null });
  const application = await env.DB.prepare(`SELECT status FROM applications WHERE client_id = ?`).bind(clientId).first<{ status: string }>();
  if (application?.status !== 'active') return result(false, 'APP_DISABLED');
  if (!user || user.status !== 'active') return result(false, 'USER_DISABLED');
  if (reauth && Number(user.membership.checked_at ?? 0) <= reauth.requested_at) return result(false, 'REAUTHENTICATION_REQUIRED');
  const deny = await env.DB.prepare(`SELECT d.scope FROM application_access_denies d
    JOIN auth_identities i ON i.provider = 'discord' AND i.provider_user_id = d.discord_user_id
    WHERE i.user_id = ? AND d.scope IN ('global', ?) AND d.status = 'active'
      AND (d.expires_at IS NULL OR d.expires_at > ?) LIMIT 1`)
    .bind(userId, 'app:' + clientId, now).first<{ scope: string }>();
  if (deny) return result(false, deny.scope === 'global' ? 'GLOBAL_ACCESS_DENIED' : 'APPLICATION_ACCESS_DENIED');
  let roleValidUntil = boundary;
  if (policy === 'member' || requireMember || requiredRoles.length > 0) {
    const checkedAt = Number(user.membership.checked_at);
    let failure = '';
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || checkedAt > now || now - checkedAt >= MEMBERSHIP_MAX_AGE_MS) failure = 'MEMBERSHIP_REFRESH_REQUIRED';
    else if (!seasonRole) failure = 'SEASON_ROLE_NOT_CONFIGURED';
    else if (!roles.includes(seasonRole)) failure = 'SEASON_ROLE_MISSING';
    else if (!user.membership.is_member) failure = 'MEMBERSHIP_INACTIVE';
    else if (!requiredRoles.every(id => roles.includes(id))) failure = 'ADDITIONAL_ROLE_MISSING';
    if (failure) {
      if ((policy === 'member' || policy === 'guest') && grantActive) return result(true, 'MANUAL_GRANT', 'manual-grant', Number(grant?.expires_at));
      return result(false, failure);
    }
    roleValidUntil = checkedAt + MEMBERSHIP_MAX_AGE_MS;
  }
  switch (policy) {
    case 'guest': return result(true, 'POLICY_ALLOWED', requireMember || requiredRoles.length > 0 ? 'role' : 'guest', roleValidUntil);
    case 'member': return result(true, 'POLICY_ALLOWED', 'role', roleValidUntil);
    case 'admin': {
      const allowed = await isPlatformAdmin(env, userId);
      return result(allowed, allowed ? 'POLICY_ALLOWED' : 'AUTH_OPERATOR_REQUIRED', allowed ? 'admin' : 'none', roleValidUntil);
    }
    case 'lab': {
      const privilege = await getAuthLabPrivilege(env, userId);
      return result(privilege.canUseLab, privilege.canUseLab ? 'POLICY_ALLOWED' : 'LAB_PRIVILEGE_REQUIRED', privilege.canUseLab ? 'lab' : 'none', roleValidUntil);
    }
  }
}
