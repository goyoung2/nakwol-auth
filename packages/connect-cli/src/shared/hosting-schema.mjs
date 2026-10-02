const keys=['schemaVersion','clientId','siteOrigin','provider','accountId','resourceId','teamId','mode','controlledDeployments','origins','adapterFile'];
const name=/^[a-zA-Z0-9_-]{1,128}$/;
export function hostingOrigin(value){
 if(typeof value!=='string')throw new Error('Hosting origin must be HTTPS.');
 const url=new URL(value);
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.origin!==value)throw new Error('Hosting origin must be a canonical HTTPS origin without a path.');
 return value;
}
export function parseHosting(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw new Error('Invalid hosting document; credentials are not accepted.');
 if(value.schemaVersion!==1||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.clientId||'')||!['cloudflare-workers','cloudflare-pages','vercel'].includes(value.provider)||!name.test(value.resourceId||'')||!['manual','automatic'].includes(value.mode)||typeof value.controlledDeployments!=='boolean')throw new Error('Invalid hosting binding.');
 hostingOrigin(value.siteOrigin);
 if(!Array.isArray(value.origins)||!value.origins.length||value.origins.length>100||new Set(value.origins).size!==value.origins.length||!value.origins.includes(value.siteOrigin))throw new Error('Hosting origins must include the registered site exactly once.');
 for(const origin of value.origins)hostingOrigin(origin);
 if(value.provider==='vercel'?value.accountId!==''||!/^prj_[a-zA-Z0-9]+$/.test(value.resourceId)||!/^team_[a-zA-Z0-9]+$/.test(value.teamId):!/^[a-f0-9]{32}$/.test(value.accountId)||value.teamId!=='')throw new Error('Invalid hosting account/project identifiers.');
 if(typeof value.adapterFile!=='string'||value.adapterFile&&(!/^[a-zA-Z0-9_.\/-]+\.mjs$/.test(value.adapterFile)||value.adapterFile.startsWith('/')||value.adapterFile.split('/').some(p=>p==='..'||p==='.')))throw new Error('Invalid reviewed adapter path.');
 if(value.mode==='automatic'&&(!value.controlledDeployments||!value.adapterFile))throw new Error('Automatic mode requires all deployments serialized and a reviewed recovery adapter.');
 if(value.mode==='manual'&&value.adapterFile)throw new Error('Manual mode does not activate an adapter.');
 return {...value,origins:[...value.origins].sort()};
}
