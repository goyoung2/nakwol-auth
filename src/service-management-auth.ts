import type { Context } from 'hono';
import type { Env } from './types';
import { authenticateAccessToken } from './store';
import { resolveAuthPolicy } from './auth-policy-settings';
import { ServiceManagementError, type AppTarget, type ServiceActor } from './service-management-types';
import { sha256Base64Url } from './crypto';

export async function managementAuthenticatedAt(c:Context<{Bindings:Env}>,userId:string,fresh=true):Promise<number> {
  const row=await c.env.DB.prepare(`SELECT MAX(s.created_at) AS authenticated_at FROM auth_sessions s WHERE s.user_id=? AND s.expires_at>? AND s.created_at<=COALESCE((SELECT created_at FROM access_tokens WHERE token_hash=?),0)`)
    .bind(userId,Date.now(),await sha256Base64Url(c.req.header('Authorization')?.replace(/^Bearer\s+/i,'')??'')).first<{authenticated_at:number|null}>();
  const authenticatedAt=row?.authenticated_at??0;
  if(fresh&&(authenticatedAt>Date.now()||authenticatedAt<Date.now()-900000))throw new ServiceManagementError('RECENT_AUTH_REQUIRED',403);
  return authenticatedAt;
}

export async function authenticateServiceActor(c: Context<{ Bindings: Env }>): Promise<ServiceActor> {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const userId = token ? await authenticateAccessToken(c.env, token, 'nakwol-connect-admin') : null;
  if (!userId) throw new ServiceManagementError('UNAUTHORIZED', 401);
  const active = await c.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();
  if (!active) throw new ServiceManagementError('FORBIDDEN', 403);
  const operator = await c.env.DB.prepare('SELECT user_id FROM auth_operators WHERE user_id=?').bind(userId).first();
  return { userId, isOperator: Boolean(operator) };
}

export async function requireServiceOwner(env: Env, actor: ServiceActor, clientId: string): Promise<void> {
  // Never trust the role cached in the caller's principal.
  const row = await env.DB.prepare(`SELECT a.client_id FROM applications a JOIN users u ON u.id=? AND u.status='active'
    WHERE a.client_id=? AND (EXISTS(SELECT 1 FROM auth_operators WHERE user_id=u.id)
    OR EXISTS(SELECT 1 FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id
      WHERE o.client_id=a.client_id AND o.user_id=u.id AND d.status='active'))`).bind(actor.userId, clientId).first();
  if (!row) throw new ServiceManagementError('FORBIDDEN', 403);
}

export async function requireAppTarget(env: Env, clientId: string, target: AppTarget): Promise<void> {
  if (target.clientId !== undefined && target.clientId !== clientId) throw new ServiceManagementError('INVALID_TARGET', 400);
  // These identifiers have no app-scoped relationship contract until D02/T06.
  for (const key of ['subject', 'sessionId', 'cursor', 'supportCode'] as const) {
    if (target[key] !== undefined) throw new ServiceManagementError('UNSUPPORTED_TARGET', 400);
  }
  if (target.operationId !== undefined) {
    const row = await env.DB.prepare('SELECT id FROM auth_policy_operations WHERE id=? AND scope=?').bind(target.operationId, `app:${clientId}`).first();
    if (!row) throw new ServiceManagementError('NOT_FOUND', 404);
  }
}

export async function getServiceCapabilities(env: Env, actor: ServiceActor, clientId: string) {
  await requireServiceOwner(env, actor, clientId);
  const policy = await resolveAuthPolicy(env, clientId);
  const global = await resolveAuthPolicy(env, null);
  const operator = Boolean(await env.DB.prepare('SELECT user_id FROM auth_operators WHERE user_id=?').bind(actor.userId).first());
  return { schemaVersion: 1, clientId, capabilities: ['policy:read', 'policy:write', 'operations:read','users:read','users:manage'],
    editablePolicy: operator ? ['leaseSeconds', 'sessionIdleSeconds', 'sessionAbsoluteSeconds', 'accessTokenSeconds', 'grantableConditions', 'accessPolicy'] : ['leaseSeconds', 'sessionIdleSeconds', 'sessionAbsoluteSeconds'],
    ranges: { leaseSeconds: { min: 60, max: Math.min(300, global.effective.leaseSeconds) }, sessionIdleSeconds: { min: 3600, max: Math.min(864000, global.effective.sessionIdleSeconds) }, sessionAbsoluteSeconds: { min: 3600, max: Math.min(2592000, global.effective.sessionAbsoluteSeconds) } },
    grantableConditions: policy.effective.grantableConditions, userManagementAvailable: true };
}

export async function requireManagementMutation(c: Context<{ Bindings: Env }>, actor: ServiceActor, scope: string): Promise<Record<string, unknown>> {
  if (c.req.header('Origin') !== new URL(c.env.AUTH_ORIGIN).origin) throw new ServiceManagementError('INVALID_ORIGIN', 403);
  await managementAuthenticatedAt(c,actor.userId);
  const now = Date.now();
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new ServiceManagementError('INVALID_BODY', 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength;
    if (length > 8192) { await reader.cancel(); throw new ServiceManagementError('BODY_TOO_LARGE', 413); } chunks.push(next.value); } }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body: unknown; try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new ServiceManagementError('INVALID_BODY', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ServiceManagementError('INVALID_BODY', 400);
  const record = body as Record<string, unknown>;
  if (typeof record.reason !== 'string' || record.reason.trim().length < 3 || record.reason.length > 500) throw new ServiceManagementError('REASON_REQUIRED', 400);
  const bucket = Math.floor(now / 60000) * 60000;
  const rate = await c.env.DB.prepare(`INSERT INTO service_management_rate_limits(bucket_key,window_start,count) VALUES(?,?,1)
    ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END RETURNING count`)
    .bind(`${actor.userId}:${scope}`, bucket).first<{ count: number }>();
  if (!rate || rate.count > 20) throw new ServiceManagementError('RATE_LIMITED', 429);
  return record;
}
