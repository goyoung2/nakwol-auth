const controlCache=new Map(),controlFlights=new Map(),controlFailures=new Map();
const controlEncoder=new TextEncoder();
const controlDecode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
function controlRemember(map,id,value){if(!map.has(id)&&map.size>=512)map.delete(map.keys().next().value);map.set(id,value);}
async function controlBody(response) {
  const reader=response.body?.getReader();if(!reader)throw new Error('control body');
  let size=0;const chunks=[];
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw new Error('control size');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function verifyControl(envelope,keys,settings,now=Date.now()) {
  if(!envelope||!/^[-\w]{1,64}$/.test(envelope.kid)||typeof envelope.payload!=='string'||envelope.payload.length>60000||typeof envelope.signature!=='string'||envelope.signature.length>128)throw new Error('control envelope');
  if(!Object.hasOwn(keys,envelope.kid))throw new Error('control kid');
  const key=await crypto.subtle.importKey('jwk',keys[envelope.kid],{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  if(!await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,controlDecode(envelope.signature),controlEncoder.encode(envelope.kid+'.'+envelope.payload)))throw new Error('control signature');
  const doc=JSON.parse(new TextDecoder().decode(controlDecode(envelope.payload)));
  if(doc.schemaVersion!==1||doc.audience!=='nakwol-control-v1'||doc.clientId!==settings.clientId||doc.siteOrigin!==new URL(settings.siteUrl).origin
    ||!['active','disabled','inactive','revoked'].includes(doc.appStatus)
    ||!['version','policyFloor','appEpoch','issuedAt','expiresAt'].every(k=>Number.isSafeInteger(doc[k])&&doc[k]>=0)
    ||doc.issuedAt>now+5000||doc.expiresAt<=now||doc.expiresAt<=doc.issuedAt||doc.expiresAt-doc.issuedAt>30000
    ||doc.appEpoch>doc.version||!Array.isArray(doc.revocations)||doc.revocations.length>300||!doc.revocations.every(id=>typeof id==='string'&&id.length<=256))throw new Error('control document');
  return doc;
}
export async function readControl(env,settings) {
  const id=JSON.stringify([settings.clientId,new URL(settings.siteUrl).origin,new URL(settings.authOrigin).origin,env.NAKWOL_SITE_CREDENTIAL,env.NAKWOL_CONTROL_PUBLIC_KEYS]);
  const cached=controlCache.get(id);if(cached?.expiresAt>Date.now())return {status:200,document:cached};
  const failure=controlFailures.get(id);if(failure?.until>Date.now())return {status:failure.status};
  if(controlFlights.has(id))return controlFlights.get(id);
  if(controlFlights.size>=256)return {status:503};
  const task=(async()=>{
    try{
      const keys=typeof env.NAKWOL_CONTROL_PUBLIC_KEYS==='string'?JSON.parse(env.NAKWOL_CONTROL_PUBLIC_KEYS):env.NAKWOL_CONTROL_PUBLIC_KEYS;
      if(!keys||typeof keys!=='object'||Array.isArray(keys)||Object.keys(keys).length>4)throw new Error('control keys');
      const response=await fetch(new URL('/server/v1/control',settings.authOrigin),{method:'POST',headers:{Authorization:'Bearer '+env.NAKWOL_SITE_CREDENTIAL,'Content-Type':'application/json'},body:JSON.stringify({client_id:settings.clientId,site_origin:new URL(settings.siteUrl).origin,observed_version:cached?.version}),redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(4000)});
      if(response.status!==200){if([401,403].includes(response.status)){controlRemember(controlFailures,id,{until:Date.now()+1000,status:response.status});return {status:response.status};}throw new Error('control unavailable');}
      const document=await verifyControl(await controlBody(response),keys,settings);
      if(cached&&document.version<cached.version)throw new Error('control rollback');
      controlRemember(controlCache,id,document);controlFailures.delete(id);
      return {status:200,document};
    }catch{controlRemember(controlFailures,id,{until:Date.now()+1000,status:503});return {status:503};}
  })().finally(()=>controlFlights.delete(id));
  controlFlights.set(id,task);return task;
}
