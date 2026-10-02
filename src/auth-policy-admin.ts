import type { Hono, Context } from 'hono';
import type { Env } from './types';
import { resolveAuthPolicy, saveAuthPolicy } from './auth-policy-settings';
import { authenticateServiceActor, requireManagementMutation } from './service-management-auth';
import { ServiceManagementError } from './service-management-types';
import { managementResponse } from './service-management-routes';

export function registerAuthPolicyAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  const read = (c: Context<{ Bindings: Env }>) => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c);
    if (!actor.isOperator) throw new ServiceManagementError('FORBIDDEN', 403);
    return resolveAuthPolicy(c.env, c.req.param('clientId') || null);
  });
  const write = (preview: boolean) => (c: Context<{ Bindings: Env }>) => managementResponse(c, async () => {
    const actor = await authenticateServiceActor(c);
    if (!actor.isOperator) throw new ServiceManagementError('FORBIDDEN', 403);
    const clientId = c.req.param('clientId') || null;
    const body = await requireManagementMutation(c, actor, clientId ? `app:${clientId}` : 'global');
    for (const key of Object.keys(body)) if (!['expectedVersion', 'patch', 'reason', 'previewToken'].includes(key)) throw new ServiceManagementError('INVALID_BODY', 400);
    return saveAuthPolicy(c.env, { actor: actor.userId, clientId, expectedVersion: Number(body.expectedVersion), patch: body.patch, reason: String(body.reason), preview, previewToken: typeof body.previewToken === 'string' ? body.previewToken : undefined });
  });
  for (const path of ['/admin/api/auth-policy', '/admin/api/auth-policy/:clientId']) {
    app.get(path, read); app.put(path, write(false)); app.post(`${path}/preview`, write(true));
  }
}
