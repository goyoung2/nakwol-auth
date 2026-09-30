import type { Env } from './types';
import { controlVersion } from './gate-control';
import { randomToken, safeEqual, sha256Base64Url } from './crypto';
import { evaluateAccess } from './policy';
import type { RoleEvidence } from './policy';
import { authenticateSiteCredential, ServerSessionError } from './site-credentials';

interface SessionRow {
  readonly id: string; readonly handle_hash: string; readonly user_id: string; readonly client_id: string;
  readonly site_origin: string; readonly credential_id: string; readonly auth_session_hash: string;
  readonly generation: number; readonly created_at: number; readonly last_used_at: number;
  readonly idle_expires_at: number; readonly absolute_expires_at: number; readonly idle_seconds: number;
  readonly absolute_seconds: number; readonly revoked_at: number | null; readonly source: string;
  readonly verified_at: number; readonly lease_until: number; readonly evidence_until: number; readonly policy_version: number; readonly control_version:number;
}
export interface ServerSessionBinding { readonly clientId: string; readonly siteOrigin: string; readonly credential: string }
export interface ServerSessionHandle extends ServerSessionBinding { readonly sessionId: string; readonly handle: string }
function proof(row: SessionRow) {
  return { sessionId: row.id, generation: row.generation, userId: row.user_id, clientId: row.client_id,
    siteOrigin: row.site_origin, source: row.source, verifiedAt: row.verified_at, leaseUntil: row.lease_until,
    authorizationEvidenceValidUntil: row.evidence_until, sessionExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at, policyVersion: row.policy_version,controlVersion:row.control_version };
}
// This predicate is executed inside the same D1 write transaction as issuance/CAS.
// Policy evaluation can precede a revocation, but cannot mint a proof after its guard fails.
function activeGuard(user: string, family: string, credential: string) {
  return `EXISTS(SELECT 1 FROM users u WHERE u.id=${user} AND u.status='active')
    AND EXISTS(SELECT 1 FROM site_credentials sc WHERE sc.id=${credential} AND sc.revoked_at IS NULL)
    AND EXISTS(SELECT 1 FROM auth_sessions f WHERE f.token_hash=${family} AND f.user_id=${user}
      AND f.expires_at>? AND f.created_at+2592000000>?
      AND NOT EXISTS(SELECT 1 FROM user_reauthentication r WHERE r.user_id=f.user_id AND r.requested_at>=f.created_at))
    AND NOT EXISTS(SELECT 1 FROM application_access_denies d JOIN auth_identities i ON i.provider='discord' AND i.provider_user_id=d.discord_user_id
      WHERE i.user_id=${user} AND d.scope IN ('global',?) AND d.status='active' AND (d.expires_at IS NULL OR d.expires_at>?))
    AND EXISTS(SELECT 1 FROM applications a WHERE a.client_id=? AND a.status='active')`;
}
function roleGuard(user: string, evidence: RoleEvidence | null, now: number, validUntil: number) {
  if (!evidence) return { sql: '1=1', values: [] as (string | number)[] };
  const membership = `EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=${user} AND m.guild_id=?
    AND m.checked_at=? AND m.role_ids=? AND m.is_guild_member=? AND m.role=? AND m.status=?) AND ? < ?`;
  const values: (string | number)[] = [evidence.guildId, evidence.checkedAt, evidence.roleIdsJson,
    evidence.isGuildMember, evidence.role, evidence.status, now, validUntil];
  if (evidence.credentialGeneration === null) {
    return { sql: `${membership} AND NOT EXISTS(SELECT 1 FROM discord_credentials dc WHERE dc.user_id=${user})
      AND EXISTS(SELECT 1 FROM membership_refresh_policy p WHERE p.id=1 AND p.legacy_deadline_at>?)`,
      values: [...values, now] };
  }
  return { sql: `${membership} AND EXISTS(SELECT 1 FROM discord_credentials dc WHERE dc.user_id=${user}
    AND dc.state='active' AND dc.generation=?)`, values: [...values, evidence.credentialGeneration] };
}
async function revision(env: Env) { return (await env.DB.prepare('SELECT version FROM auth_policy_revision WHERE id=1').first<{version:number}>())?.version ?? 0; }
async function readSession(env: Env, id: string) { return env.DB.prepare('SELECT * FROM server_sessions WHERE id=?').bind(id).first<SessionRow>(); }
async function checkedSession(env: Env, args: ServerSessionHandle) {
  const credential = await authenticateSiteCredential(env, args.credential, args.clientId, args.siteOrigin);
  const row = await readSession(env, args.sessionId);
  if (!row || row.client_id !== args.clientId || row.site_origin !== args.siteOrigin || row.credential_id !== credential.id
    || !safeEqual(row.handle_hash, await sha256Base64Url(args.handle))) throw new ServerSessionError('INVALID_SESSION');
  return row;
}
export async function exchangeServerCode(env: Env, args: ServerSessionBinding & { readonly code: string; readonly redirectUri: string; readonly codeVerifier: string }) {
  const started = Date.now();
  const credential = await authenticateSiteCredential(env, args.credential, args.clientId, args.siteOrigin);
  if (args.redirectUri !== args.siteOrigin + '/__nakwol/callback') throw new ServerSessionError('INVALID_REDIRECT', 403);
  const hash = await sha256Base64Url(args.code), challenge = await sha256Base64Url(args.codeVerifier);
  const code = await env.DB.prepare('SELECT user_id,auth_session_hash FROM auth_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>? AND client_id=? AND redirect_uri=? AND code_challenge=?')
    .bind(hash, started, args.clientId, args.redirectUri, challenge).first<{user_id:string;auth_session_hash:string|null}>();
  if (!code?.auth_session_hash) throw new ServerSessionError('INVALID_CODE');
  const family = await env.DB.prepare('SELECT created_at FROM auth_sessions WHERE token_hash=? AND user_id=? AND expires_at>?')
    .bind(code.auth_session_hash,code.user_id,started).first<{created_at:number}>();
  if (!family) throw new ServerSessionError('INVALID_CODE');
  const control=await controlVersion(env,args.clientId);
  const version = await revision(env), access = await evaluateAccess(env, code.user_id, args.clientId, {now:started});
  if (!access.allowed) throw new ServerSessionError(access.reason, access.reason === 'MEMBERSHIP_UNAVAILABLE' ? 503 : 403);
  if (access.requiresRoleEvidence && !access.roleEvidence) throw new ServerSessionError('VERIFICATION_EXPIRED', 503);
  const id = 'ss_' + randomToken(18), handle = randomToken(32), now = Date.now();
  const absolute = Math.min(started + access.effectivePolicy.sessionAbsoluteSeconds * 1000,family.created_at+2592000000);
  const idle = Math.min(absolute, started + access.effectivePolicy.sessionIdleSeconds * 1000);
  const lease = Math.min(idle, access.validUntil, started + Math.min(300,access.effectivePolicy.leaseSeconds) * 1000);
  if (lease <= now) throw new ServerSessionError('VERIFICATION_EXPIRED', 503);
  const membershipGuard = roleGuard('auth_codes.user_id',access.roleEvidence,now,access.validUntil);
  const results = await env.DB.batch<{id:string}>([
    env.DB.prepare(`INSERT INTO server_sessions SELECT ?,?,user_id,client_id,?,?,auth_session_hash,0,?,?,?,?,?,?,NULL,?,?,?,?,?,?
      FROM auth_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>? AND client_id=? AND redirect_uri=? AND code_challenge=?
      AND (SELECT version FROM auth_policy_revision WHERE id=1)=? AND COALESCE((SELECT MAX(seq) FROM gate_control_outbox WHERE client_id=?),0)=? AND ${activeGuard('auth_codes.user_id','auth_codes.auth_session_hash','?')}
      AND ${membershipGuard.sql} RETURNING id`)
      .bind(id,await sha256Base64Url(handle),args.siteOrigin,credential.id,started,started,idle,absolute,access.effectivePolicy.sessionIdleSeconds,access.effectivePolicy.sessionAbsoluteSeconds,
        access.source,started,lease,access.validUntil,access.policyVersion,control,hash,now,args.clientId,args.redirectUri,challenge,version,args.clientId,control,credential.id,now,now,'app:'+args.clientId,now,args.clientId,...membershipGuard.values),
    env.DB.prepare('UPDATE auth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM server_sessions WHERE id=?)').bind(now,hash,id),
  ]);
  if (results[0].results.length !== 1 || results[0].results[0]?.id !== id || results[1].meta.changes !== 1) throw new ServerSessionError('INVALID_CODE');
  const row = await readSession(env,id);
  if (!row) throw new ServerSessionError('INVALID_SESSION');
  return {ok:true as const, session:proof(row),handle};
}
export async function refreshServerSession(env: Env, args: ServerSessionHandle & {readonly expectedGeneration:number}) {
  const started=Date.now(), row=await checkedSession(env,args);
  if (!Number.isSafeInteger(args.expectedGeneration) || args.expectedGeneration < 0 || args.expectedGeneration > row.generation) throw new ServerSessionError('INVALID_GENERATION',409);
  const control=await controlVersion(env,args.clientId);
  const version=await revision(env), access=await evaluateAccess(env,row.user_id,args.clientId,{now:started});
  if (!access.allowed) throw new ServerSessionError(access.reason,access.reason === 'MEMBERSHIP_UNAVAILABLE' ? 503 : 403);
  if (access.requiresRoleEvidence && !access.roleEvidence) throw new ServerSessionError('VERIFICATION_EXPIRED',503);
  const idleSeconds=Math.min(row.idle_seconds,access.effectivePolicy.sessionIdleSeconds), absoluteSeconds=Math.min(row.absolute_seconds,access.effectivePolicy.sessionAbsoluteSeconds);
  // Persist tightening before checking expiry; subsequent relaxation cannot resurrect a session.
  await env.DB.prepare(`UPDATE server_sessions SET idle_seconds=MIN(idle_seconds,?),absolute_seconds=MIN(absolute_seconds,?),
    idle_expires_at=MIN(idle_expires_at,last_used_at+?*1000,created_at+?*1000),absolute_expires_at=MIN(absolute_expires_at,created_at+?*1000) WHERE id=?`)
    .bind(idleSeconds,absoluteSeconds,idleSeconds,absoluteSeconds,absoluteSeconds,row.id).run();
  const now=Date.now(), absolute=Math.min(row.absolute_expires_at,row.created_at+absoluteSeconds*1000);
  const idle=Math.min(absolute,started+idleSeconds*1000),lease=Math.min(idle,access.validUntil,started+Math.min(300,access.effectivePolicy.leaseSeconds)*1000);
  if (lease<=now) throw new ServerSessionError('SESSION_EXPIRED');
  const membershipGuard=roleGuard('server_sessions.user_id',access.roleEvidence,now,access.validUntil);
  const targetGeneration = row.lease_until <= started || row.control_version < control ? row.generation : args.expectedGeneration;
  await env.DB.batch([env.DB.prepare(`UPDATE server_sessions SET generation=generation+1,last_used_at=?,idle_expires_at=MIN(?,absolute_expires_at),
    source=?,verified_at=?,lease_until=?,evidence_until=?,policy_version=?,control_version=?
    WHERE id=? AND generation=? AND revoked_at IS NULL AND idle_expires_at>? AND absolute_expires_at>?
      AND (SELECT version FROM auth_policy_revision WHERE id=1)=? AND COALESCE((SELECT MAX(seq) FROM gate_control_outbox WHERE client_id=?),0)=? AND ${activeGuard('server_sessions.user_id','server_sessions.auth_session_hash','server_sessions.credential_id')}
      AND ${membershipGuard.sql}`)
    .bind(started,idle,access.source,started,lease,access.validUntil,access.policyVersion,control,row.id,targetGeneration,now,now,version,args.clientId,control,now,now,'app:'+args.clientId,now,args.clientId,...membershipGuard.values),
    env.DB.prepare(`UPDATE auth_sessions SET last_used_at=?,expires_at=MIN(created_at+2592000000,?+864000000)
      WHERE token_hash=? AND expires_at>? AND EXISTS(SELECT 1 FROM server_sessions WHERE id=? AND generation=? AND verified_at=? AND revoked_at IS NULL)`)
      .bind(started,started,row.auth_session_hash,now,row.id,targetGeneration+1,started),
  ]);
  const current = await env.DB.prepare(`SELECT * FROM server_sessions WHERE id=? AND revoked_at IS NULL AND idle_expires_at>? AND absolute_expires_at>?
    AND ${activeGuard('server_sessions.user_id','server_sessions.auth_session_hash','server_sessions.credential_id')}
    AND ${membershipGuard.sql}`)
    .bind(row.id,now,now,now,now,'app:'+args.clientId,now,args.clientId,...membershipGuard.values).first<SessionRow>();
  if (!current) throw new ServerSessionError('SESSION_EXPIRED');
  if (current.generation===args.expectedGeneration || current.lease_until<=Date.now()) throw new ServerSessionError('POLICY_CHANGED',409);
  return {ok:true as const,session:proof(current)};
}
export async function revokeServerSession(env: Env,args:ServerSessionHandle) {
  const row=await checkedSession(env,args);
  await env.DB.prepare('UPDATE server_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(Date.now(),row.id).run();
  return {ok:true as const};
}
