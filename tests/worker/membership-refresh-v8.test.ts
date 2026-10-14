import { migrationStatements } from './migration-statements';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isApplicationAccessAllowed } from '../../src/policy';
import type { Env } from '../../src/types';
import { readFile, readdir } from 'node:fs/promises';
import * as miniflare from 'miniflare';

type Role = 'user' | 'member' | 'admin';

async function createV8Env() {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  const DB = await mf.getD1Database('DB');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file,migrations),'utf8');
    for (const statement of migrationStatements(sql)) await DB.prepare(statement).run();
  }
  const env: Env = { DB, NAKWOL_GUILD_ID:'1493410906456064112', NAKWOL_MEMBER_ROLE_ID:'1553600098661957643',
    DISCORD_CLIENT_ID:'discord-client', DISCORD_CLIENT_SECRET:'discord-secret', AUTH_ORIGIN:'https://auth.example.test' };
  await DB.prepare("INSERT INTO users VALUES('usr_v8','V8 Tester',NULL,'active',0,0)").run();
  await DB.prepare("INSERT INTO auth_identities VALUES('identity','usr_v8','discord','1493410906456064113',0,0)").run();
  await DB.prepare("INSERT INTO applications VALUES('siege-calculator','Fixture','[]','active',0,0)").run();
  return {env,dispose:()=>mf.dispose(),membership:()=>DB.prepare("SELECT role,status,is_guild_member FROM memberships WHERE user_id='usr_v8'").first<{role:string;status:string;is_guild_member:number}>()};
}

test('V8 refreshes Discord member -> user -> member and access policy follows the refreshed membership', async t => {
  const store = await import('../../src/store');
  const refreshDiscordMembership = (store as typeof store & {
    refreshDiscordMembership?: (
      env: Env,
      discordAccessToken: string,
    ) => Promise<{ userId: string; role: Role }>;
  }).refreshDiscordMembership;

  assert.equal(
    typeof refreshDiscordMembership,
    'function',
    'V8 needs one testable fresh-Discord membership refresh orchestration path',
  );
  if (!refreshDiscordMembership) return;

  const { env, membership, dispose } = await createV8Env();
  t.after(dispose);
  const originalFetch = globalThis.fetch;
  let roles = ['1553600098661957643'];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/users/@me')) {
      return new Response(JSON.stringify({
        id: '1493410906456064113',
        username: 'v8-user',
        global_name: 'V8 Tester',
        avatar: null,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/users/@me/guilds/1493410906456064112/member')) {
      return new Response(JSON.stringify({ nick: 'V8 Tester', roles }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected Discord URL: ${url}`);
  };

  try {
    const asMember = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(asMember.userId, 'usr_v8');
    assert.equal(asMember.role, 'member');
    assert.equal((await membership())?.role, 'member');
    assert.equal((await membership())?.status, 'active');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), true);

    roles = [];
    const asUser = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(asUser.role, 'user');
    assert.equal((await membership())?.is_guild_member, 1, 'role removal does not mean the Discord user left the guild');
    assert.equal((await membership())?.role, 'user');
    assert.equal((await membership())?.status, 'inactive');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), false);

    roles = ['1553600098661957643'];
    const restored = await refreshDiscordMembership(env, 'discord-token-v8');
    assert.equal(restored.role, 'member');
    assert.equal((await membership())?.role, 'member');
    assert.equal((await membership())?.status, 'active');
    assert.equal(await isApplicationAccessAllowed(env, 'usr_v8', 'siege-calculator'), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
