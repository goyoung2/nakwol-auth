import { migrationStatements } from './migration-statements';
import { readFile, readdir } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import type { Env } from '../../src/types';

export async function createAuthFixture() {
  const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  const DB = await mf.getD1Database('DB');
  const migrations = new URL('../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations)).filter(f=>f.endsWith('.sql')).sort()) {
    const sql = await readFile(new URL(file,migrations),'utf8');
    for (const statement of migrationStatements(sql)) await DB.prepare(statement).run();
  }
  const env: Env = {DB,NAKWOL_GUILD_ID:'1493410906456064112',NAKWOL_MEMBER_ROLE_ID:'1553600098661957643',
    DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',AUTH_ORIGIN:'https://auth.test'};
  await DB.prepare("INSERT INTO users VALUES('user','Fixture',NULL,'active',0,0)").run();
  await DB.prepare("INSERT INTO auth_identities VALUES('identity','user','discord','1493410906456064113',0,0)").run();
  await DB.prepare("INSERT INTO applications VALUES('site','Fixture',?,'active',0,0)").bind(JSON.stringify(['https://site.test/'])).run();
  return {env,DB,dispose:()=>mf.dispose()};
}
