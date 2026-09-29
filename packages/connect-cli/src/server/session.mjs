const ssoEncoder = new TextEncoder();
const ssoHandleCookie = '__Host-nakwol_handle';
const ssoProofCookie = '__Host-nakwol_proof';
const ssoPending = new Map();
const ssoCompleted = new Map();
const ssoRevoked = new Map();
const ssoKeys = new Map();
const ssoB64 = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const ssoBytes = value => { if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('encoding'); return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); };
const ssoRandom = () => ssoB64(crypto.getRandomValues(new Uint8Array(32)));
function ssoResponse(body, status = 200, headers = {}) {
  return new Response(body, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Nakwol-Gate': 'v1', 'X-Nakwol-Runtime': '0.10.0', 'X-Nakwol-Session-Mode': 'server-refresh-v1', ...headers } });
}
function ssoRemember(map, id, value) { if (!map.has(id) && map.size >= 512) map.delete(map.keys().next().value); map.set(id, value); }
async function ssoKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('session key');
  if (!ssoKeys.has(secret)) {
    if (ssoKeys.size >= 8) ssoKeys.delete(ssoKeys.keys().next().value);
    ssoKeys.set(secret, crypto.subtle.digest('SHA-256', ssoEncoder.encode(secret)).then(async bytes => ({ kid: ssoB64(new Uint8Array(bytes).slice(0, 12)), key: await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']) })));
  }
  return ssoKeys.get(secret);
}
function ssoAudience(settings, purpose) { return JSON.stringify(['nakwol-server', 3, settings.clientId, new URL(settings.siteUrl).origin, new URL(settings.authOrigin).origin, settings.accessPolicy, purpose]); }
async function ssoSeal(value, env, settings, purpose) {
  const { kid, key } = await ssoKey(env.NAKWOL_SESSION_SECRET);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = ssoEncoder.encode(ssoAudience(settings, purpose) + ':' + kid);
  const bytes = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ssoEncoder.encode(JSON.stringify(value)));
  return `v3.${kid}.${ssoB64(iv)}.${ssoB64(new Uint8Array(bytes))}`;
}
function ssoCookieValue(request, name) {
  const values = (request.headers.get('Cookie') || '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  if (!values.length) return undefined;
  if (values.length !== 1 || values[0].length >= 4096) return null;
  return values[0].slice(name.length + 1);
}
async function ssoOpen(request, name, env, settings, purpose) {
  const raw = ssoCookieValue(request, name);
  if (raw === undefined) return undefined;
  try {
    const parts = raw?.split('.');
    if (parts?.length !== 4 || parts[0] !== 'v3') return null;
    let selected = await ssoKey(env.NAKWOL_SESSION_SECRET);
    if (selected.kid !== parts[1]) {
      const until = Number(env.NAKWOL_SESSION_PREVIOUS_UNTIL);
      if (!Number.isFinite(until) || until <= Date.now() || until > Date.now() + 30 * 86400000) return null;
      selected = await ssoKey(env.NAKWOL_SESSION_PREVIOUS_SECRET);
      if (selected.kid !== parts[1]) return null;
    }
    const iv = ssoBytes(parts[2]); if (iv.length !== 12) return null;
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: ssoEncoder.encode(ssoAudience(settings, purpose) + ':' + parts[1]) }, selected.key, ssoBytes(parts[3]));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch { return null; }
}
function ssoCookie(name, value, until) {
  const cookie = `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((until - Date.now()) / 1000))}`;
  if (cookie.length >= 4096) throw new Error('cookie size');
  return cookie;
}
function ssoSafeReturn(path, origin) {
  if (typeof path !== 'string' || path.length > 2048 || !path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(path)) return '/';
  try { const url = new URL(path, origin); return url.origin === origin && !url.pathname.startsWith('/__nakwol/') ? url.pathname + url.search + url.hash : '/'; } catch { return '/'; }
}
function ssoNavigation(request) { return request.method === 'GET' && request.headers.get('Accept')?.includes('text/html') && !request.headers.has('Range') && !['image', 'script', 'style', 'empty'].includes(request.headers.get('Sec-Fetch-Dest')); }
function ssoPage(request, status, returnTo = '/', auto = false) {
  const target = JSON.stringify(returnTo).replaceAll('<', '\\u003c');
  const text = status === 403 ? '이 사이트의 접근 권한이 없습니다.' : status === 503 ? '인증 서버에 연결할 수 없습니다. 다시 시도해 주세요.' : auto ? '접속 확인 중…' : 'Discord로 로그인하면 접속을 계속할 수 있습니다.';
  const script = auto ? `const saved=${target};const p=location.pathname.startsWith('/__nakwol/')?saved+(location.hash&&!saved.includes('#')?location.hash:''):location.pathname+location.search+location.hash;let blocked=false;try{const key='nakwol:server:attempts';const attempts=JSON.parse(sessionStorage.getItem(key)||'[]').filter(t=>Date.now()-t<60000);blocked=attempts.length>=2;sessionStorage.setItem(key,JSON.stringify([...attempts,Date.now()]));}catch{}if(blocked){document.querySelector('p').textContent='로그인 쿠키를 저장하지 못했습니다. 쿠키를 허용한 뒤 다시 시도해 주세요.';}else{location.replace('/__nakwol/start?return_to='+encodeURIComponent(p));setTimeout(()=>{document.querySelector('p').textContent='연결이 지연되고 있습니다. 페이지를 새로 고쳐 다시 시도해 주세요.';},8000);}` : '';
  return ssoResponse(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NAKWOL</title><p>${text}</p>${auto ? '' : `<a href="/__nakwol/start?interactive=1&return_to=${encodeURIComponent(returnTo)}">Discord로 로그인</a>`}<script>${script}</script></html>`, status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
}
function ssoDeny(request, status) { return ssoNavigation(request) ? ssoPage(request, status, '/', status === 401) : ssoResponse(null, status); }
function ssoValidProof(p, settings, handle) {
  const numbers = ['verifiedAt', 'leaseUntil', 'authorizationEvidenceValidUntil', 'sessionExpiresAt', 'absoluteExpiresAt'];
  return p && p.sessionId === handle.sessionId && p.clientId === settings.clientId && p.siteOrigin === new URL(settings.siteUrl).origin
    && typeof p.userId === 'string' && p.userId.length > 0 && p.userId.length <= 256
    && ['role', 'manual-grant', 'guest', 'admin', 'lab'].includes(p.source)
    && Number.isSafeInteger(p.generation) && p.generation >= 0 && Number.isSafeInteger(p.policyVersion) && p.policyVersion >= 0
    && numbers.every(n => Number.isSafeInteger(p[n]) && p[n] > 0) && p.verifiedAt <= Date.now()
    && p.leaseUntil > p.verifiedAt && p.leaseUntil <= p.verifiedAt + 300000
    && p.leaseUntil <= p.authorizationEvidenceValidUntil && p.leaseUntil <= p.sessionExpiresAt
    && p.sessionExpiresAt <= p.absoluteExpiresAt && p.absoluteExpiresAt <= handle.absoluteExpiresAt;
}
async function ssoRemote(path, data, env, settings) {
  try {
    const result = await fetch(new URL('/server/v1/' + path, settings.authOrigin), { method: 'POST', headers: { Authorization: `Bearer ${env.NAKWOL_SITE_CREDENTIAL}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: settings.clientId, site_origin: new URL(settings.siteUrl).origin, ...data }), redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (result.status !== 200) return { status: [401, 403].includes(result.status) ? result.status : 503 };
    const reader = result.body?.getReader(); if (!reader) return { status: 503 };
    let size = 0; const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) { await reader.cancel(); return { status: 503 }; } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    return body.ok === true ? { status: 200, ...body } : { status: 503 };
  } catch { return { status: 503 }; }
}
function ssoId(handle, env, settings) { return JSON.stringify([ssoAudience(settings, 'refresh'), env.NAKWOL_SITE_CREDENTIAL, handle.sessionId, handle.handle]); }
function ssoIsRevoked(id) { const until = ssoRevoked.get(id); if (until > Date.now()) return true; ssoRevoked.delete(id); return false; }
async function ssoRefresh(handle, proof, env, settings) {
  const id = ssoId(handle, env, settings);
  if (ssoIsRevoked(id)) return { status: 401 };
  const cached = ssoCompleted.get(id);
  if (cached?.session.leaseUntil > Date.now() && cached.session.generation >= (proof?.generation ?? 0)) return cached;
  if (ssoPending.has(id)) return ssoPending.get(id);
  if (ssoPending.size >= 256) return { status: 503 };
  const task = ssoRemote('session/refresh', { session_id: handle.sessionId, handle: handle.handle, expected_generation: proof?.generation ?? 0 }, env, settings).then(result => {
    if (ssoIsRevoked(id)) return { status: 401 };
    if (result.status === 200 && (!ssoValidProof(result.session, settings, handle) || result.session.leaseUntil <= Date.now())) return { status: 503 };
    if (result.status === 200) ssoRemember(ssoCompleted, id, result);
    return result;
  }).finally(() => ssoPending.delete(id));
  ssoPending.set(id, task); return task;
}
export async function serveServerSession(request, env, settings) {
  const url = new URL(request.url), origin = new URL(settings.siteUrl).origin;
  if (url.origin !== origin) return ssoResponse(null, 403);
  try { await ssoKey(env.NAKWOL_SESSION_SECRET); } catch { return ssoDeny(request, 503); }
  if (typeof env.NAKWOL_SITE_CREDENTIAL !== 'string' || !env.NAKWOL_SITE_CREDENTIAL || env.NAKWOL_SITE_CREDENTIAL === env.NAKWOL_SESSION_SECRET) return ssoDeny(request, 503);
  if (url.pathname === '/__nakwol/session') return ssoResponse(null, 410);
  if (url.pathname === '/__nakwol/start') {
    if (request.method !== 'GET' || request.headers.get('Sec-Fetch-Site') === 'cross-site') return ssoResponse(null, 403);
    if ((request.headers.get('Cookie') || '').split(';').filter(v => v.trim().startsWith('__Host-nakwol_state_')).length >= 8) return ssoResponse(null, 429);
    const state = ssoRandom(), verifier = ssoRandom(), expires = Date.now() + 600000;
    const transaction = { state, verifier, expires, returnTo: ssoSafeReturn(url.searchParams.get('return_to'), origin) };
    const central = new URL('/authorize', settings.authOrigin);
    central.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: origin + '/__nakwol/callback', response_type: 'code', scope: 'identify', state, code_challenge: ssoB64(new Uint8Array(await crypto.subtle.digest('SHA-256', ssoEncoder.encode(verifier)))), code_challenge_method: 'S256', prompt: url.searchParams.get('interactive') === '1' ? 'login' : 'none' }).toString();
    return ssoResponse(null, 302, { Location: central.href, 'Set-Cookie': ssoCookie('__Host-nakwol_state_' + state, await ssoSeal(transaction, env, settings, 'state'), expires) });
  }
  if (url.pathname === '/__nakwol/callback') {
    if (request.method !== 'GET' || url.search.length > 4096) return ssoResponse(null, 400);
    const state = url.searchParams.get('state');
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || url.searchParams.getAll('state').length !== 1) return ssoResponse(null, 400);
    const name = '__Host-nakwol_state_' + state, transaction = await ssoOpen(request, name, env, settings, 'state');
    if (!transaction || transaction.state !== state || transaction.expires <= Date.now() || transaction.expires > Date.now() + 600000) return ssoResponse(null, 400);
    const clear = ssoCookie(name, '', 0), returnTo = ssoSafeReturn(transaction.returnTo, origin);
    if (url.searchParams.has('error')) { const denied = ssoPage(request, url.searchParams.get('error') === 'login_required' ? 401 : 403, returnTo); denied.headers.append('Set-Cookie', clear); return denied; }
    const code = url.searchParams.get('code');
    if (!code || code.length > 2048 || url.searchParams.getAll('code').length !== 1) return ssoResponse(null, 400, { 'Set-Cookie': clear });
    const result = await ssoRemote('code-exchange', { code, redirect_uri: origin + '/__nakwol/callback', code_verifier: transaction.verifier }, env, settings);
    const handle = { sessionId: result.session?.sessionId, handle: result.handle, absoluteExpiresAt: result.session?.absoluteExpiresAt };
    if (result.status !== 200 || typeof handle.handle !== 'string' || handle.handle.length < 32 || handle.handle.length > 512 || typeof handle.sessionId !== 'string' || !handle.sessionId || handle.sessionId.length > 256 || !ssoValidProof(result.session, settings, handle) || result.session.leaseUntil <= Date.now()) return ssoResponse(null, result.status === 200 ? 503 : result.status, { 'Set-Cookie': clear });
    const response = ssoResponse(null, 303, { Location: returnTo });
    response.headers.append('Set-Cookie', clear);
    response.headers.append('Set-Cookie', ssoCookie(ssoHandleCookie, await ssoSeal(handle, env, settings, 'handle'), handle.absoluteExpiresAt));
    response.headers.append('Set-Cookie', ssoCookie(ssoProofCookie, await ssoSeal(result.session, env, settings, 'proof'), handle.absoluteExpiresAt));
    return response;
  }
  const handle = await ssoOpen(request, ssoHandleCookie, env, settings, 'handle');
  const validHandle = handle && typeof handle.sessionId === 'string' && handle.sessionId.length > 0 && handle.sessionId.length <= 256 && typeof handle.handle === 'string' && handle.handle.length >= 32 && handle.handle.length <= 512 && Number.isSafeInteger(handle.absoluteExpiresAt) && handle.absoluteExpiresAt > Date.now();
  if (url.pathname === '/__nakwol/logout') {
    if (request.method !== 'POST') return ssoResponse(null, 405);
    if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return ssoResponse(null, 403);
    if (validHandle) {
      const result = await ssoRemote('session/revoke', { session_id: handle.sessionId, handle: handle.handle }, env, settings);
      if (result.status !== 200) return ssoResponse(null, 503, { 'X-Nakwol-Revoke': 'failed' });
      const id = ssoId(handle, env, settings); ssoRemember(ssoRevoked, id, handle.absoluteExpiresAt); ssoCompleted.delete(id);
    }
    const response = ssoResponse(null, 204, { 'X-Nakwol-Revoke': 'confirmed' });
    for (const name of [ssoHandleCookie, ssoProofCookie, '__Host-nakwol_connect']) response.headers.append('Set-Cookie', ssoCookie(name, '', 0));
    return response;
  }
  if (!['GET', 'HEAD'].includes(request.method)) return ssoResponse(null, 405);
  if (url.pathname === '/__nakwol/login') return ssoPage(request, 200, ssoSafeReturn(url.searchParams.get('return_to'), origin), true);
  if (!validHandle) return ssoDeny(request, 401);
  const id = ssoId(handle, env, settings); if (ssoIsRevoked(id)) return ssoDeny(request, 401);
  const proof = await ssoOpen(request, ssoProofCookie, env, settings, 'proof');
  if (proof === null || (proof !== undefined && !ssoValidProof(proof, settings, handle))) return ssoDeny(request, 401);
  let renewed, activeProof = proof;
  if (!proof || proof.leaseUntil <= Date.now()) {
    const result = await ssoRefresh(handle, proof, env, settings);
    if (result.status !== 200) return ssoDeny(request, result.status);
    activeProof = result.session;
    renewed = ssoCookie(ssoProofCookie, await ssoSeal(result.session, env, settings, 'proof'), handle.absoluteExpiresAt);
  }
  if (ssoIsRevoked(id)) return ssoDeny(request, 401);
  if (url.pathname === '/__nakwol/status') {
    const response = ssoResponse(JSON.stringify({ok:true,capabilities:['server-refresh-v1'],user:{id:activeProof.userId,membership:{is_member:['role','manual-grant'].includes(activeProof.source)}}}), 200, {'Content-Type':'application/json'});
    if (renewed) response.headers.append('Set-Cookie', renewed);
    return response;
  }
  const asset = await env.ASSETS.fetch(request);
  if (ssoIsRevoked(id)) return ssoDeny(request, 401);
  const headers = new Headers(asset.headers);
  headers.set('Cache-Control', asset.headers.has('ETag') && [200, 304].includes(asset.status) ? 'private, no-cache, max-age=0, must-revalidate' : 'private, no-store, max-age=0');
  headers.set('Vary', [headers.get('Vary'), 'Cookie'].filter(Boolean).join(', ')); headers.set('X-Nakwol-Gate', 'v1'); headers.set('X-Nakwol-Runtime', '0.10.0'); headers.set('X-Nakwol-Session-Mode', 'server-refresh-v1'); headers.set('X-Content-Type-Options', 'nosniff');
  if (renewed) headers.append('Set-Cookie', renewed);
  return new Response(asset.body, { status: asset.status, headers });
}
