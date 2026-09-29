import { readFile } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import type { Env } from '../../src/types';

export async function authFixture() {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0004_nakwol_connect_cli.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql', '0014_gate_reports.sql', '0015_auth_policy_settings.sql']) {
    const sql = await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)) await DB.prepare(statement).run();
  }
  const env = { DB, NAKWOL_GUILD_ID: 'guild-fixture', NAKWOL_MEMBER_ROLE_ID: 'season3',
    DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture', AUTH_ORIGIN: 'https://auth.test' } satisfies Env;
  await DB.prepare("INSERT INTO users VALUES ('member', 'Member', NULL, 'active', 0, 0)").run();
  for (const client of ['a', 'b']) {
    await DB.prepare("INSERT INTO applications VALUES (?, ?, ?, 'active', 0, 0)").bind(client, client, JSON.stringify([`https://${client}.test/callback`])).run();
  }
  return { env, dispose: () => mf.dispose() };
}
