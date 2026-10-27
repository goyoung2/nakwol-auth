import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import * as miniflare from 'miniflare';
import { Hono } from 'hono';
import { migrationStatements } from './migration-statements';
import { registerAccessSupportRoutes } from '../../src/access-support';
import { parseHistoryQuery } from '../../src/auth-event-history';
import { sha256Base64Url } from '../../src/crypto';
import { upsertMembership } from '../../src/store';
import type { Env } from '../../src/types';

test('history rejects malformed filters and incomplete pagination cursors', () => {
  for (const input of ['kind=unknown','since=-1','since=101&until=100','until=102','limit=201','limit=1.5','before=100','cursor_id=x','discord_id=bad']) {
    assert.equal(parseHistoryQuery(new URLSearchParams(input),101),null,input);
  }
  assert.equal(parseHistoryQuery(new URLSearchParams(),101)?.kind,'problems');
});

test('operator history retrieves all 1400+ problems without success noise or timestamp cursor loss', async t => {
  const options = {modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB']};
  const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  const dir = new URL('../../migrations/',import.meta.url);
  for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()) {
    for (const sql of migrationStatements(await readFile(new URL(name,dir),'utf8'))) await DB.prepare(sql).run();
  }
  const env = {DB,NAKWOL_GUILD_ID:'guild',NAKWOL_MEMBER_ROLE_ID:'season3',DISCORD_CLIENT_ID:'fixture',DISCORD_CLIENT_SECRET:'fixture',AUTH_ORIGIN:'https://auth.test'};
  for (const id of ['site','other']) await DB.prepare(`INSERT INTO applications VALUES(?,?,'["https://site.test/"]','active',0,0)`).bind(id,id).run();
  for (const id of ['admin','viewer']) {
    await DB.prepare(`INSERT INTO users VALUES(?,?,NULL,'active',0,0)`).bind(id,id).run();
    await DB.prepare(`INSERT INTO access_tokens VALUES(?,?,'nakwol-connect-admin',?,NULL,0)`).bind(await sha256Base64Url(id),id,Date.now()+600000).run();
  }
  await DB.prepare(`INSERT INTO auth_operators(user_id,created_at) VALUES('admin',0)`).run();
  await DB.prepare(`INSERT INTO auth_identities VALUES('i','viewer','discord','111111111111111111',0,0)`).run();
  // Seed in one SQLite statement; exercise pagination through the real D1 route below.
  await DB.prepare(`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<1402)
    INSERT INTO auth_events SELECT printf('event-%05d',x),'viewer','site','authorize.access_denied',
    '{"diagnosis":{"reason":"MEMBERSHIP_REFRESH_REQUIRED"}}',100 FROM n`).run();
  await DB.batch([
    DB.prepare(`INSERT INTO auth_events VALUES('success','viewer','site','authorize.sso','{}',101)`),
    DB.prepare(`INSERT INTO auth_events VALUES('other','viewer','other','authorize.access_denied','{}',100)`),
    DB.prepare(`INSERT INTO auth_events VALUES('error',NULL,'site','discord.login.error','{"message":"DISCORD_TOKEN_NETWORK"}',101)`),
    DB.prepare(`INSERT INTO auth_events VALUES('malformed',NULL,'site','discord.login.error','invalid-json',101)`),
  ]);
  const app = new Hono<{Bindings:Env}>(); registerAccessSupportRoutes(app);
  const request = (params='',token='admin') => app.request('https://auth.test/admin/api/access/site/history?'+params,{headers:{Authorization:'Bearer '+token}},env);
  await t.test('authorization and validation guard both page and aggregate data', async () => {
    assert.equal((await request('','missing')).status,401);
    assert.equal((await request('','viewer')).status,403);
    assert.equal((await request('limit=999')).status,400);
    assert.equal((await app.request('https://auth.test/admin/api/access/missing/history',{headers:{Authorization:'Bearer admin'}},env)).status,404);
  });
  await t.test('all pages preserve tied timestamps, filters, null-user errors and fixed upper bound', async () => {
    const response = await request('until=101&limit=200');
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    let page = await response.json();
    assert.equal(page.events.length,200);assert.equal(page.has_more,true);
    assert.equal(page.summary.reduce((sum:number,row:{count:number})=>sum+row.count,0),1405);
    assert.ok(page.events.some((event:{id:string})=>event.id==='error'));
    const seen = new Set<string>();
    await DB.prepare(`INSERT INTO auth_events VALUES('later','viewer','site','authorize.access_denied','{}',102)`).run();
    for (;;) {
      for (const event of page.events) {assert.equal(seen.has(event.id),false);seen.add(event.id);}
      if (!page.has_more) break;
      page = await (await request(new URLSearchParams({until:'101',limit:'200',summary:'0',before:String(page.next_cursor.created_at),cursor_id:page.next_cursor.id}).toString())).json();
      assert.equal(page.summary,null);
    }
    assert.equal(seen.size,1405);assert.equal(seen.has('success'),false);assert.equal(seen.has('other'),false);assert.equal(seen.has('later'),false);
  });
  await t.test('error-only and Discord filters use the same conditions for totals and rows', async () => {
    await DB.prepare(`INSERT INTO auth_identities VALUES('i-second','viewer','discord','222222222222222222',1,1)`).run();
    const errors = await (await request('kind=errors&until=101')).json();
    assert.equal(errors.events.length,2);assert.equal(errors.summary.reduce((n:number,r:{count:number})=>n+r.count,0),2);
    const user = await (await request('discord_id=111111111111111111&until=101')).json();
    assert.equal(user.summary[0].count,1403);assert.equal(user.summary[0].identified_users,1);
    assert.equal((await (await request('kind=errors&discord_id=111111111111111111')).json()).events.length,0);
    const range = await (await request('since=101&until=101&kind=all')).json();
    assert.equal(range.events.length,3);
    const refresh = await (await request('kind=refresh&until=101')).json();
    assert.equal(refresh.summary[0].count,1403);
    assert.equal(refresh.events[0].category,'refresh');
    assert.equal((await (await request('kind=denied&until=101')).json()).events.length,0);
    const failures = await (await request('kind=failures&until=101')).json();
    assert.equal(failures.events.length,2);
    assert.ok(failures.events.every((e:{category:string})=>e.category==='error'));
  });
  await t.test('current blocked, refresh and recovered views remain distinct and service scoped',async()=>{
    for(const id of ['case-a','case-b','case-c','case-d','case-e']) {
      await DB.prepare(`INSERT INTO users VALUES(?,?,NULL,'active',0,0)`).bind(id,id).run();
      await upsertMembership(env,id,true,'member',id==='case-b'?[]:['season3']);
      await DB.prepare(`INSERT INTO auth_events VALUES(?,?,'site','authorize.access_denied','{}',300)`).bind('denial-'+id,id).run();
    }
    for(const id of ['case-a','case-d']) await DB.prepare(`INSERT INTO auth_events VALUES(?,?,'site','discord.login.success','{}',400)`).bind('success-'+id,id).run();
    await DB.prepare(`INSERT INTO auth_events VALUES('other-success','case-b','other','discord.login.success','{}',400)`).run();
    await DB.prepare(`UPDATE users SET status='disabled' WHERE id='case-d'`).run();
    await DB.prepare(`UPDATE memberships SET checked_at=1 WHERE user_id='case-c'`).run();
    const issues=async(status:string,after='')=>(await app.request('https://auth.test/admin/api/access/site/issues?'+new URLSearchParams({status,after}),{headers:{Authorization:'Bearer admin'}},env)).json();
    const blocked=await issues('blocked');
    assert.deepEqual(blocked.issues.map((r:{user_id:string})=>r.user_id),['case-b','case-d']);
    assert.equal(blocked.issues[1].recovered_after_denial,true);
    const refresh=await issues('refresh');
    assert.ok(refresh.issues.some((r:{user_id:string})=>r.user_id==='case-c'));
    assert.ok(!refresh.issues.some((r:{user_id:string})=>r.user_id==='case-b'));
    const unresolved=await issues('unresolved');
    assert.ok(unresolved.issues.some((r:{user_id:string,current_state:string})=>r.user_id==='case-e'&&r.current_state==='allowed'));
    assert.ok(!unresolved.issues.some((r:{user_id:string})=>r.user_id==='case-a'));
    assert.equal(unresolved.issues.find((r:{user_id:string})=>r.user_id==='case-b').last_success_at,null);
    const recovered=await issues('recovered');
    assert.deepEqual(recovered.issues.map((r:{user_id:string})=>r.user_id),['case-a','case-d']);
    // An old success excludes a user from never-succeeded even when a later denial is unresolved.
    await DB.prepare(`INSERT INTO auth_events VALUES('old-success','case-e','site','discord.login.success','{}',200)`).run();
    const never=await issues('never_succeeded');
    assert.deepEqual(never.issues.map((r:{user_id:string})=>r.user_id),['case-b','case-c']);
    assert.ok((await issues('unresolved')).issues.some((r:{user_id:string})=>r.user_id==='case-e'));
    assert.ok(never.issues.every((r:{last_success_at:number|null})=>r.last_success_at===null));
    // Filtering a current state must not stop the candidate scan when a first page has no matches.
    for(let i=0;i<26;i++) {
      const id='a-no-block-'+String(i).padStart(2,'0');
      await DB.prepare(`INSERT INTO users VALUES(?,?,NULL,'active',0,0)`).bind(id,id).run();
      await upsertMembership(env,id,true,'member',['season3']);
      await DB.prepare(`INSERT INTO auth_events VALUES(?,?,'site','authorize.access_denied','{}',300)`).bind(id,id).run();
    }
    const first=await issues('blocked');assert.equal(first.issues.length,0);assert.equal(first.has_more,true);assert.ok(first.next_cursor);
    const second=await issues('blocked',first.next_cursor);assert.equal(second.issues.length,2);
    assert.equal((await app.request('https://auth.test/admin/api/access/site/issues?status=unknown',{headers:{Authorization:'Bearer admin'}},env)).status,400);
  });
});
