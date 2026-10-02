import type { Env } from './types';
import { ServiceManagementError } from './service-management-types';

export interface ServiceUserRow {
  readonly client_id:string; readonly subject:string; readonly discord_id:string; readonly user_id:string|null;
  readonly display_name:string|null; readonly first_authorized_at:number|null; readonly last_authenticated_at:number|null;
  readonly last_observed_at:number|null; readonly observation_received_at:number|null; readonly last_attempt_at:number|null;
  readonly status:string; readonly version:number; readonly denied:number; readonly grant_until:number|null;
}
const projection=`SELECT r.*,CASE WHEN d.status='active' AND (d.expires_at IS NULL OR d.expires_at>?) THEN 1 ELSE 0 END AS denied,
 CASE WHEN g.expires_at>? THEN g.expires_at ELSE NULL END AS grant_until FROM app_user_relationships r
 LEFT JOIN application_access_denies d ON d.scope='app:'||r.client_id AND d.discord_user_id=r.discord_id
 LEFT JOIN service_user_grants g ON g.client_id=r.client_id AND g.discord_id=r.discord_id`;
export function serviceUserDto(row:ServiceUserRow) {
  return {subject:row.subject,discordId:row.discord_id,displayName:row.display_name,
    state:row.denied?'blocked':row.status==='denied'?'denied':row.status==='preregistered'?'preregistered':row.last_observed_at?'observed':'authorized',
    firstAuthorizedAt:row.first_authorized_at,lastAuthenticatedAt:row.last_authenticated_at,lastObservedAt:row.last_observed_at,
    lastAttemptAt:row.last_attempt_at,observationReceivedAt:row.observation_received_at,
    observationSource:row.last_observed_at?'server-gate':null,
    observationDelayMs:row.last_observed_at!==null&&row.observation_received_at!==null?Math.max(0,row.observation_received_at-row.last_observed_at):null,
    appDenied:Boolean(row.denied),delegatedGrantExpiresAt:row.grant_until,version:row.version};
}
export async function serviceUser(env:Env,clientId:string,subject:string) {
  if(!/^[a-f0-9]{36}$/.test(subject))throw new ServiceManagementError('NOT_FOUND',404);
  const now=Date.now(),row=await env.DB.prepare(projection+' WHERE r.client_id=? AND r.subject=?').bind(now,now,clientId,subject).first<ServiceUserRow>();
  if(!row)throw new ServiceManagementError('NOT_FOUND',404);
  return row;
}
export async function listServiceUsers(env:Env,clientId:string,query:Record<string,string>) {
  if(Object.keys(query).some(k=>!['cursor','limit','state','q'].includes(k)))throw new ServiceManagementError('INVALID_QUERY',400);
  const limit=query.limit===undefined?50:Number(query.limit),state=query.state??'',q=query.q??'';
  if(!Number.isInteger(limit)||limit<1||limit>100||q.length>100||!['','authorized','observed','denied','preregistered','blocked'].includes(state))throw new ServiceManagementError('INVALID_QUERY',400);
  let after='';
  if(query.cursor) {
    try {if(query.cursor.length>2048)throw new ServiceManagementError('INVALID_CURSOR',400);
      const cursor:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(atob(query.cursor),c=>c.charCodeAt(0))));
      if(!Array.isArray(cursor)||cursor.length!==4||cursor[0]!==clientId||typeof cursor[1]!=='string'||cursor[2]!==state||cursor[3]!==q)throw new ServiceManagementError('INVALID_CURSOR',400);
      after=cursor[1];await serviceUser(env,clientId,after);
    }catch(error){if(error instanceof Error)throw new ServiceManagementError('INVALID_CURSOR',400);throw error;}
  }
  const now=Date.now();
  const stateSql=`CASE WHEN denied=1 THEN 'blocked' WHEN status='denied' THEN 'denied' WHEN status='preregistered' THEN 'preregistered' WHEN last_observed_at IS NOT NULL THEN 'observed' ELSE 'authorized' END`;
  const rows=await env.DB.prepare(`SELECT * FROM (${projection} WHERE r.client_id=?) WHERE subject>? AND (?='' OR ${stateSql}=?)
    AND (?='' OR instr(discord_id,?)>0 OR instr(lower(COALESCE(display_name,'')),lower(?))>0) ORDER BY subject LIMIT ?`)
    .bind(now,now,clientId,after,state,state,q,q,q,limit+1).all<ServiceUserRow>();
  const users=rows.results.slice(0,limit),last=users.at(-1);
  const anonymous=await env.DB.prepare('SELECT COALESCE(SUM(count),0) AS count FROM service_anonymous_attempts WHERE client_id=? AND bucket>=?').bind(clientId,now-30*86400000).first<{count:number}>();
  return {users:users.map(serviceUserDto),nextCursor:rows.results.length>limit&&last?btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([clientId,last.subject,state,q])))):null,
    anonymousAttempts:anonymous?.count??0,anonymousWindowDays:30,retention:{observationsDays:30,auditDays:180,denyTombstone:'until explicitly cleared'},
    observationNote:'마지막 관측은 지연·누락될 수 있으며 현재 온라인 상태를 뜻하지 않습니다.'};
}
export async function cleanupServiceUsers(env:Env) {
  const now=Date.now();await env.DB.batch([
    env.DB.prepare('DELETE FROM service_user_observations WHERE received_at<?').bind(now-30*86400000),
    env.DB.prepare('DELETE FROM service_anonymous_attempts WHERE bucket<?').bind(now-30*86400000),
    env.DB.prepare('DELETE FROM service_observation_drops WHERE bucket<?').bind(now-30*86400000),
    env.DB.prepare('DELETE FROM service_user_operations WHERE created_at<?').bind(now-180*86400000),
    env.DB.prepare('UPDATE app_user_relationships SET last_observed_at=NULL,observation_received_at=NULL WHERE observation_received_at<?').bind(now-30*86400000),
  ]);
}
