const observationQueue=new Map(),observationSeen=new Map();
const observationDrops=new Map();
const observationStats={scheduled:0,sent:0,dropped:0,bytes:0,supported:false};
let observationPending=false;
function observationDrop(binding,count){observationStats.dropped+=count;if(!observationDrops.has(binding)&&observationDrops.size>=128)observationDrops.delete(observationDrops.keys().next().value);observationDrops.set(binding,Math.min(1000000,(observationDrops.get(binding)||0)+count));}
export function observationMetrics(){return {...observationStats,queued:observationQueue.size,dropBindings:observationDrops.size};}
async function observationFlush(){
  try{
    let batches=0;
    while(observationQueue.size&&batches++<3){
      const first=observationQueue.values().next().value;
      const batch=[];
      for(const [key,item] of observationQueue){if(item.binding!==first.binding)continue;observationQueue.delete(key);batch.push(item);if(batch.length===50)break;}
      const dropped=observationDrops.get(first.binding)||0;
      const body=JSON.stringify({client_id:first.clientId,site_origin:first.siteOrigin,events:batch.map(item=>({sessionId:item.sessionId,observedAt:item.observedAt})),dropped});
      let sent=false;
      for(let attempt=0;attempt<2&&!sent;attempt++){
        observationStats.bytes+=new TextEncoder().encode(body).length;
        try{const result=await fetch(new URL('/server/v1/observations',first.authOrigin),{method:'POST',headers:{Authorization:'Bearer '+first.credential,'Content-Type':'application/json'},body,cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(2000)});sent=result.status===200;await result.body?.cancel();}
        catch(error){if(!(error instanceof Error))throw error;}
      }
      if(sent){observationStats.sent+=batch.length;const remaining=Math.max(0,(observationDrops.get(first.binding)||0)-dropped);if(remaining)observationDrops.set(first.binding,remaining);else observationDrops.delete(first.binding);}else observationDrop(first.binding,batch.length);
    }
    for(const item of observationQueue.values())observationDrop(item.binding,1);observationQueue.clear();
  }finally{observationPending=false;}
}
export function observeApproval(env,settings,proof){
  if(typeof env.NAKWOL_WAIT_UNTIL!=='function'||!env.NAKWOL_SITE_CREDENTIAL){return false;}
  observationStats.supported=true;
  const now=Date.now();
  if(!proof||typeof proof.userId!=='string'||typeof proof.sessionId!=='string'||proof.verifiedAt>now||proof.leaseUntil<=now)return true;
  const siteOrigin=new URL(settings.siteUrl).origin,binding=JSON.stringify([settings.clientId,siteOrigin,settings.authOrigin,env.NAKWOL_SITE_CREDENTIAL]);
  const bucket=Math.floor(now/300000),key=JSON.stringify([binding,proof.userId,bucket]);
  if(observationSeen.has(key))return true;
  if(observationQueue.size>=128){observationDrop(binding,1);return true;}
  if(observationSeen.size>=512)observationSeen.delete(observationSeen.keys().next().value);
  observationSeen.set(key,bucket);
  observationQueue.set(key,{binding,clientId:settings.clientId,siteOrigin,authOrigin:settings.authOrigin,credential:env.NAKWOL_SITE_CREDENTIAL,sessionId:proof.sessionId,observedAt:now});
  if(!observationPending){
    observationPending=true;observationStats.scheduled++;
    const task=Promise.resolve().then(observationFlush);
    try{env.NAKWOL_WAIT_UNTIL(task);}catch(error){if(!(error instanceof Error))throw error;observationStats.supported=false;}
  }
  return true;
}
