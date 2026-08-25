import type { Hono } from 'hono';
import { sha256Base64Url } from './crypto';
import { getUserWithMembership, logAuthEvent } from './store';
import { canManageApplication, canUseCli, type ConnectRole } from './connect-permissions';
import { chooseAvailableClientId, validateRedirectUris } from './connect-cli-core';
import type { Env } from './types';

const FRAMEWORKS = new Set(['html', 'vite', 'react', 'vue', 'cra', 'sveltekit', 'next_app', 'next_pages', 'other']);
const ACCESS_POLICIES = new Set(['public', 'member', 'admin']);
const STATUSES = new Set(['active', 'disabled']);

type CliIdentity = {
  userId: string;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithMembership>>>;
  connectRole: ConnectRole;
  tokenExpiresAt: number;
};

type AppRow = {
  client_id: string;
  name: string;
  redirect_uris: string;
  status: string;
  homepage_url: string | null;
  framework: string | null;
  access_policy: string | null;
  owner_user_id: string | null;
  created_at: number | null;
  updated_at: number | null;
};

function error(c: any, status: number, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status);
}

function bearer(header: string | undefined): string | null {
  return (header || '').match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function appJson(row: AppRow) {
  return {
    client_id: row.client_id,
    name: row.name,
    redirect_uris: parseRedirectUris(row.redirect_uris),
    status: row.status,
    homepage_url: row.homepage_url,
    framework: row.framework || 'other',
    access_policy: row.access_policy || 'public',
    owner_user_id: row.owner_user_id,
    created_at: row.created_at == null ? null : Number(row.created_at),
    updated_at: row.updated_at == null ? null : Number(row.updated_at),
  };
}

async function roleFor(env: Env, userId: string): Promise<ConnectRole> {
  const row = await env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id=?`).bind(userId).first<{ role: string }>();
  if (row?.role === 'owner' || row?.role === 'operator' || row?.role === 'developer') return row.role;
  return null;
}

async function cliIdentity(env: Env, authorization: string | undefined): Promise<CliIdentity | null> {
  const raw = bearer(authorization);
  if (!raw) return null;
  const hash = await sha256Base64Url(raw);
  const now = Date.now();
  const token = await env.DB.prepare(
    `SELECT user_id,expires_at FROM connect_cli_tokens
      WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`
  ).bind(hash, now).first<{ user_id: string; expires_at: number }>();
  if (!token) return null;
  const user = await getUserWithMembership(env, token.user_id);
  if (!user) return null;
  const connectRole = await roleFor(env, token.user_id);
  if (!canUseCli(connectRole, user.membership?.role)) return null;
  await env.DB.prepare(`UPDATE connect_cli_tokens SET last_used_at=? WHERE token_hash=?`).bind(now, hash).run();
  return { userId: token.user_id, user, connectRole, tokenExpiresAt: Number(token.expires_at) };
}

async function readApp(env: Env, clientId: string): Promise<AppRow | null> {
  return env.DB.prepare(
    `SELECT a.client_id,a.name,a.redirect_uris,a.status,
            s.homepage_url,s.framework,s.access_policy,s.owner_user_id,s.created_at,s.updated_at
       FROM applications a
       LEFT JOIN application_settings s ON s.client_id=a.client_id
      WHERE a.client_id=?`
  ).bind(clientId).first<AppRow>();
}

function validHomepage(input: unknown): string | null | undefined {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') return undefined;
  try {
    const url = new URL(input.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.hash || url.username || url.password) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

async function ownedAppOrError(c: any, identity: CliIdentity, clientId: string): Promise<AppRow | Response> {
  const row = await readApp(c.env, clientId);
  if (!row) return error(c, 404, 'APP_NOT_FOUND', '등록된 NAKWOL Connect 앱을 찾을 수 없습니다.');
  if (!canManageApplication(identity.connectRole, identity.user.membership?.role, identity.userId, row.owner_user_id)) {
    return error(c, 403, 'APP_NOT_OWNED', '이 앱을 관리할 권한이 없습니다.');
  }
  return row;
}

export function registerConnectCliApiRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/api/cli/me', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    return c.json({ ok: true, data: {
      id: identity.userId,
      display_name: identity.user.display_name,
      connect_role: identity.connectRole || (identity.user.membership?.role === 'admin' ? 'admin' : null),
      membership_role: identity.user.membership?.role || 'user',
      expires_at: identity.tokenExpiresAt,
    } });
  });

  app.post('/connect/api/cli/apps', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    const body = await c.req.json().catch(() => ({} as any));
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : 'NAKWOL App';
    const redirects = validateRedirectUris(body.redirect_uris);
    if (!redirects.ok) return error(c, 400, 'INVALID_REDIRECT_URI', redirects.error);
    const framework = FRAMEWORKS.has(body.framework) ? body.framework : 'other';
    const accessPolicy = ACCESS_POLICIES.has(body.access_policy) ? body.access_policy : 'member';
    const homepage = validHomepage(body.homepage_url);
    if (homepage === undefined) return error(c, 400, 'INVALID_HOMEPAGE_URL', 'homepage_url이 올바른 http/https URL이 아닙니다.');
    const clientId = await chooseAvailableClientId(
      typeof body.requested_client_id === 'string' ? body.requested_client_id : name,
      async (candidate) => Boolean(await readApp(c.env, candidate)),
    );
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO applications(client_id,name,redirect_uris,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)`
      ).bind(clientId, name, JSON.stringify(redirects.value), now, now),
      c.env.DB.prepare(
        `INSERT INTO application_settings(client_id,homepage_url,framework,access_policy,owner_user_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)`
      ).bind(clientId, homepage, framework, accessPolicy, identity.userId, now, now),
    ]);
    await logAuthEvent(c.env, 'connect.cli.app.created', identity.userId, clientId, { framework, access_policy: accessPolicy });
    return c.json({ ok: true, data: appJson((await readApp(c.env, clientId))!) }, 201);
  });

  app.get('/connect/api/cli/apps/:clientId', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    const row = await ownedAppOrError(c, identity, c.req.param('clientId'));
    if (row instanceof Response) return row;
    return c.json({ ok: true, data: appJson(row) });
  });

  app.patch('/connect/api/cli/apps/:clientId', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    const clientId = c.req.param('clientId');
    const row = await ownedAppOrError(c, identity, clientId);
    if (row instanceof Response) return row;
    const body = await c.req.json().catch(() => ({} as any));
    const redirects = body.redirect_uris === undefined ? { ok: true as const, value: parseRedirectUris(row.redirect_uris) } : validateRedirectUris(body.redirect_uris);
    if (!redirects.ok) return error(c, 400, 'INVALID_REDIRECT_URI', redirects.error);
    const homepage = body.homepage_url === undefined ? row.homepage_url : validHomepage(body.homepage_url);
    if (homepage === undefined) return error(c, 400, 'INVALID_HOMEPAGE_URL', 'homepage_url이 올바른 http/https URL이 아닙니다.');
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 100) : row.name;
    const framework = body.framework === undefined ? (row.framework || 'other') : (FRAMEWORKS.has(body.framework) ? body.framework : null);
    if (!framework) return error(c, 400, 'INVALID_FRAMEWORK', '지원하지 않는 framework입니다.');
    const accessPolicy = body.access_policy === undefined ? (row.access_policy || 'public') : (ACCESS_POLICIES.has(body.access_policy) ? body.access_policy : null);
    if (!accessPolicy) return error(c, 400, 'INVALID_ACCESS_POLICY', '지원하지 않는 access_policy입니다.');
    const status = body.status === undefined ? row.status : (STATUSES.has(body.status) ? body.status : null);
    if (!status) return error(c, 400, 'INVALID_STATUS', 'status는 active 또는 disabled여야 합니다.');
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE applications SET name=?,redirect_uris=?,status=?,updated_at=? WHERE client_id=?`)
        .bind(name, JSON.stringify(redirects.value), status, now, clientId),
      c.env.DB.prepare(`UPDATE application_settings SET homepage_url=?,framework=?,access_policy=?,updated_at=? WHERE client_id=?`)
        .bind(homepage, framework, accessPolicy, now, clientId),
    ]);
    await logAuthEvent(c.env, 'connect.cli.app.updated', identity.userId, clientId, { framework, access_policy: accessPolicy, status });
    return c.json({ ok: true, data: appJson((await readApp(c.env, clientId))!) });
  });

  app.post('/connect/api/cli/apps/:clientId/urls', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    const clientId = c.req.param('clientId');
    const row = await ownedAppOrError(c, identity, clientId);
    if (row instanceof Response) return row;
    const body = await c.req.json().catch(() => ({} as any));
    const redirects = validateRedirectUris([...parseRedirectUris(row.redirect_uris), body.url]);
    if (!redirects.ok) return error(c, 400, 'INVALID_REDIRECT_URI', redirects.error);
    await c.env.DB.prepare(`UPDATE applications SET redirect_uris=?,updated_at=? WHERE client_id=?`)
      .bind(JSON.stringify(redirects.value), Date.now(), clientId).run();
    await logAuthEvent(c.env, 'connect.cli.url.added', identity.userId, clientId, { url: body.url });
    return c.json({ ok: true, data: appJson((await readApp(c.env, clientId))!) });
  });

  app.post('/connect/api/cli/apps/:clientId/disable', async (c) => {
    const identity = await cliIdentity(c.env, c.req.header('Authorization'));
    if (!identity) return error(c, 401, 'AUTH_REQUIRED', 'Connect CLI 로그인이 필요합니다.');
    const clientId = c.req.param('clientId');
    const row = await ownedAppOrError(c, identity, clientId);
    if (row instanceof Response) return row;
    await c.env.DB.prepare(`UPDATE applications SET status='disabled',updated_at=? WHERE client_id=?`).bind(Date.now(), clientId).run();
    await logAuthEvent(c.env, 'connect.cli.app.disabled', identity.userId, clientId);
    return c.json({ ok: true, data: appJson((await readApp(c.env, clientId))!) });
  });
}
