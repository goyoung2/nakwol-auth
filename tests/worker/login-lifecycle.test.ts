import test from 'node:test';
import assert from 'node:assert/strict';
import auth from '../../src/index';
import { sha256Base64Url } from '../../src/crypto';
import { createAuthFixture } from './auth-fixture';
import type { Env } from '../../src/types';

function failingAuditDatabase(DB: D1Database): D1Database {
  const wrap = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
    get(target,key,receiver) {
      if(key==='bind') return (...args: unknown[])=>wrap(target.bind(...args));
      if(key==='run') return async()=>{throw new Error('fixture audit unavailable');};
      return Reflect.get(target,key,receiver);
    },
  });
  return new Proxy(DB,{get(target,key,receiver){
    if(key==='prepare')return (sql:string)=>sql.includes('INSERT INTO auth_events')?wrap(target.prepare(sql)):target.prepare(sql);
    return Reflect.get(target,key,receiver);
  }});
}

test('audit persistence failure cannot break successful login or its failure redirect',async t=>{
  const {env,DB,dispose}=await createAuthFixture();t.after(dispose);
  const tasks:Promise<unknown>[]=[];
  const ctx={waitUntil:(task:Promise<unknown>)=>{tasks.push(task);},passThroughOnException:()=>{}};
  const runtime={...env,DB:failingAuditDatabase(DB)};
  const logs:unknown[][]=[];
  t.mock.method(console,'error',(...args:unknown[])=>{logs.push(args);});
  let roles=[env.NAKWOL_MEMBER_ROLE_ID];let fail=false;
  t.mock.method(globalThis,'fetch',async(input: string | URL | Request)=>{
    if(fail)throw new Error('private dependency failure');
    const url=String(input);
    if(url.includes('/oauth2/token'))return Response.json({access_token:'fixture'});
    if(url.endsWith('/users/@me'))return Response.json({id:'1493410906456064113',username:'Fixture'});
    return Response.json({roles});
  });
  const callback=async()=>{
    const query=new URLSearchParams({client_id:'site',redirect_uri:'https://site.test/',code_challenge:await sha256Base64Url('verifier'),code_challenge_method:'S256'});
    const initial=await auth.request('https://auth.test/authorize?'+query,{},runtime,ctx);
    const state=new URL(initial.headers.get('Location')||'').searchParams.get('state')||'';
    return auth.request('https://auth.test/auth/discord/callback?'+new URLSearchParams({state,code:'fixture'}),{},runtime,ctx);
  };
  const allowed=await callback();
  assert.equal(allowed.status,302);
  assert.ok(new URL(allowed.headers.get('Location')||'').searchParams.get('code'));
  assert.ok(allowed.headers.get('Set-Cookie')?.startsWith('nakwol_sid='));
  roles=[];
  const denied=await callback();
  assert.equal(new URL(denied.headers.get('Location')||'').searchParams.get('error'),'access_denied');
  assert.match(denied.headers.get('Set-Cookie')||'',/Max-Age=0/);
  fail=true;
  const errored=await callback();
  assert.equal(new URL(errored.headers.get('Location')||'').searchParams.get('error'),'nakwol_auth_failed');
  await Promise.all(tasks);
  assert.equal(logs.filter(row=>row[0]==='AUTH_EVENT_WRITE_FAILED').length,3);
  assert.equal(JSON.stringify(logs).includes('private dependency failure'),false);
});

test('/me has a whole-response deadline and never exposes a user on a stalled read',async t=>{
  const {env:fixture,DB,dispose}=await createAuthFixture();t.after(dispose);
  const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,key,receiver){
    if(key==='bind')return (...args:unknown[])=>wrap(target.bind(...args));
    if(key==='first')return ()=>new Promise<never>(()=>{});
    return Reflect.get(target,key,receiver);
  }});
  const env:Env={...fixture,DB:new Proxy(DB,{get(target,key,receiver){
    if(key==='prepare')return (sql:string)=>wrap(target.prepare(sql));
    return Reflect.get(target,key,receiver);
  }})};
  t.mock.timers.enable({apis:['setTimeout']});
  const response=auth.request('https://auth.test/me?client_id=site',{headers:{Authorization:'Bearer fixture'}},env);
  await new Promise<void>(resolve=>setImmediate(resolve));
  t.mock.timers.tick(5500);
  const result=await response;
  assert.equal(result.status,503);
  assert.equal(result.headers.get('Cache-Control'),'no-store');
  const body=await result.json();
  assert.equal(body.error.code,'AUTH_CHECK_TIMEOUT');
  assert.equal(body.data,undefined);
});
