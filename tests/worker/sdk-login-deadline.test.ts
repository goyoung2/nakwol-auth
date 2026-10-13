import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

async function fixture(fetchImpl: typeof fetch) {
  const root = new URL('../../src/assets/', import.meta.url);
  const base = await readFile(new URL('nakwol-auth-web-v0.2.0.js.txt', root), 'utf8');
  const sso = await readFile(new URL('nakwol-auth-web-v0.3.1.js.txt', root), 'utf8');
  const deadline = await readFile(new URL('nakwol-auth-web-v0.3.3.js.txt', root), 'utf8');
  const values = new Map<string, string>();
  let fireTimeout = () => {};
  const context = createContext({
    window: { fetch: fetchImpl }, document: {}, location: { origin: 'https://site.test', pathname: '/', search: '', href: 'https://site.test/' },
    URL, URLSearchParams, Headers, Response, DOMException, AbortController, EventTarget, CustomEvent, TextEncoder, crypto, btoa,
    setTimeout: (callback: () => void) => { fireTimeout = callback; return 1; }, clearTimeout: () => {},
    opts: { clientId: 'site', redirectUri: 'https://site.test/', fetchImpl, storage: {
      getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k),
    } },
  });
  runInContext('globalThis.base = (() => {' + base.replace(/\bexport /g, '') + ';return {NakwolAuthClient,NakwolAuthError};})()', context);
  const strippedSso = sso.replace(/import \{[\s\S]*?\} from '[^']+';/, 'const NakwolAuthClientV02=base.NakwolAuthClient;const NakwolAuthError=base.NakwolAuthError;')
    .replace(/export \{[\s\S]*?\};/, '').replace(/\bexport /g, '');
  runInContext('globalThis.previous=(()=>{' + strippedSso + ';return NakwolAuthClient;})()', context);
  const strippedDeadline = deadline.replace(/^import .*;$/m, 'const NakwolAuthClientV032=previous;const NakwolAuthError=base.NakwolAuthError;')
    .replace(/^export \{.*;$/m, '').replace(/\bexport /g, '');
  runInContext(strippedDeadline + ';globalThis.client=new NakwolAuthClient(opts);', context);
  values.set('nakwol.auth.site.token', JSON.stringify({ accessToken: 'token', expiresAt: Date.now() + 60000 }));
  return { context, values, fire: () => fireTimeout() };
}

test('SDK deadline ends stalled headers without deleting a valid credential or adding retry traffic', async () => {
  let calls = 0;
  const f = await fixture(async () => { calls++; return new Promise<Response>(() => {}); });
  const pending = runInContext('client.getMe()', f.context);
  f.fire();
  await assert.rejects(pending, { code: 'AUTH_REQUEST_TIMEOUT' });
  assert.equal(calls, 1);
  assert.equal(f.values.has('nakwol.auth.site.token'), true);
  assert.equal(f.values.has('nakwol.auth.site.sso_suppressed'), false);
});
test('SDK deadline covers response bodies and rejects oversized auth payloads', async () => {
  const f = await fixture(async () => new Response(new ReadableStream({ start() {} })));
  const pending = runInContext('client.getMe()', f.context);
  await new Promise<void>(resolve => queueMicrotask(resolve));
  f.fire();
  await assert.rejects(pending, { code: 'AUTH_REQUEST_TIMEOUT' });
  const large = await fixture(async () => new Response(new Uint8Array(65537)));
  await assert.rejects(runInContext('client.getMe()', large.context), { code: 'AUTH_RESPONSE_TOO_LARGE' });
});
test('SDK preserves caller cancellation, passes success and keeps real denial behavior', async () => {
  const f = await fixture(async () => Response.json({ ok: true, data: { id: 'user' } }));
  const user: {id: string} = await runInContext('client.getMe()', f.context);
  assert.equal(user.id, 'user');
  const controller = new AbortController(); controller.abort(); f.context.signal = controller.signal;
  await assert.rejects(runInContext("client.fetchImpl('https://auth.test/me',{signal})", f.context), { name: 'AbortError' });
  const denied = await fixture(async () => Response.json({ ok: false, error: { code: 'ACCESS_DENIED' } }, { status: 403 }));
  await assert.rejects(runInContext('client.getMe()', denied.context), { code: 'ACCESS_DENIED' });
  assert.equal(denied.values.has('nakwol.auth.site.token'), false);
  assert.equal(denied.values.get('nakwol.auth.site.sso_suppressed'), '1');
});
