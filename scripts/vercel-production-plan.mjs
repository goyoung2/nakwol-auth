import { createHash } from 'node:crypto';
export const oldOrigin='https://nakwol-auth.sepsd21.workers.dev';
export const canaryDatabase='7b3849c6-7d11-41ba-983f-b4ea3876f24f';
const internalCallbacks=[['nakwol-auth-selftest','/demo/callback'],['nakwol-connect-admin','/admin/apps'],['nakwol-connect-admin','/admin/developers'],['nakwol-connect-cli','/connect/cli/device/verify'],['nakwol-account-center','/account']];
export class PreparationError extends Error { constructor(code){super(code);this.name='PreparationError';} }
function demand(value,code){if(!value)throw new PreparationError(code);}
export function exactOrigin(value){
 let url;try{url=new URL(value);}catch{throw new PreparationError('INVALID_PRODUCTION_ORIGIN');}
 demand(url.protocol==='https:'&&url.origin===value&&!url.username&&!url.password&&url.hostname.includes('.')&&!url.hostname.endsWith('.workers.dev')&&url.hostname!=='nakwol-auth-vercel-test.vercel.app','INVALID_PRODUCTION_ORIGIN');return value;
}
export function inspectProduction({accountId,origin,worker,databases,schema,apps,counts}){
 exactOrigin(origin);demand(typeof accountId==='string'&&/^[a-f0-9]{32}$/.test(accountId),'ACCOUNT_ID_REQUIRED');
 const bindings=worker.resources?.bindings;demand(Array.isArray(bindings),'WORKER_BINDINGS_MISSING');
 const read=name=>bindings.find(b=>b.name===name);
 demand(read('AUTH_ORIGIN')?.type==='plain_text'&&read('AUTH_ORIGIN').text===oldOrigin,'WRONG_AUTH_WORKER');
 const binding=read('DB');const database=databases.find(d=>d.uuid===binding?.id);
 demand(binding?.type==='d1'&&database?.name==='nakwol-auth'&&database.uuid!==canaryDatabase,'WRONG_PRODUCTION_DATABASE');
 demand(read('DISCORD_CLIENT_ID')?.type==='plain_text'&&/^[0-9]{17,20}$/.test(read('DISCORD_CLIENT_ID').text),'DISCORD_APP_ID_MISSING');
 demand(read('NAKWOL_GUILD_ID')?.text==='1493410906456064112'&&read('NAKWOL_MEMBER_ROLE_ID')?.text==='1553600098661957643','WRONG_MEMBER_POLICY');
 demand(read('DISCORD_CLIENT_SECRET')?.type==='secret_text','DISCORD_SECRET_BINDING_MISSING');
 demand(Array.isArray(apps)&&Array.isArray(schema),'INVALID_PREFLIGHT_RESULT');
 const additions=[];
 for(const [clientId,path]of internalCallbacks){const app=apps.find(a=>a.client_id===clientId);demand(app?.status==='active','INTERNAL_APP_MISSING:'+clientId);let redirects;try{redirects=JSON.parse(app.redirect_uris);}catch{throw new PreparationError('INVALID_INTERNAL_CALLBACKS');}demand(Array.isArray(redirects)&&redirects.every(v=>typeof v==='string'),'INVALID_INTERNAL_CALLBACKS');const uri=origin+path;if(!redirects.includes(uri))additions.push({clientId,uri});}
 const tables=new Set(schema.map(row=>row.name));
 const needed=['users','auth_identities','auth_operators','memberships','auth_sessions','access_tokens','applications','application_settings','application_access_grants','oauth_requests','diagnostic_reports','diagnostic_stages','diagnostic_rate_guards'];
 const missing=needed.filter(name=>!tables.has(name));
 if(!schema.some(row=>row.name==='oauth_requests.diagnostic_ref'))missing.push('oauth_requests.diagnostic_ref');
 const profile={schema:1,accountId,worker:'nakwol-auth',workerVersion:worker.id,databaseId:database.uuid,databaseName:database.name,oldOrigin,origin,discordClientId:read('DISCORD_CLIENT_ID').text,guildId:read('NAKWOL_GUILD_ID').text,memberRoleId:read('NAKWOL_MEMBER_ROLE_ID').text,secretNames:bindings.filter(b=>b.type==='secret_text').map(b=>b.name).sort(),counts,missingSchema:missing,additions};
 return {...profile,fingerprint:createHash('sha256').update(JSON.stringify(profile)).digest('hex')};
}
export function callbackStatements(profile,action){
 demand(['add','remove'].includes(action),'INVALID_CALLBACK_ACTION');exactOrigin(profile.origin);
 demand(profile.databaseName==='nakwol-auth'&&profile.databaseId!==canaryDatabase,'WRONG_PRODUCTION_DATABASE');
 return profile.additions.map(({clientId,uri})=>{
 demand(internalCallbacks.some(([id,path])=>id===clientId&&profile.origin+path===uri),'UNEXPECTED_CALLBACK');
 return action==='add'?{query:"UPDATE applications SET redirect_uris=json_insert(redirect_uris,'$[#]',?),updated_at=? WHERE client_id=? AND status='active' AND json_valid(redirect_uris) AND NOT EXISTS(SELECT 1 FROM json_each(redirect_uris) WHERE value=?)",params:[uri,Date.now(),clientId,uri]}:{query:"UPDATE applications SET redirect_uris=(SELECT json_group_array(value) FROM json_each(applications.redirect_uris) WHERE value<>?),updated_at=? WHERE client_id=? AND json_valid(redirect_uris) AND EXISTS(SELECT 1 FROM json_each(redirect_uris) WHERE value=?)",params:[uri,Date.now(),clientId,uri]};
 });
}
export function bridgeConfiguration(profile,main){
 exactOrigin(profile.origin);demand(profile.databaseName==='nakwol-auth'&&profile.databaseId!==canaryDatabase,'WRONG_PRODUCTION_DATABASE');
 return {name:'nakwol-auth-vercel-db',account_id:profile.accountId,main,compatibility_date:'2026-10-09',observability:{enabled:false},vars:{NAKWOL_D1_BRIDGE_MODE:'production',NAKWOL_D1_BRIDGE_DATABASE_ID:profile.databaseId},d1_databases:[{binding:'DB',database_name:profile.databaseName,database_id:profile.databaseId}]};
}
