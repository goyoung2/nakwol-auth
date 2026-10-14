import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeDiscordCode, fetchDiscordIdentity, fetchCurrentGuildMember, DiscordRequestError } from '../../src/discord';
import type { Env } from '../../src/types';

const env = {
  DISCORD_CLIENT_ID: '1493410906456064112', DISCORD_CLIENT_SECRET: 'private-secret',
  AUTH_ORIGIN: 'https://auth.example', NAKWOL_GUILD_ID: '1493410906456064112',
  DISCORD_BOT_TOKEN: 'private-bot',
} satisfies Partial<Env>;
function environment(): Env {
  return { ...env, DB: {
    prepare: () => assert.fail('Discord transport must not query DB'),
    batch: () => assert.fail('Discord transport must not query DB'),
    exec: () => assert.fail('Discord transport must not query DB'),
    withSession: () => assert.fail('Discord transport must not query DB'),
    dump: () => assert.fail('Discord transport must not query DB'),
  } };
}
const user = { id: '1493410906456064113', username: 'fixture' };
const member = { roles: ['1553600098661957643'] };

test('ordinary token exchange aborts stalled headers after twenty seconds without retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => {
    calls++; signal = init.signal;
    return new Promise<Response>(() => {});
  });
  const result = assert.rejects(exchangeDiscordCode(environment(), 'one-time-code'), { code: 'timeout', operation: 'token' });
  t.mock.timers.tick(20000);
  await result;
  assert.equal(signal?.aborted, true);
  assert.equal(calls, 1);
});

test('successful headers cannot leave token body pending past its deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let cancelled = false;
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    pull() { entered(); return new Promise<void>(() => {}); },
    cancel() { cancelled = true; },
  })));
  const result = assert.rejects(exchangeDiscordCode(environment(), 'code'), { code: 'timeout' });
  await reading;
  t.mock.timers.tick(20000);
  await result;
  assert.equal(cancelled, true);
});

test('profile and role requests start together and must both succeed', async (t) => {
  const calls: string[] = [];
  let release: (response: Response) => void = () => {};
  const profile = new Promise<Response>(resolve => { release = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    calls.push(input);
    assert.ok(init.signal);
    return input.endsWith('/users/@me') ? profile : Response.json(member);
  });
  const result = fetchDiscordIdentity(environment(), 'access-token');
  assert.equal(calls.length, 2);
  release(Response.json(user));
  assert.deepEqual(await result, { user: { ...user, global_name: undefined, avatar: undefined }, member: { ...member, nick: undefined, avatar: undefined } });
});

test('ordinary membership body stalls fail closed even after identity succeeds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let entered: () => void = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let identityFinished: () => void = () => {};
  const identity = new Promise<void>(resolve => { identityFinished = resolve; });
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    if (input.endsWith('/users/@me')) {
      init.signal?.addEventListener('abort', identityFinished, { once: true });
      return Response.json(user);
    }
    return new Response(new ReadableStream({ pull() { entered(); return new Promise<void>(() => {}); } }));
  });
  const result = assert.rejects(fetchDiscordIdentity(environment(), 'access-token'), { code: 'timeout', operation: 'member' });
  await Promise.all([reading, identity]);
  t.mock.timers.tick(20000);
  await result;
});

test('404 is nonmember while malformed role and identity payloads fail closed', async (t) => {
  for (const payload of [{ roles: ['wrong-role'] }, { roles: [123] }, {}, null]) {
    t.mock.method(globalThis, 'fetch', async (input: string) => Response.json(input.endsWith('/users/@me') ? user : payload));
    await assert.rejects(fetchDiscordIdentity(environment(), 'access-token'), { code: 'invalid_response' });
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async (input: string) => input.endsWith('/users/@me') ? Response.json(user) : new Response(null, { status: 404 }));
  assert.equal((await fetchDiscordIdentity(environment(), 'access-token')).member, null);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async (input: string) => Response.json(input.endsWith('/users/@me') ? { id: 123, username: 'fixture' } : member));
  await assert.rejects(fetchDiscordIdentity(environment(), 'access-token'), { code: 'invalid_response', operation: 'identity' });
});

test('Discord errors never include remote response or credential and never read error bodies', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull() { return new Promise<void>(() => {}); } }), { status: 500 }));
  await assert.rejects(exchangeDiscordCode(environment(), 'secret-code'), (error: unknown) => {
    assert.ok(error instanceof DiscordRequestError);
    assert.equal(error.httpStatus, 500);
    assert.equal(error.code, 'http');
    assert.doesNotMatch(error.message, /secret|token-value|response-body/);
    return true;
  });
});

test('bounded streaming rejects oversized token and role responses', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(' '.repeat(65537)));
  await assert.rejects(exchangeDiscordCode(environment(), 'code'), { code: 'response_too_large' });
  await assert.rejects(fetchCurrentGuildMember(environment(), user.id), { name: 'DiscordMembershipUnavailable' });
});

test('malformed token JSON and empty access tokens cannot establish identity', async (t) => {
  for (const payload of ['broken-json', '{}', '{"access_token":""}']) {
    t.mock.method(globalThis, 'fetch', async () => new Response(payload));
    await assert.rejects(exchangeDiscordCode(environment(), 'code'), { code: 'invalid_response' });
    t.mock.restoreAll();
  }
});

test('a slow token response succeeds after the old five-second cutoff without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', (_input: unknown, init: RequestInit) => {
    calls++; signal = init.signal;
    return new Promise<Response>(resolve => { release = resolve; });
  });
  const result = exchangeDiscordCode(environment(), 'one-time-code');
  t.mock.timers.tick(12000);
  assert.equal(signal?.aborted, false);
  release(Response.json({ access_token: 'slow-success' }));
  assert.equal(await result, 'slow-success');
  assert.equal(calls, 1);
});
