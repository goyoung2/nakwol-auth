import test from 'node:test';
import assert from 'node:assert/strict';

test('300 images across 10 isolates coalesce in background with bounded outage cost',async()=>{
  const original=globalThis.fetch;let calls=0,bytes=0;const tasks=[];
  globalThis.fetch=async(url,init)=>{assert.equal(new URL(url).pathname,'/server/v1/observations');assert.equal(init.headers.Authorization,'Bearer credential');const body=JSON.parse(init.body);assert.equal(body.events.length,1);assert.equal(body.events[0].sessionId,'session');assert.equal(body.events[0].userId,undefined);calls++;bytes+=init.body.length;return Response.json({ok:true});};
  try {
    const mods=await Promise.all(Array.from({length:10},(_,i)=>import('../src/server/observations.mjs?isolate='+i)));
    const settings={clientId:'app',siteUrl:'https://site.test/',authOrigin:'https://auth.test'};
    const proof={sessionId:'session',userId:'user',verifiedAt:Date.now()-1,leaseUntil:Date.now()+300000};
    const env={NAKWOL_SITE_CREDENTIAL:'credential',NAKWOL_WAIT_UNTIL:p=>tasks.push(p)};
    const cpuStart=process.cpuUsage(),started=performance.now();for(const mod of mods)for(let i=0;i<30;i++)mod.observeApproval(env,settings,proof);
    const schedulingMs=performance.now()-started,cpu=process.cpuUsage(cpuStart),schedulingCpuMs=(cpu.user+cpu.system)/1000;await Promise.all(tasks);
    assert.equal(calls,10);assert.ok(bytes<4000);assert.ok(schedulingMs<1000);
    let failed=0;globalThis.fetch=async()=>{failed++;return new Response(null,{status:503});};
    const outage=await import('../src/server/observations.mjs?outage=1');const pending=[];const failedEnv={...env,NAKWOL_WAIT_UNTIL:p=>pending.push(p)};
    for(let i=0;i<1000;i++)outage.observeApproval(failedEnv,settings,{...proof,sessionId:'s'+i,userId:'u'+i});
    const before=outage.observationMetrics();assert.ok(before.queued<=128);assert.ok(before.dropped>=872);
    await Promise.all(pending);assert.ok(failed<=6);assert.ok(outage.observationMetrics().dropped>=1000);
    const unsupported=await import('../src/server/observations.mjs?unsupported=1');unsupported.observeApproval({NAKWOL_SITE_CREDENTIAL:'credential'},settings,proof);assert.equal(unsupported.observationMetrics().scheduled,0);assert.equal(unsupported.observationMetrics().supported,false);
    console.log(JSON.stringify({images:300,isolates:10,transmissions:calls,bytes,schedulingMs,schedulingCpuMs,outageAttempts:failed,dropped:outage.observationMetrics().dropped}));
  }finally{globalThis.fetch=original;}
});
