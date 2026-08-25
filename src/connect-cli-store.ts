import { randomToken, sha256Base64Url } from './crypto';
import { resolveDevicePollStatus } from './connect-cli-domain';
import { getUserWithMembership } from './store';
import type { Env } from './types';

export const CONNECT_DEVICE_TTL_MS = 10 * 60 * 1000;
export const CONNECT_DEVICE_POLL_INTERVAL_SECONDS = 3;
export const CONNECT_CLI_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_SCOPES = ['connect:apps'];

export type ConnectPrincipal = {
  userId: string;
  scopes: string[];
  isOperator: boolean;
  developerRole: 'developer' | 'operator' | null;
};

type DeviceRow = {
  device_code_hash: string;
  user_code: string;
  status: string;
  scopes: string;
  approved_user_id: string | null;
  expires_at: number;
  interval_seconds: number;
  created_at: number;
  approved_at: number | null;
};

function parseScopes(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeScopes(scopes: unknown): string[] {
  if (!Array.isArray(scopes)) return DEFAULT_SCOPES;
  const allowed = new Set(['connect:apps']);
  const result = [...new Set(scopes.filter((scope): scope is string => typeof scope === 'string' && allowed.has(scope)))];
  return result.length ? result : DEFAULT_SCOPES;
}

function randomUserCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

export async function getConnectPrincipal(env: Env, userId: string, scopes: string[] = DEFAULT_SCOPES): Promise<ConnectPrincipal | null> {
  const [operator, developer, user] = await Promise.all([
    env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id = ?`).bind(userId).first<{ role: string }>(),
    env.DB.prepare(`SELECT role, status FROM connect_developers WHERE user_id = ?`).bind(userId).first<{ role: string; status: string }>(),
    getUserWithMembership(env, userId),
  ]);
  if (!user || user.status !== 'active') return null;

  const activeDeveloper = developer?.status === 'active';
  const developerRole = activeDeveloper && (developer?.role === 'developer' || developer?.role === 'operator')
    ? developer.role
    : null;
  const isOperator = Boolean(operator) || developerRole === 'operator' || user.membership?.role === 'admin';
  if (!isOperator && developerRole !== 'developer') return null;
  return { userId, scopes, isOperator, developerRole: isOperator ? 'operator' : developerRole };
}

export async function createDeviceGrant(env: Env, scopesInput?: unknown) {
  const scopes = normalizeScopes(scopesInput);
  const deviceCode = randomToken(32);
  const deviceCodeHash = await sha256Base64Url(deviceCode);
  const now = Date.now();
  const expiresAt = now + CONNECT_DEVICE_TTL_MS;

  let userCode = '';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    userCode = randomUserCode();
    const existing = await env.DB.prepare(`SELECT user_code FROM connect_device_requests WHERE user_code = ?`).bind(userCode).first();
    if (!existing) break;
    userCode = '';
  }
  if (!userCode) throw new Error('DEVICE_USER_CODE_COLLISION');

  await env.DB.prepare(
    `INSERT INTO connect_device_requests(
      device_code_hash, user_code, status, scopes, approved_user_id,
      expires_at, interval_seconds, created_at, approved_at
    ) VALUES (?, ?, 'pending', ?, NULL, ?, ?, ?, NULL)`
  ).bind(
    deviceCodeHash,
    userCode,
    JSON.stringify(scopes),
    expiresAt,
    CONNECT_DEVICE_POLL_INTERVAL_SECONDS,
    now,
  ).run();

  const origin = env.AUTH_ORIGIN.replace(/\/$/, '');
  return {
    deviceCode,
    userCode,
    verificationUri: `${origin}/connect/cli/device/verify`,
    verificationUriComplete: `${origin}/connect/cli/device/verify?user_code=${encodeURIComponent(userCode)}`,
    expiresIn: Math.floor(CONNECT_DEVICE_TTL_MS / 1000),
    interval: CONNECT_DEVICE_POLL_INTERVAL_SECONDS,
  };
}

export async function approveDeviceGrant(env: Env, userCode: string, userId: string): Promise<{ ok: boolean; code?: string }> {
  const principal = await getConnectPrincipal(env, userId);
  if (!principal) return { ok: false, code: 'DEVELOPER_PERMISSION_REQUIRED' };
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT status, expires_at FROM connect_device_requests WHERE user_code = ?`
  ).bind(userCode).first<{ status: string; expires_at: number }>();
  if (!row) return { ok: false, code: 'DEVICE_REQUEST_NOT_FOUND' };
  const state = resolveDevicePollStatus(row.status, Number(row.expires_at), now);
  if (state === 'expired') {
    await env.DB.prepare(`UPDATE connect_device_requests SET status = 'expired' WHERE user_code = ? AND status = 'pending'`).bind(userCode).run();
    return { ok: false, code: 'EXPIRED_DEVICE_REQUEST' };
  }
  if (state !== 'pending') return { ok: false, code: `DEVICE_REQUEST_${state.toUpperCase()}` };

  const result = await env.DB.prepare(
    `UPDATE connect_device_requests
       SET status = 'approved', approved_user_id = ?, approved_at = ?
     WHERE user_code = ? AND status = 'pending' AND expires_at > ?`
  ).bind(userId, now, userCode, now).run();
  return Number(result.meta?.changes ?? 0) === 1
    ? { ok: true }
    : { ok: false, code: 'DEVICE_REQUEST_STATE_CHANGED' };
}

export async function denyDeviceGrant(env: Env, userCode: string, userId: string): Promise<{ ok: boolean; code?: string }> {
  const principal = await getConnectPrincipal(env, userId);
  if (!principal) return { ok: false, code: 'DEVELOPER_PERMISSION_REQUIRED' };
  const result = await env.DB.prepare(
    `UPDATE connect_device_requests SET status = 'denied', approved_user_id = ?, approved_at = ?
     WHERE user_code = ? AND status = 'pending' AND expires_at > ?`
  ).bind(userId, Date.now(), userCode, Date.now()).run();
  return Number(result.meta?.changes ?? 0) === 1
    ? { ok: true }
    : { ok: false, code: 'DEVICE_REQUEST_NOT_PENDING' };
}

export async function exchangeDeviceGrant(env: Env, rawDeviceCode: string): Promise<
  | { status: 'approved'; accessToken: string; expiresIn: number }
  | { status: 'pending' | 'denied' | 'consumed' | 'expired' | 'invalid' }
> {
  const deviceCodeHash = await sha256Base64Url(rawDeviceCode);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT device_code_hash, user_code, status, scopes, approved_user_id, expires_at,
            interval_seconds, created_at, approved_at
       FROM connect_device_requests WHERE device_code_hash = ?`
  ).bind(deviceCodeHash).first<DeviceRow>();
  if (!row) return { status: 'invalid' };

  const state = resolveDevicePollStatus(row.status, Number(row.expires_at), now);
  if (state === 'expired') {
    await env.DB.prepare(`UPDATE connect_device_requests SET status = 'expired' WHERE device_code_hash = ? AND status = 'pending'`).bind(deviceCodeHash).run();
    return { status: 'expired' };
  }
  if (state !== 'approved') return { status: state };
  if (!row.approved_user_id) return { status: 'invalid' };

  const accessToken = randomToken(32);
  const tokenHash = await sha256Base64Url(accessToken);
  const expiresAt = now + CONNECT_CLI_TOKEN_TTL_MS;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO connect_cli_tokens(token_hash, user_id, scopes, expires_at, revoked_at, created_at, last_used_at)
       SELECT ?, approved_user_id, scopes, ?, NULL, ?, ?
         FROM connect_device_requests
        WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ? AND approved_user_id IS NOT NULL`
    ).bind(tokenHash, expiresAt, now, now, deviceCodeHash, now),
    env.DB.prepare(
      `UPDATE connect_device_requests SET status = 'consumed'
       WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ?`
    ).bind(deviceCodeHash, now),
  ]);

  if (Number(results[0]?.meta?.changes ?? 0) !== 1) return { status: 'consumed' };
  return {
    status: 'approved',
    accessToken,
    expiresIn: Math.floor(CONNECT_CLI_TOKEN_TTL_MS / 1000),
  };
}

export async function authenticateCliToken(env: Env, rawToken: string): Promise<ConnectPrincipal | null> {
  const tokenHash = await sha256Base64Url(rawToken);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT user_id, scopes FROM connect_cli_tokens
     WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL`
  ).bind(tokenHash, now).first<{ user_id: string; scopes: string }>();
  if (!row) return null;
  await env.DB.prepare(`UPDATE connect_cli_tokens SET last_used_at = ? WHERE token_hash = ?`).bind(now, tokenHash).run();
  return getConnectPrincipal(env, row.user_id, parseScopes(row.scopes));
}

export async function revokeCliToken(env: Env, rawToken: string): Promise<void> {
  const tokenHash = await sha256Base64Url(rawToken);
  await env.DB.prepare(`UPDATE connect_cli_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`).bind(Date.now(), tokenHash).run();
}
