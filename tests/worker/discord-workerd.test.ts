import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import * as miniflare from 'miniflare';

test('Discord transport works in workerd and rejects redirects without following or retrying', async t => {
  const bundle = await build({
    stdin: {
      contents: `
        import { exchangeDiscordCode, fetchDiscordIdentity, fetchCurrentGuildMember, DiscordRequestError } from './src/discord';
        const env = { AUTH_ORIGIN: 'https://auth.test', DISCORD_CLIENT_ID: 'fixture',
          DISCORD_CLIENT_SECRET: 'fixture-secret', DISCORD_BOT_TOKEN: 'fixture-bot',
          NAKWOL_GUILD_ID: '1493410906456064112' };
        export default { async fetch(request) {
          try {
            const token = await exchangeDiscordCode(env, 'fixture-code');
            if (new URL(request.url).pathname === '/token') return Response.json({token});
            const identity = await fetchDiscordIdentity(env, token);
            const member = await fetchCurrentGuildMember(env, identity.user.id);
            return Response.json({token, identity, member});
          } catch (error) {
            if (error instanceof DiscordRequestError) return Response.json({operation:error.operation, code:error.code, httpStatus:error.httpStatus}, {status:502});
            throw error;
          }
        } };`,
      resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
      loader: 'ts',
    },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const output = bundle.outputFiles[0];
  assert.ok(output);
  const calls: { url: string; method: string }[] = [];
  let redirectToken = false;
  const user = { id: '1493410906456064113', username: 'Fixture' };
  const member = { roles: ['1553600098661957643'] };
  const options = {
    modules: true, compatibilityDate: '2026-08-24', script: output.text,
    outboundService: async (request: Request) => {
      calls.push({ url: request.url, method: request.method });
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://discord.com', 'no request may reach the redirect destination');
      if (url.pathname === '/api/oauth2/token') {
        assert.equal(request.method, 'POST');
        assert.equal(new URLSearchParams(await request.text()).get('code'), 'fixture-code');
        return redirectToken
          ? new Response(null, { status: 302, headers: { Location: 'https://redirect.test/credential-sink' } })
          : Response.json({ access_token: 'fixture-token' });
      }
      assert.equal(request.method, 'GET');
      if (url.pathname === '/api/v10/users/@me') return Response.json(user);
      if (url.pathname === '/api/v10/users/@me/guilds/1493410906456064112/member'
          || url.pathname === '/api/v10/guilds/1493410906456064112/members/1493410906456064113') return Response.json(member);
      assert.fail(`Unexpected Discord route: ${url.pathname}`);
    },
  };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());

  await t.test('token, identity and membership pass through native fetch', async () => {
    const response = await mf.dispatchFetch('https://auth.test/identity');
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    assert.deepEqual(payload, { token: 'fixture-token', identity: {user, member}, member });
    assert.equal(calls.length, 4);
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  });

  await t.test('302 fails closed without following the destination or retrying token exchange', async () => {
    calls.length = 0;
    redirectToken = true;
    const response = await mf.dispatchFetch('https://auth.test/token');
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { operation: 'token', code: 'http', httpStatus: 302 });
    assert.deepEqual(calls, [{ url: 'https://discord.com/api/oauth2/token', method: 'POST' }]);
  });
});
