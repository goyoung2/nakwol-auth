import type { Hono, Context } from 'hono';
import type { Env } from './types';
import { resolveAuthPolicy, saveAuthPolicy, AuthPolicyError } from './auth-policy-settings';
import { authenticateServiceActor, requireServiceOwner, requireAppTarget, getServiceCapabilities, requireManagementMutation } from './service-management-auth';
import { ServiceManagementError } from './service-management-types';

export async function managementResponse(c: Context<{ Bindings: Env }>, action: () => Promise<unknown>): Promise<Response> {
  c.header('Cache-Control', 'no-store');
  try { return c.json({ data: await action() }); }
  catch (error) {
    if (error instanceof ServiceManagementError || error instanceof AuthPolicyError) {
      const status = error.status;
      if (status === 400 || status === 401 || status === 403 || status === 404 || status === 409 || status === 413 || status === 429) return c.json({ error: { code: error.code } }, status);
    }
    throw error;
  }
}

export function registerServiceManagementRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/developer/v1/apps', c => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c);
    const rows = await c.env.DB.prepare(`SELECT a.client_id,a.name FROM applications a WHERE
      EXISTS(SELECT 1 FROM auth_operators WHERE user_id=?) OR EXISTS(SELECT 1 FROM application_owners o
      JOIN connect_developers d ON d.user_id=o.user_id WHERE o.client_id=a.client_id AND o.user_id=? AND d.status='active') ORDER BY a.client_id LIMIT 200`).bind(actor.userId, actor.userId).all();
    return { apps: rows.results, limit: 200, isOperator: actor.isOperator };
  }));
  app.get('/developer/v1/apps/:clientId/capabilities', c => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c);
    const clientId = c.req.param('clientId');
    await requireServiceOwner(c.env, actor, clientId);
    await requireAppTarget(c.env, clientId, c.req.query());
    return getServiceCapabilities(c.env, actor, clientId);
  }));
  app.get('/developer/v1/apps/:clientId/policy', c => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c), clientId = c.req.param('clientId') || '';
    await requireServiceOwner(c.env, actor, clientId);
    await requireAppTarget(c.env, clientId, c.req.query());
    return resolveAuthPolicy(c.env, clientId);
  }));
  const mutation = (preview: boolean) => (c: Context<{ Bindings: Env }>) => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c), clientId = c.req.param('clientId') || '';
    await requireServiceOwner(c.env, actor, clientId);
    await requireAppTarget(c.env, clientId, c.req.query());
    const body = await requireManagementMutation(c, actor, `app:${clientId}`);
    for (const key of Object.keys(body)) if (!['expectedVersion', 'patch', 'reason', 'previewToken', 'clientId'].includes(key)) throw new ServiceManagementError('INVALID_BODY', 400);
    await requireAppTarget(c.env, clientId, body);
    return saveAuthPolicy(c.env, { actor: actor.userId, clientId, expectedVersion: Number(body.expectedVersion), patch: body.patch, reason: String(body.reason), preview, previewToken: typeof body.previewToken === 'string' ? body.previewToken : undefined });
  });
  app.put('/developer/v1/apps/:clientId/policy', mutation(false));
  app.post('/developer/v1/apps/:clientId/policy/preview', mutation(true));
  app.get('/developer/v1/apps/:clientId/operations/:operationId', c => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c), clientId = c.req.param('clientId'), operationId = c.req.param('operationId');
    await requireServiceOwner(c.env, actor, clientId);
    await requireAppTarget(c.env, clientId, { ...c.req.query(), operationId });
    return c.env.DB.prepare('SELECT id AS operationId, version AS policyVersion, created_at AS createdAt, delivery_status AS deliveryStatus FROM auth_policy_operations WHERE id=? AND scope=?').bind(operationId, `app:${clientId}`).first();
  }));
}
