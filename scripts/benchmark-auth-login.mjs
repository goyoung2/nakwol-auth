import { migrationStatements } from '../tests/worker/migration-statements.ts';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import * as miniflare from 'miniflare';
import app from '../src/index.ts';
import { sha256Base64Url } from '../src/crypto.ts';
import { HttpD1Database } from '../adapters/vercel/d1-http.ts';
import { createGate } from '../packages/connect-cli/src/server/gate.mjs';

const latency = Number(process.argv[2] || 0);
if (!Number.isFinite(latency) || latency < 0 || latency > 1000) throw new Error('RPC delay must be 0..1000 milliseconds');
const root = process.cwd();
const output = resolve(root, '.wrangler/auth-login-benchmark');
await fs.mkdir(output, { recursive: true });
const options = { modules: true, script: 'export default {fetch(){return new Response("ok")}}', d1Databases: ['DB'] };
const mf = new miniflare.Miniflare('convertV4MiniflareOptions' in miniflare ? miniflare.convertV4MiniflareOptions(options) : options);
const native = await mf.getD1Database('DB');
const recorded = [];
const stages = [];
let stage = '', active = 0;
const transport = async (_url, options) => {
  const input = JSON.parse(options.body);
  const start = performance.now();
  const observation = { stage, method: input.method, query: input.statement?.query.replace(/\s+/g, ' ').slice(0,180), concurrent: ++active };
  recorded.push(observation);
  try {
    if (latency) await new Promise(done => setTimeout(done, latency));
    const prepare = s => s.params.length ? native.prepare(s.query).bind(...s.params) : native.prepare(s.query);
    let result;
    switch (input.method) {
      case 'first': result = await prepare(input.statement).first(input.column); break;
      case 'run': result = await prepare(input.statement).run(); break;
      case 'all': result = await prepare(input.statement).all(); break;
      case 'batch': result = await native.batch(input.statements.map(prepare)); break;
      default: throw new Error('Unexpected RPC');
    }
    return Response.json({ok:true,result});
  } finally { active--; observation.elapsedMs = +(performance.now()-start).toFixed(1); }
};
const env = { DB: new HttpD1Database('https://bridge.test/rpc', 'a'.repeat(48), transport),
  NAKWOL_GUILD_ID:'1493410906456064112', NAKWOL_MEMBER_ROLE_ID:'1553600098661957643',
  AUTH_ORIGIN:'https://auth.test', DISCORD_CLIENT_ID:'fixture', DISCORD_CLIENT_SECRET:'fixture' };
const background = [];
const execution = { waitUntil(task) { background.push(task); }, passThroughOnException() {} };
const fetchOriginal = globalThis.fetch;
const randomOriginal = Math.random;
const discordCalls = [];
const request = (url, init={}) => app.request(String(url), init, env, execution);
const measure = async (name, fn) => {
  stage=name; const index=recorded.length, start=performance.now();
  const value = await fn();
  const events = recorded.slice(index);
  stages.push({stage:name, status:value?.status, rpc:events.length, maxConcurrent:Math.max(0,...events.map(e=>e.concurrent)), elapsedMs:+(performance.now()-start).toFixed(1)});
  return value;
};
try {
  for (const file of (await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort()) {
    for (const sql of migrationStatements(await fs.readFile('migrations/'+file,'utf8'))) await native.prepare(sql).run();
  }
  await native.prepare("INSERT INTO applications VALUES('site','Fixture',?,'active',0,0)").bind(JSON.stringify(['https://site.test/'])).run();
  await native.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','member',0,0)").run();
  await native.prepare("INSERT INTO users VALUES('user','Fixture',NULL,'active',0,0)").run();
  await native.prepare("INSERT INTO auth_identities VALUES('identity','user','discord','1493410906456064113',0,0)").run();
  globalThis.fetch = async (input, options={}) => {
    const url = String(input);
    if (url.startsWith('https://auth.test/')) return request(url,options);
    discordCalls.push({path:new URL(url).pathname,hasDeadline:Boolean(options.signal)});
    if (url.includes('/oauth2/token')) return Response.json({access_token:'dummy-discord-token'});
    if (url.endsWith('/users/@me')) return Response.json({id:'1493410906456064113',username:'Fixture',avatar:null});
    if (url.endsWith('/member')) return Response.json({roles:[env.NAKWOL_MEMBER_ROLE_ID]});
    throw new Error('Unexpected fixture URL');
  };
  Math.random = () => .99;
  const verifier='fixture-verifier', stateValue='fixture-state';
  const challenge=await sha256Base64Url(verifier);
  const authorizeUrl='https://auth.test/authorize?'+new URLSearchParams({client_id:'site',redirect_uri:'https://site.test/',code_challenge:challenge,code_challenge_method:'S256',state:stateValue});
  const authorize = await measure('authorize-no-session',()=>request(authorizeUrl));
  const discordState=new URL(authorize.headers.get('Location')).searchParams.get('state');
  const callback=await measure('discord-callback',()=>request('https://auth.test/auth/discord/callback?'+new URLSearchParams({state:discordState,code:'fixture-code'})));
  if(callback.status!==302) throw new Error('Callback fixture failed: '+await callback.text());
  const callbackUrl=new URL(callback.headers.get('Location'));
  if(!callbackUrl.searchParams.get('code')) throw new Error('Callback denied: '+callbackUrl.searchParams.get('error'));
  const centralCookie=callback.headers.get('Set-Cookie')?.split(';')[0];
  const tokenResponse=await measure('browser-token',()=>request('https://auth.test/token?client_id=site',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:callbackUrl.searchParams.get('code'),client_id:'site',redirect_uri:'https://site.test/',code_verifier:verifier})}));
  const tokenBody=await tokenResponse.json();
  if(!tokenBody.access_token) throw new Error('Token fixture failed: '+JSON.stringify(tokenBody));
  const token=tokenBody.access_token;
  const me=()=>request('https://auth.test/me?client_id=site',{headers:{Origin:'https://site.test',Authorization:'Bearer '+token}});
  const browserMe=await measure('browser-me',me);
  if(browserMe.status!==200) throw new Error('Member fixture failed: '+await browserMe.text());
  const gate=createGate({siteUrl:'https://site.test/',authOrigin:'https://auth.test',clientId:'site',accessPolicy:'member'});
  let assets=0;
  const gateEnv={sessionSecret:'fixture-only-session-secret-'.repeat(2),serveAsset:()=>{assets++;return new Response('protected',{headers:{ETag:'fixture'}});}};
  const session=await measure('gate-session-me',()=>gate(new Request('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:token})}),gateEnv));
  if(session.status!==204) throw new Error('Site session fixture failed: '+session.status);
  const siteCookie=session.headers.get('Set-Cookie').split(';')[0];
  await measure('protected-html',()=>gate(new Request('https://site.test/',{headers:{Cookie:siteCookie}}),gateEnv));
  await measure('post-page-browser-me',me);
  await measure('300-protected-images',async()=>{
    const results=await Promise.all(Array.from({length:300},(_,i)=>gate(new Request('https://site.test/image-'+i+'.png',{headers:{Cookie:siteCookie}}),gateEnv)));
    if(results.some(r=>r.status!==200)) throw new Error('Image fixture denied');
    return {status:200};
  });
  await measure('authorize-existing-central-session',()=>request(authorizeUrl,{headers:{Cookie:centralCookie}}));
  const result={model:'Current unmodified Hono handlers + HttpD1Database + real local D1; synthetic bridge delay, synthetic Discord, browser request sequence; not production timing',latencyPerRpcMs:latency,stages,discordCalls,assets,rpc:recorded};
  await fs.writeFile(resolve(output, 'profile-'+latency+'.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({latencyPerRpcMs:latency,stages,discordCalls,assets},null,2));
} finally {
  await Promise.allSettled(background); globalThis.fetch=fetchOriginal; Math.random=randomOriginal; await mf.dispose();
}
