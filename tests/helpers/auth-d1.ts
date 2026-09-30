import { readFile } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import type { Env } from '../../src/types';

export async function authFixture(script = 'export default {fetch(){return new Response("ok")}}',control?:{readonly jwk:string;readonly kid:string}) {
  const options = { modules: true, script, d1Databases: ['DB'], ...(control?{durableObjects:{GATE_CONTROL:{className:'GateControlObject',useSQLite:true}}}:{}), bindings: {NAKWOL_GUILD_ID:'guild-fixture',NAKWOL_MEMBER_ROLE_ID:'season3',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',AUTH_ORIGIN:'https://auth.test',...(control?{GATE_CONTROL_SIGNING_JWK:control.jwk,GATE_CONTROL_KID:control.kid}:{})} };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  const DB = await mf.getD1Database('DB');
  for (const file of ['0001_initial.sql', '0003_nakwol_connect.sql', '0004_nakwol_connect_cli.sql', '0011_season_roles.sql', '0012_membership_role_ids.sql', '0013_access_support.sql', '0014_gate_reports.sql', '0015_auth_policy_settings.sql', '0016_server_sessions.sql', '0017_discord_credentials.sql','0018_gate_control.sql']) {
    const sql = await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/gi) ?? []) await DB.prepare(statement).run();
  }
  const env = { DB, NAKWOL_GUILD_ID: 'guild-fixture', NAKWOL_MEMBER_ROLE_ID: 'season3',
    DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'fixture', AUTH_ORIGIN: 'https://auth.test' } satisfies Env;
  await DB.prepare("INSERT INTO users VALUES ('member', 'Member', NULL, 'active', 0, 0)").run();
  for (const client of ['a', 'b']) {
    await DB.prepare("INSERT INTO applications VALUES (?, ?, ?, 'active', 0, 0)").bind(client, client, JSON.stringify([`https://${client}.test/callback`])).run();
  }
  const bound=control?{...env,GATE_CONTROL:await mf.getDurableObjectNamespace('GATE_CONTROL'),GATE_CONTROL_SIGNING_JWK:control.jwk,GATE_CONTROL_KID:control.kid}:env;
  return { env:bound, dispatchFetch: mf.dispatchFetch.bind(mf), dispose: () => mf.dispose() };
}
