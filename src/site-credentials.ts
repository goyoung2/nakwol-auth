import type { Env } from './types';
import { randomToken, sha256Base64Url } from './crypto';
import { ServiceManagementError } from './service-management-types';

export class ServerSessionError extends Error {
  constructor(public readonly code: string, public readonly status: 401 | 403 | 409 | 429 | 503 = 401) { super(code); }
}
export interface SiteCredential { readonly id: string; readonly client_id: string; readonly site_origin: string }
export async function requireRegisteredSite(env: Env, clientId: string, origin: string): Promise<void> {
  let url: URL;
  try { url = new URL(origin); } catch { throw new ServerSessionError('INVALID_SITE', 403); }
  if (url.origin !== origin || url.protocol !== 'https:' || url.username || url.password) throw new ServerSessionError('INVALID_SITE', 403);
  const app = await env.DB.prepare("SELECT redirect_uris FROM applications WHERE client_id=? AND status='active'").bind(clientId).first<{ redirect_uris: string }>();
  const redirects: unknown = JSON.parse(app?.redirect_uris ?? '[]');
  if (!Array.isArray(redirects) || !redirects.includes(origin + '/__nakwol/callback')) throw new ServerSessionError('INVALID_SITE', 403);
}
export async function authenticateSiteCredential(env: Env, secret: string, clientId: string, siteOrigin: string): Promise<SiteCredential> {
  if (!secret || secret.length > 256) throw new ServerSessionError('INVALID_CREDENTIAL');
  const row = await env.DB.prepare('SELECT id,client_id,site_origin FROM site_credentials WHERE secret_hash=? AND client_id=? AND site_origin=? AND revoked_at IS NULL')
    .bind(await sha256Base64Url(secret), clientId, siteOrigin).first<SiteCredential>();
  if (!row) throw new ServerSessionError('INVALID_CREDENTIAL');
  await requireRegisteredSite(env, clientId, siteOrigin);
  const window = Math.floor(Date.now()/60000)*60000;
  const rate = await env.DB.prepare(`INSERT INTO service_management_rate_limits(bucket_key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END RETURNING count`)
    .bind('server:'+row.id,window).first<{count:number}>();
  if (!rate || rate.count>600) throw new ServerSessionError('RATE_LIMITED',429);
  return row;
}
const authority = `EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND
 (EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) OR
 EXISTS(SELECT 1 FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id
 WHERE o.user_id=u.id AND o.client_id=? AND d.status='active')))`;
export async function issueSiteCredential(env: Env, actor: string, clientId: string, siteOrigin: string, reason: string) {
  try { await requireRegisteredSite(env, clientId, siteOrigin); }
  catch(error) { if(error instanceof ServerSessionError) throw new ServiceManagementError(error.code,403); throw error; }
  const id = 'sc_' + randomToken(18), secret = randomToken(32), now = Date.now();
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO site_credentials SELECT ?,?,?,?,?,NULL WHERE ${authority}`).bind(id, await sha256Base64Url(secret), clientId, siteOrigin, now, actor, clientId),
    env.DB.prepare("INSERT INTO site_credential_audit SELECT ?,id,client_id,?,'issue',?,? FROM site_credentials WHERE id=?").bind(randomToken(18), actor, reason, now, id),
  ]);
  if (result[0].meta.changes !== 1) throw new ServiceManagementError('FORBIDDEN', 403);
  return { credentialId: id, clientId, siteOrigin, secret };
}
export async function revokeSiteCredential(env: Env, actor: string, clientId: string, credentialId: string, reason: string) {
  const now = Date.now(), operation = randomToken(18);
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO site_credential_audit SELECT ?,id,client_id,?,'revoke',?,? FROM site_credentials WHERE id=? AND client_id=? AND ${authority}`)
      .bind(operation, actor, reason, now, credentialId, clientId, actor, clientId),
    env.DB.prepare('UPDATE site_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM site_credential_audit WHERE id=?)').bind(now, credentialId, operation),
    env.DB.prepare('UPDATE server_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE credential_id=? AND EXISTS(SELECT 1 FROM site_credential_audit WHERE id=?)').bind(now, credentialId, operation),
  ]);
  if (result[0].meta.changes !== 1) throw new ServiceManagementError('FORBIDDEN', 403);
  return { revoked: true };
}
