import type { Env } from './types';
import { randomToken } from './crypto';
import { deliverControl,publishPendingControl } from './gate-control';

export interface AuthPolicySettings {
  leaseSeconds: number;
  sessionIdleSeconds: number;
  sessionAbsoluteSeconds: number;
  accessTokenSeconds: number;
  grantableConditions: string[];
}
export const AUTH_POLICY_DEFAULTS: AuthPolicySettings = {
  leaseSeconds: 300, sessionIdleSeconds: 864000, sessionAbsoluteSeconds: 2592000,
  accessTokenSeconds: 3600, grantableConditions: [],
};
export const AUTH_POLICY_LIMITS = {
  leaseSeconds: [60, 300], sessionIdleSeconds: [3600, 864000],
  sessionAbsoluteSeconds: [3600, 2592000], accessTokenSeconds: [600, 3600],
} as const;
export class AuthPolicyError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
const scopeOf = (clientId: string | null) => clientId === null ? 'global' : `app:${clientId}`;
type Row = { scope: string; version: number; settings_json: string };
export async function resolveAuthPolicy(env: Env, clientId: string | null) {
  const rows = await env.DB.prepare('SELECT scope, version, settings_json FROM auth_policy_settings WHERE scope IN (?, ?)')
    .bind('global', scopeOf(clientId)).all<Row>();
  const global = rows.results.find(r => r.scope === 'global');
  const app = clientId === null ? undefined : rows.results.find(r => r.scope === scopeOf(clientId));
  const base: AuthPolicySettings = { ...AUTH_POLICY_DEFAULTS, ...JSON.parse(global?.settings_json ?? '{}') };
  const stored: Partial<AuthPolicySettings> = JSON.parse((clientId === null ? global : app)?.settings_json ?? '{}');
  const effective: AuthPolicySettings = { ...base, ...(clientId === null ? {} : stored) };
  for (const key of Object.keys(AUTH_POLICY_LIMITS) as (keyof typeof AUTH_POLICY_LIMITS)[]) effective[key] = Math.min(effective[key], base[key]);
  effective.sessionIdleSeconds = Math.min(effective.sessionIdleSeconds, effective.sessionAbsoluteSeconds);
  effective.grantableConditions = base.grantableConditions;
  const appSettings = clientId === null ? null : await env.DB.prepare('SELECT access_policy FROM application_settings WHERE client_id=?').bind(clientId).first<{access_policy:string}>();
  return { schemaVersion: 1 as const, policyVersion: Math.max(global?.version ?? 0, app?.version ?? 0),
    globalVersion: global?.version ?? 0, appVersion: app?.version ?? 0, defaults: { ...AUTH_POLICY_DEFAULTS }, stored, effective,
    accessPolicy: appSettings?.access_policy ?? (clientId === null ? null : 'member') };
}
export interface SaveAuthPolicyInput {
  actor: string; clientId: string | null; expectedVersion: number; patch: unknown; reason: string;
  preview?: boolean; previewToken?: string;
}
export async function saveAuthPolicy(env: Env, input: SaveAuthPolicyInput) {
  const { actor, clientId, expectedVersion } = input;
  const scope = scopeOf(clientId);
  const operator = await env.DB.prepare("SELECT 1 AS allowed FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE u.status='active' AND o.user_id=?").bind(actor).first();
  const owner = clientId === null ? null : await env.DB.prepare("SELECT 1 AS allowed FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id JOIN users u ON u.id=o.user_id WHERE o.client_id=? AND o.user_id=? AND d.status='active' AND u.status='active'").bind(clientId, actor).first();
  if (!operator && !owner) throw new AuthPolicyError(403, 'POLICY_FORBIDDEN');
  if (clientId !== null && !await env.DB.prepare('SELECT 1 FROM applications WHERE client_id=?').bind(clientId).first()) throw new AuthPolicyError(404, 'APP_NOT_FOUND');
  if (typeof input.reason !== 'string' || input.reason.trim().length < 1 || input.reason.length > 500) throw new AuthPolicyError(400, 'REASON_REQUIRED');
  if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) throw new AuthPolicyError(400, 'INVALID_POLICY');
  const patch = input.patch as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some(k => !(k in AUTH_POLICY_LIMITS) && k !== 'grantableConditions' && k !== 'accessPolicy')) throw new AuthPolicyError(400, 'INVALID_POLICY_FIELD');
  if (!operator && keys.some(k => !['leaseSeconds', 'sessionIdleSeconds', 'sessionAbsoluteSeconds'].includes(k))) throw new AuthPolicyError(403, 'POLICY_FIELD_FORBIDDEN');
  for (const [key, range] of Object.entries(AUTH_POLICY_LIMITS)) if (key in patch && (typeof patch[key] !== 'number' || !Number.isInteger(patch[key]) || patch[key] < range[0] || patch[key] > range[1])) throw new AuthPolicyError(400, 'POLICY_OUT_OF_RANGE');
  if ('grantableConditions' in patch && (clientId !== null || !Array.isArray(patch.grantableConditions) || patch.grantableConditions.some(v => v !== 'additional-roles'))) throw new AuthPolicyError(400, 'INVALID_GRANTABLE_CONDITIONS');
  if ('accessPolicy' in patch && (clientId === null || !['member', 'guest', 'admin', 'lab'].includes(String(patch.accessPolicy)))) throw new AuthPolicyError(400, 'INVALID_ACCESS_POLICY');
  const current = await resolveAuthPolicy(env, clientId);
  if (!Number.isInteger(expectedVersion) || expectedVersion !== current.policyVersion) throw new AuthPolicyError(409, 'POLICY_VERSION_CONFLICT');
  const { accessPolicy, ...settings } = patch;
  const merged = { ...current.stored, ...settings };
  const global = await resolveAuthPolicy(env, null);
  const effective = { ...(clientId === null ? AUTH_POLICY_DEFAULTS : global.effective), ...merged } as AuthPolicySettings;
  if (clientId !== null) {
    for (const key of Object.keys(AUTH_POLICY_LIMITS) as (keyof typeof AUTH_POLICY_LIMITS)[]) {
      if (key in patch && effective[key] > global.effective[key]) throw new AuthPolicyError(400, 'GLOBAL_POLICY_CAP_EXCEEDED');
      effective[key] = Math.min(effective[key], global.effective[key]);
    }
  }
  if (effective.sessionIdleSeconds > effective.sessionAbsoluteSeconds && (clientId === null || 'sessionIdleSeconds' in patch || 'sessionAbsoluteSeconds' in patch)) throw new AuthPolicyError(400, 'IDLE_EXCEEDS_ABSOLUTE');
  effective.sessionIdleSeconds = Math.min(effective.sessionIdleSeconds, effective.sessionAbsoluteSeconds);
  const patchJson = JSON.stringify(Object.fromEntries(Object.entries(patch).sort(([a], [b]) => a.localeCompare(b))));
  const now = Date.now();
  const sensitive = clientId === null || 'grantableConditions' in patch || 'accessPolicy' in patch;
  if (input.preview) {
    const previewToken = randomToken();
    await env.DB.prepare('DELETE FROM auth_policy_previews WHERE expires_at<=?').bind(now).run();
    await env.DB.prepare('INSERT INTO auth_policy_previews VALUES (?, ?, ?, ?, ?, ?)').bind(previewToken, actor, scope, expectedVersion, patchJson, now + 300000).run();
    return { ...current, effective, accessPolicy: typeof accessPolicy === 'string' ? accessPolicy : current.accessPolicy, preview: true, previewToken };
  }
  if (sensitive && !await env.DB.prepare('SELECT 1 FROM auth_policy_previews WHERE token=? AND actor=? AND scope=? AND version=? AND patch_json=? AND expires_at>?').bind(input.previewToken ?? '', actor, scope, expectedVersion, patchJson, now).first()) throw new AuthPolicyError(409, 'POLICY_PREVIEW_REQUIRED');
  const operationId = randomToken();
  const authority = operator
    ? "EXISTS(SELECT 1 FROM auth_operators o JOIN users u ON u.id=o.user_id WHERE o.user_id=? AND u.status='active')"
    : "EXISTS(SELECT 1 FROM application_owners o JOIN connect_developers d ON d.user_id=o.user_id JOIN users u ON u.id=o.user_id WHERE o.user_id=? AND o.client_id=? AND d.status='active' AND u.status='active')";
  const previewGuard = sensitive ? "EXISTS(SELECT 1 FROM auth_policy_previews WHERE token=? AND actor=? AND scope=? AND version=? AND patch_json=? AND expires_at>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER))" : '1=1';
  const bindings = [operationId, scope, actor, input.reason.trim(), JSON.stringify(current), JSON.stringify({ ...merged, accessPolicy }), now, scope, expectedVersion, actor, ...(!operator ? [clientId] : []), ...(sensitive ? [input.previewToken ?? '', actor, scope, expectedVersion, patchJson] : [])];
  const results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO auth_policy_operations(id,scope,version,actor,reason,before_json,after_json,created_at) SELECT ?,?,version+1,?,?,?,?,? FROM auth_policy_revision WHERE id=1 AND COALESCE((SELECT MAX(version) FROM auth_policy_settings WHERE scope IN ('global',?)),0)=? AND ${authority} AND ${previewGuard}`).bind(...bindings),
    env.DB.prepare('UPDATE auth_policy_revision SET version=version+1 WHERE id=1 AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)').bind(operationId),
    env.DB.prepare('INSERT INTO auth_policy_settings SELECT scope,version,?,actor,created_at FROM auth_policy_operations WHERE id=? ON CONFLICT(scope) DO UPDATE SET version=excluded.version,settings_json=excluded.settings_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(JSON.stringify(merged), operationId),
    env.DB.prepare("INSERT INTO application_settings(client_id,framework,access_policy,created_at,updated_at) SELECT ?,'other',?,?,? WHERE ? IS NOT NULL AND ? IS NOT NULL AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?) ON CONFLICT(client_id) DO UPDATE SET access_policy=excluded.access_policy,updated_at=excluded.updated_at").bind(clientId, typeof accessPolicy === 'string' ? accessPolicy : null, now, now, clientId, typeof accessPolicy === 'string' ? accessPolicy : null, operationId),
    env.DB.prepare(`UPDATE access_tokens SET expires_at=MIN(expires_at,created_at+1000*MIN(
      COALESCE((SELECT json_extract(settings_json,'$.accessTokenSeconds') FROM auth_policy_settings WHERE scope='global'),3600),
      COALESCE((SELECT json_extract(settings_json,'$.accessTokenSeconds') FROM auth_policy_settings WHERE scope='app:'||access_tokens.client_id),3600)))
      WHERE (? IS NULL OR client_id=?) AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)`).bind(clientId,clientId,operationId),
    env.DB.prepare(`UPDATE server_sessions SET
      idle_seconds=MIN(idle_seconds,COALESCE((SELECT json_extract(settings_json,'$.sessionIdleSeconds') FROM auth_policy_settings WHERE scope='global'),864000),COALESCE((SELECT json_extract(settings_json,'$.sessionIdleSeconds') FROM auth_policy_settings WHERE scope='app:'||server_sessions.client_id),864000)),
      absolute_seconds=MIN(absolute_seconds,COALESCE((SELECT json_extract(settings_json,'$.sessionAbsoluteSeconds') FROM auth_policy_settings WHERE scope='global'),2592000),COALESCE((SELECT json_extract(settings_json,'$.sessionAbsoluteSeconds') FROM auth_policy_settings WHERE scope='app:'||server_sessions.client_id),2592000))
      WHERE (? IS NULL OR client_id=?) AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)`).bind(clientId,clientId,operationId),
    env.DB.prepare(`UPDATE server_sessions SET idle_expires_at=MIN(idle_expires_at,last_used_at+idle_seconds*1000,created_at+absolute_seconds*1000),
      absolute_expires_at=MIN(absolute_expires_at,created_at+absolute_seconds*1000)
      WHERE (? IS NULL OR client_id=?) AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)`).bind(clientId,clientId,operationId),
    env.DB.prepare(`UPDATE server_sessions SET lease_until=MIN(lease_until,idle_expires_at,absolute_expires_at)
      WHERE (? IS NULL OR client_id=?) AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)`).bind(clientId,clientId,operationId),
    env.DB.prepare('DELETE FROM auth_policy_previews WHERE token=? AND EXISTS(SELECT 1 FROM auth_policy_operations WHERE id=?)').bind(input.previewToken ?? '', operationId),
  ]);
  if (results[0].meta.changes !== 1) throw new AuthPolicyError(409, 'POLICY_VERSION_CONFLICT');
  const control=clientId===null&&env.GATE_CONTROL_SIGNING_JWK&&env.GATE_CONTROL_KID
    ? await publishPendingControl(env) : clientId!==null ? await deliverControl(env,clientId) : {published:0,failed:0};
  return { ...await resolveAuthPolicy(env, clientId), preview: false, operationId, control };
}
