import { measured, resolveDiagnostic } from './diagnostic-trace';
import { diagnoseApplicationAccess, inspectApplicationAccess } from './policy';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { randomToken } from './crypto';
import { buildDiscordAuthorizeUrl, exchangeDiscordCode, DiscordMembershipUnavailable } from './discord';
import { registerDemoRoutes } from './demo';
import { registerConnectOnboardingRoutes } from './connect-onboarding';
import {
  clearSessionCookie,
  getApplication,
  isAllowedOrigin,
  isAllowedRedirect,
  jsonError,
  parseCookies,
  redirectWithParams,
  sessionCookie,
  withCorsHeaders,
} from './http';
import {
  inspectAccessToken,
  cleanupExpiredAuthData,
  createAuthorizationCode,
  createSession,
  deleteSession,
  exchangeAuthorizationCode,
  findSessionUser,
  logAuthEvent,
  refreshDiscordMembership,
  revokeAccessToken,
  revokeAccessTokensForUser,
} from './store';
import type { Env, OAuthRequestRow } from './types';

const app = new Hono<{ Bindings: Env }>();
const OAUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

for (const route of ['/token','/me'] as const) app.use(route, async (c,next) => {
  const ref=c.req.header('X-Nakwol-Diagnostic-Reference'), cap=c.req.header('X-Nakwol-Diagnostic-Capability');
  const trace=cap ? await resolveDiagnostic(c,ref,c.req.query('client_id') ?? '',c.req.header('Origin'),cap) : undefined;
  if (!trace) { await next(); return; }
  const start=performance.now();
  try { await next(); } finally { trace.add(route === '/token' ? 'token' : 'me',start,c.res.status>=500?'error':c.res.status>=400?'denied':'ok');await trace.finish(); }
});

app.use('/me', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
app.use('/token', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

async function recordLoginEvent(c: Context<{ Bindings: Env }>, eventType: string, userId: string | null, clientId: string, detail: unknown): Promise<void> {
  const task = logAuthEvent(c.env, eventType, userId, clientId, detail).catch((error: unknown) => {
    console.error('AUTH_EVENT_WRITE_FAILED', { eventType, errorType: error instanceof Error ? error.name : 'unknown' });
  });
  try { c.executionCtx.waitUntil(task); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    await task;
  }
}

function secureCookie(env: Env): boolean {
  return env.COOKIE_SECURE !== 'false';
}

function bearerToken(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

async function corsOrigin(c: Context<{ Bindings: Env }>, clientId: string): Promise<string | null> {
  const origin = c.req.header('Origin');
  if (!origin) return null;
  const application = await getApplication(c.env, clientId);
  if (!application || !isAllowedOrigin(application, origin)) return null;
  return origin;
}

app.get('/', (c) => c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NAKWOL AUTH</title><style>
body{font-family:system-ui,sans-serif;background:#111827;color:#f9fafb;display:grid;place-items:center;min-height:100vh;margin:0}
main{width:min(680px,calc(100% - 40px));background:#1f2937;border:1px solid #374151;border-radius:18px;padding:32px}
small{color:#9ca3af}code{background:#111827;padding:2px 6px;border-radius:6px}a{color:#a5b4fc}.links{display:flex;gap:14px;flex-wrap:wrap;margin:18px 0}
</style></head><body><main><h1>落月 · NAKWOL AUTH</h1><p>낙월 통합 인증 서비스 v0.2</p><p><code>GET /api/health</code></p><div class="links"><a href="/account">내 낙월 계정</a><a href="/lab">AUTH Lab</a><a href="/demo">Discord 로그인 자가진단</a><a href="/admin/apps">NAKWOL Connect 관리자</a></div><small>Discord OAuth → Nakwol ID → PKCE Authorization Code</small></main></body></html>`));

app.get('/api/health', (c) => c.json({
  ok: true,
  service: 'nakwol-auth',
  version: '0.2.3',
  now: new Date().toISOString(),
}));

registerDemoRoutes(app);
registerConnectOnboardingRoutes(app);

app.options('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/diagnostics/')) return next();
  if (!['/token', '/me', '/logout'].includes(path)) return c.body(null, 204);
  const clientId = c.req.query('client_id') ?? '';
  if (!clientId) return c.body(null, 204);
  const origin = await corsOrigin(c, clientId);
  if (!origin) return c.body(null, 403);
  const response = withCorsHeaders(new Response(null, { status: 204 }), origin);
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Nakwol-Diagnostic-Reference, X-Nakwol-Diagnostic-Capability');
  return response;
});

app.get('/authorize', async (c) => {
  const clientId = c.req.query('client_id') ?? '';
  const redirectUri = c.req.query('redirect_uri') ?? '';
  const responseType = c.req.query('response_type') ?? 'code';
  const codeChallenge = c.req.query('code_challenge') ?? '';
  const method = c.req.query('code_challenge_method') ?? '';
  const clientState = c.req.query('state') ?? null;
  const prompt = c.req.query('prompt') ?? '';

  if (responseType !== 'code') return jsonError(c, 400, 'UNSUPPORTED_RESPONSE_TYPE', 'response_type=code만 지원합니다.');
  if (!clientId || !redirectUri || !codeChallenge || method !== 'S256') {
    return jsonError(c, 400, 'INVALID_AUTHORIZE_REQUEST', 'client_id, redirect_uri, PKCE(S256)가 필요합니다.');
  }
  if (prompt && prompt !== 'none') {
    return jsonError(c, 400, 'UNSUPPORTED_PROMPT', 'prompt는 none만 지원합니다.');
  }

  const application = await getApplication(c.env, clientId);
  if (!application || !isAllowedRedirect(application, redirectUri)) {
    return jsonError(c, 400, 'INVALID_REDIRECT_URI', '등록되지 않은 애플리케이션 또는 callback URL입니다.');
  }

  const trace = await resolveDiagnostic(c, c.req.query('diagnostic_ref'), clientId, new URL(redirectUri).origin);
  const traceStart = performance.now();
  try {
  const sid = parseCookies(c.req.header('Cookie')).nakwol_sid;
  const sessionUserId = await findSessionUser(c.env, sid);
  if (sessionUserId) {
    const access = await measured(trace, 'policy', () => diagnoseApplicationAccess(c.env, sessionUserId, clientId));
    if (access.allowed) {
      const code = await measured(trace, 'code_creation', () => createAuthorizationCode(c.env, sessionUserId, clientId, redirectUri, codeChallenge));
      await logAuthEvent(c.env, prompt === 'none' ? 'authorize.sso_auto' : 'authorize.sso', sessionUserId, clientId);
      return c.redirect(redirectWithParams(redirectUri, { code, state: clientState }), 302);
    }
    await logAuthEvent(c.env, 'authorize.access_denied', sessionUserId, clientId, { reverify: prompt !== 'none', diagnosis: access });
    if (prompt === 'none') {
      if (access.reason === 'MEMBERSHIP_REFRESH_REQUIRED' || access.reason === 'REAUTHENTICATION_REQUIRED') {
        return c.redirect(redirectWithParams(redirectUri, { error: 'login_required', state: clientState }), 302);
      }
      await deleteSession(c.env, sid);
      const response = c.redirect(redirectWithParams(redirectUri, { error: 'access_denied', state: clientState }), 302);
      response.headers.set('Set-Cookie', clearSessionCookie(secureCookie(c.env)));
      return response;
    }
    // 저장된 역할은 마지막 Discord 로그인 시점 값이다. 역할을 새로 받은 사용자가
    // 세션 때문에 계속 거절되지 않도록, 직접 로그인할 때는 Discord에서 역할을 다시 읽는다.
  }

  if (prompt === 'none') {
    return c.redirect(redirectWithParams(redirectUri, { error: 'login_required', state: clientState }), 302);
  }

  const requestId = `req_${randomToken(18)}`;
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO oauth_requests(id, client_id, redirect_uri, code_challenge, client_state, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(requestId, clientId, redirectUri, codeChallenge, clientState, now + OAUTH_REQUEST_TTL_MS, now).run();

  if (trace) await c.env.DB.prepare('UPDATE oauth_requests SET diagnostic_ref=? WHERE id=?').bind(trace.reference,requestId).run().catch(() => undefined);
  if (Math.random() < 0.03) c.executionCtx.waitUntil(cleanupExpiredAuthData(c.env));
  return c.redirect(buildDiscordAuthorizeUrl(c.env, requestId), 302);
  } finally { if (trace) { trace.add('authorize',traceStart,c.res.status >= 400 ? 'denied' : 'ok'); await trace.finish(); } }
});

app.get('/auth/discord/callback', async (c) => {
  const requestId = c.req.query('state') ?? '';
  const discordCode = c.req.query('code') ?? '';
  const discordError = c.req.query('error');
  if (!requestId) return jsonError(c, 400, 'MISSING_STATE', 'Discord state가 없습니다.');

  const requestRow = await c.env.DB.prepare(
    `SELECT id, client_id, redirect_uri, code_challenge, client_state, expires_at, created_at, diagnostic_ref
       FROM oauth_requests WHERE id = ?`
  ).bind(requestId).first<OAuthRequestRow>();

  if (!requestRow || requestRow.expires_at <= Date.now()) {
    return jsonError(c, 400, 'EXPIRED_LOGIN_REQUEST', '로그인 요청이 만료되었습니다. 다시 로그인해 주세요.');
  }

  const application = await getApplication(c.env, requestRow.client_id);
  if (!application || !isAllowedRedirect(application, requestRow.redirect_uri)) {
    return jsonError(c, 400, 'INVALID_APPLICATION', '애플리케이션 설정을 확인할 수 없습니다.');
  }

  const trace = await resolveDiagnostic(c, requestRow.diagnostic_ref ?? undefined, requestRow.client_id);
  try {
  if (discordError || !discordCode) {
    await c.env.DB.prepare(`DELETE FROM oauth_requests WHERE id = ?`).bind(requestId).run();
    return c.redirect(redirectWithParams(requestRow.redirect_uri, {
      error: discordError ?? 'discord_authorization_failed',
      state: requestRow.client_state,
    }), 302);
  }

  try {
    const discordAccessToken = await measured(trace, 'discord_code_exchange', () => exchangeDiscordCode(c.env, discordCode));
    const { userId, role } = await refreshDiscordMembership(c.env, discordAccessToken, trace);
    const access = await measured(trace, 'policy', () => diagnoseApplicationAccess(c.env, userId, requestRow.client_id));

    await c.env.DB.prepare(`DELETE FROM oauth_requests WHERE id = ?`).bind(requestId).run();

    if (!access.allowed) {
      await recordLoginEvent(c, 'discord.login.access_denied', userId, requestRow.client_id, { role, diagnosis: access });
      const response = c.redirect(redirectWithParams(requestRow.redirect_uri, {
        error: 'access_denied',
        state: requestRow.client_state,
      }), 302);
      await deleteSession(c.env, parseCookies(c.req.header('Cookie')).nakwol_sid);
      response.headers.set('Set-Cookie', clearSessionCookie(secureCookie(c.env)));
      return response;
    }

    const code = await measured(trace, 'code_creation', () => createAuthorizationCode(c.env, userId, requestRow.client_id, requestRow.redirect_uri, requestRow.code_challenge));
    await recordLoginEvent(c, 'discord.login.success', userId, requestRow.client_id, { role });

    const session = await measured(trace, 'session_creation', () => createSession(c.env, userId));
    const response = c.redirect(redirectWithParams(requestRow.redirect_uri, { code, state: requestRow.client_state }), 302);
    response.headers.set('Set-Cookie', sessionCookie(session.token, secureCookie(c.env), session.maxAgeSeconds));
    return response;
  } catch (error) {
    await recordLoginEvent(c, 'discord.login.error', null, requestRow.client_id, {
      message: error instanceof Error ? error.message : String(error),
    });
    return c.redirect(redirectWithParams(requestRow.redirect_uri, {
      error: 'nakwol_auth_failed',
      state: requestRow.client_state,
    }), 302);
  }
  } finally { if (trace) await trace.finish(); }
});

app.post('/token', async (c) => {
  const clientIdFromQuery = c.req.query('client_id') ?? '';
  const application = await getApplication(c.env, clientIdFromQuery);
  const requestedOrigin = c.req.header('Origin');
  const origin = requestedOrigin && application && isAllowedOrigin(application, requestedOrigin) ? requestedOrigin : null;
  if (c.req.header('Origin') && !origin) return jsonError(c, 403, 'CORS_DENIED', '허용되지 않은 Origin입니다.');

  const contentType = c.req.header('Content-Type') ?? '';
  let body: Record<string, string> = {};
  if (contentType.includes('application/json')) body = await c.req.json<Record<string, string>>();
  else {
    const parsed = await c.req.parseBody();
    body = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  }

  const { grant_type: grantType, code, client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier } = body;
  if (grantType !== 'authorization_code' || !code || !clientId || !redirectUri || !codeVerifier) {
    const response = c.json({ ok: false, error: { code: 'INVALID_TOKEN_REQUEST', message: '필수 값이 없습니다.' } }, 400);
    return origin ? withCorsHeaders(response, origin) : response;
  }
  if (clientId !== clientIdFromQuery) {
    const response = c.json({ ok: false, error: { code: 'CLIENT_ID_MISMATCH', message: 'client_id가 일치하지 않습니다.' } }, 400);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  if (!application || !isAllowedRedirect(application, redirectUri)) {
    const response = c.json({ ok: false, error: { code: 'INVALID_CLIENT', message: '등록되지 않은 앱 또는 redirect URI입니다.' } }, 400);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  try {
    const token = await exchangeAuthorizationCode(c.env, { code, clientId, redirectUri, codeVerifier });
    const response = c.json({ access_token: token.accessToken, token_type: 'Bearer', expires_in: token.expiresIn });
    return origin ? withCorsHeaders(response, origin) : response;
  } catch (error) {
    const response = c.json({
      ok: false,
      error: {
        code: error instanceof Error ? error.message : 'TOKEN_EXCHANGE_FAILED',
        message: '인증 코드를 access token으로 교환하지 못했습니다.',
      },
    }, 400);
    return origin ? withCorsHeaders(response, origin) : response;
  }
});

async function currentUserResponse(c: Context<{ Bindings: Env }>): Promise<Response> {
  const clientId = c.req.query('client_id') ?? '';
  const token = bearerToken(c);
  const [application, tokenInfo] = await Promise.all([
    getApplication(c.env, clientId),
    token && clientId ? inspectAccessToken(c.env, token, clientId) : Promise.resolve(null),
  ]);
  const requestedOrigin = c.req.header('Origin');
  const origin = requestedOrigin && application && isAllowedOrigin(application, requestedOrigin) ? requestedOrigin : null;
  if (c.req.header('Origin') && !origin) return jsonError(c, 403, 'CORS_DENIED', '허용되지 않은 Origin입니다.');

  if (!token || !clientId) {
    const response = c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, 401);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  if (!tokenInfo || application?.status !== 'active') {
    const response = c.json({ ok: false, error: { code: 'INVALID_TOKEN', message: '유효하지 않거나 만료된 token입니다.' } }, 401);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  const userId = tokenInfo.userId;
  const { user, access } = await inspectApplicationAccess(c.env, userId, clientId, c.req.header('X-Nakwol-Require-Member') === 'true');
  if (!access.allowed) {
    if (access.reason === 'MEMBERSHIP_REFRESH_REQUIRED' || access.reason === 'REAUTHENTICATION_REQUIRED') {
      const response = c.json({ ok: false, error: { code: access.reason, message: 'Discord 인증으로 역할을 다시 확인해 주세요.' } }, 401);
      return origin ? withCorsHeaders(response, origin) : response;
    }
    const response = c.json({ ok: false, error: { code: 'ACCESS_DENIED', message: '이 앱을 사용할 권한이 없습니다.' } }, 403);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  if (!user) {
    const response = c.json({ ok: false, error: { code: 'USER_NOT_FOUND', message: '사용자를 찾을 수 없습니다.' } }, 404);
    return origin ? withCorsHeaders(response, origin) : response;
  }

  const response = c.json({ ok: true, data: user, expires_at: tokenInfo.expiresAt,
    application_access: { client_id: clientId, allowed: true, source: access.reason === 'MANUAL_GRANT' ? 'manual_grant' : 'policy' } });
  return origin ? withCorsHeaders(response, origin) : response;
}

app.get('/me', async (c) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      currentUserResponse(c),
      new Promise<Response>(resolve => {
        timer = setTimeout(() => resolve(jsonError(c, 503, 'AUTH_CHECK_TIMEOUT', '인증 서버 응답이 지연되고 있습니다. 다시 시도해 주세요.')), 5500);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
});

app.post('/logout', async (c) => {
  const clientId = c.req.query('client_id') ?? '';
  const origin = await corsOrigin(c, clientId);
  if (c.req.header('Origin') && !origin) return jsonError(c, 403, 'CORS_DENIED', '허용되지 않은 Origin입니다.');
  const token = bearerToken(c);
  if (token) await revokeAccessToken(c.env, token);
  const response = c.json({ ok: true });
  return origin ? withCorsHeaders(response, origin) : response;
});

app.get('/session/logout', async (c) => {
  const clientId = c.req.query('client_id') ?? '';
  const returnTo = c.req.query('return_to') ?? '';
  const application = await getApplication(c.env, clientId);
  if (!application || !returnTo) return jsonError(c, 400, 'INVALID_LOGOUT_REQUEST', 'client_id와 return_to가 필요합니다.');

  let allowedReturn = false;
  try { allowedReturn = isAllowedOrigin(application, new URL(returnTo).origin); } catch { allowedReturn = false; }
  if (!allowedReturn) return jsonError(c, 400, 'INVALID_RETURN_TO', '허용되지 않은 return_to입니다.');

  const sid = parseCookies(c.req.header('Cookie')).nakwol_sid;
  const sessionUserId = await findSessionUser(c.env, sid);
  if (sessionUserId) await revokeAccessTokensForUser(c.env, sessionUserId);
  await deleteSession(c.env, sid);
  const response = c.redirect(returnTo, 302);
  response.headers.set('Set-Cookie', clearSessionCookie(secureCookie(c.env)));
  return response;
});

app.notFound((c) => jsonError(c, 404, 'NOT_FOUND', '요청한 경로가 없습니다.'));
app.onError((error, c) => {
  if (error instanceof DiscordMembershipUnavailable) {
    return jsonError(c, 503, 'MEMBERSHIP_UNAVAILABLE', '현재 Discord 역할을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
  console.error(error);
  return jsonError(c, 500, 'INTERNAL_ERROR', '인증 서버 내부 오류가 발생했습니다.');
});

export default app;
