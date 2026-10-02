import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

type EventRecord = { readonly type: string; readonly detail: unknown };
type Runtime = {
  readonly api: Record<string, unknown>;
  readonly events: readonly EventRecord[];
  readonly requests: readonly { readonly path: string; readonly method: string }[];
  readonly navigations: readonly string[];
  readonly centralBootstraps: number;
  readonly centralLogouts: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function method(api: Record<string, unknown>, name: string): (...args: never[]) => unknown {
  const value = api[name];
  assert.equal(typeof value, 'function', `${name} must be available`);
  return value;
}

function userId(api: Record<string, unknown>): string | null {
  const user = api.user;
  return isRecord(user) && typeof user.id === 'string' ? user.id : null;
}

async function boot(status: Response, serverGate = true): Promise<Runtime> {
  const raw = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');
  const source = raw.replace('const sdk = await import(`${authOrigin}/sdk/v0.3.2/nakwol-auth-web.js`);', 'const sdk = __sdk;');
  assert.notEqual(source, raw);
  const events: EventRecord[] = [];
  const requests: { path: string; method: string }[] = [];
  const navigations: string[] = [];
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); },
    removeItem: (key: string) => { items.delete(key); },
  };
  let centralBootstraps = 0;
  let centralLogouts = 0;
  class BrowserEvent extends Event {
    readonly detail: unknown;
    constructor(type: string, init: { readonly detail: unknown }) { super(type); this.detail = init.detail; }
  }
  class AuthError extends Error {
    readonly code: string;
    constructor(code: string, message: string) { super(message); this.code = code; }
  }
  class AuthClient extends EventTarget {
    user: { readonly id: string; readonly membership: { readonly is_member: boolean } } | null = null;
    readonly storage = storage;
    key(name: string) { return `nakwol.auth.client.${name}`; }
    emit(type: string, detail: unknown) { this.dispatchEvent(new BrowserEvent(type, { detail })); }
    clearLocalState() { this.user = null; storage.removeItem(this.key('token')); }
    async bootstrap() { centralBootstraps += 1; this.user = { id: 'central', membership: { is_member: true } }; this.emit('user', this.user); return this.user; }
    async getMe() { return this.user; }
    async login() { navigations.push('central-login'); }
    async logout() { centralLogouts += 1; this.clearLocalState(); this.emit('logout', null); }
    isAuthenticated() { return this.user !== null; }
    isMember() { return Boolean(this.user?.membership.is_member); }
    getAccessToken() { return 'central-token'; }
  }
  const sdk = { NakwolAuthClient: AuthClient, NakwolAuthError: AuthError };
  const windowObject: Record<string, unknown> = {
    sessionStorage: storage,
    dispatchEvent(event: BrowserEvent) { events.push({ type: event.type, detail: event.detail }); return true; },
  };
  const documentObject = {
    currentScript: { dataset: { clientId: 'client', ui: 'headless', auth: 'optional', serverGate: String(serverGate) }, src: 'https://auth.example/connect/v1.js' },
    readyState: 'complete',
  };
  const locationObject = {
    href: 'https://site.example/private?a=1#section', origin: 'https://site.example', pathname: '/private', search: '?a=1', hash: '#section',
    assign(url: string) { navigations.push(url); },
  };
  const fetchFake = async (path: string, options: RequestInit = {}) => {
    requests.push({ path, method: options.method ?? 'GET' });
    if (path === '/__nakwol/status') return status.clone();
    if (path === '/__nakwol/logout') return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${path}`);
  };
  const execute = new Function('__sdk', 'window', 'document', 'location', 'CustomEvent', 'fetch', 'Headers', 'AbortSignal', source);
  execute(sdk, windowObject, documentObject, locationObject, BrowserEvent, fetchFake, Headers, AbortSignal);
  for (let i = 0; i < 20 && !windowObject.NAKWOL_CONNECT && !events.some((event) => event.type === 'nakwol-error'); i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await new Promise<void>((resolve) => setImmediate(resolve));
  const apiValue = windowObject.NAKWOL_CONNECT;
  return {
    api: isRecord(apiValue) ? apiValue : {}, events, requests, navigations,
    get centralBootstraps() { return centralBootstraps; },
    get centralLogouts() { return centralLogouts; },
  };
}

const modeHeaders = { 'X-Nakwol-Session-Mode': 'server-refresh-v1' };

test('server session uses one local probe and skips central browser bootstrap', async () => {
  const runtime = await boot(Response.json({ ok: true, capabilities: ['server-refresh-v1'], user: { id: 'local', membership: { is_member: true } } }, { headers: modeHeaders }));
  assert.equal(runtime.centralBootstraps, 0);
  assert.deepEqual(runtime.requests, [{ path: '/__nakwol/status', method: 'GET' }]);
  assert.equal(userId(runtime.api), 'local');
  assert.equal(method(runtime.api, 'getAccessToken')(), null);
  assert.equal(runtime.events.some((event) => event.type === 'nakwol-ready'), true);
});

test('missing mode header keeps legacy browser SDK behavior', async () => {
  const runtime = await boot(Response.json({ ok: true, user: { id: 'local' } }));
  assert.equal(runtime.centralBootstraps, 1);
  assert.equal(userId(runtime.api), 'central');
});

test('server failure fails closed without central SSO fallback', async () => {
  const runtime = await boot(Response.json({ ok: false, error: { code: 'SERVER_UNAVAILABLE' } }, { status: 503, headers: modeHeaders }));
  assert.equal(runtime.centralBootstraps, 0);
  assert.equal(runtime.api.user, null);
  assert.equal(runtime.events.some((event) => event.type === 'nakwol-error'), true);
  assert.equal(runtime.navigations.length, 0);
});

test('local logout clears state and reauthenticates through site login only', async () => {
  const runtime = await boot(Response.json({ ok: true, user: { id: 'local', membership: { is_member: true } } }, { headers: modeHeaders }));
  await method(runtime.api, 'logout')();
  assert.equal(runtime.centralLogouts, 0);
  assert.equal(runtime.events.some((event) => event.type === 'nakwol-logout'), true);
  assert.equal(method(runtime.api, 'isAuthenticated')(), false);
  await method(runtime.api, 'login')();
  assert.equal(runtime.navigations.length, 1);
  const login = new URL(runtime.navigations[0]);
  assert.equal(login.pathname, '/__nakwol/login');
  assert.equal(login.searchParams.get('return_to'), '/private?a=1#section');
});


test('explicit global logout revokes locally before central family navigation', async () => {
  const runtime = await boot(Response.json({ ok: true, user: { id: 'local', membership: { is_member: true } } }, { headers: modeHeaders }));
  const logout = runtime.api.logout;
  assert.equal(typeof logout, 'function');
  await Reflect.apply(logout, null, [{ global: true }]);
  assert.deepEqual(runtime.requests.at(-1), { path: '/__nakwol/logout', method: 'POST' });
  const target = new URL(runtime.navigations[0]);
  assert.equal(target.origin, 'https://auth.example');
  assert.equal(target.pathname, '/session/logout');
  assert.equal(target.searchParams.get('client_id'), 'client');
  assert.equal(target.searchParams.get('return_to'), 'https://site.example/private?a=1#section');
  assert.equal(method(runtime.api, 'isAuthenticated')(), false);
});
