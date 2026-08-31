import type { Env } from './types';

export type AuthLabMembershipRole = 'user' | 'member' | 'admin' | null;
export type AuthLabDeveloperRole = 'developer' | 'operator' | null;

export interface AuthLabPrivilegeInput {
  membershipRole: AuthLabMembershipRole;
  developerRole: AuthLabDeveloperRole;
}

export interface AuthLabPrivilege extends AuthLabPrivilegeInput {
  canUseLab: boolean;
}

export function canUseAuthLab(input: AuthLabPrivilegeInput): boolean {
  return input.membershipRole === 'admin'
    || input.developerRole === 'developer'
    || input.developerRole === 'operator';
}

export async function getAuthLabPrivilege(env: Env, userId: string): Promise<AuthLabPrivilege> {
  const [membership, developer] = await Promise.all([
    env.DB.prepare(
      `SELECT role FROM memberships WHERE user_id = ? AND guild_id = ?`
    ).bind(userId, env.NAKWOL_GUILD_ID).first<{ role: string }>(),
    env.DB.prepare(
      `SELECT role, status FROM connect_developers WHERE user_id = ?`
    ).bind(userId).first<{ role: string; status: string }>(),
  ]);

  const membershipRole: AuthLabMembershipRole =
    membership?.role === 'admin' || membership?.role === 'member' || membership?.role === 'user'
      ? membership.role
      : null;

  const developerRole: AuthLabDeveloperRole = developer?.status === 'active'
    && (developer.role === 'developer' || developer.role === 'operator')
    ? developer.role
    : null;

  return {
    membershipRole,
    developerRole,
    canUseLab: canUseAuthLab({ membershipRole, developerRole }),
  };
}

export interface SafeLabDiagnosticInput {
  centralSession: boolean;
  appAccessToken: boolean;
  meStatus: number;
  nakwolId: string;
  clientId: string;
  redirectUri: string;
  pkceMethod: 'S256';
  tokenExpiresAt: number | null;
  membershipRole: AuthLabMembershipRole;
  developerRole: AuthLabDeveloperRole;
}

export function safeLabDiagnosticShape(input: SafeLabDiagnosticInput) {
  return {
    central_session: Boolean(input.centralSession),
    app_access_token: Boolean(input.appAccessToken),
    me_status: Number(input.meStatus),
    nakwol_id: input.nakwolId,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    pkce_method: input.pkceMethod,
    token_expires_at: input.tokenExpiresAt == null ? null : Number(input.tokenExpiresAt),
    membership_role: input.membershipRole,
    developer_role: input.developerRole,
  };
}
