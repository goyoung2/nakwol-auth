import type { Context, Hono } from 'hono';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import type { Env } from './types';

const ADMIN_CLIENT_ID = 'nakwol-connect-admin';

export function canRequestAccessPolicy(isOperator: boolean, policy: string): boolean {
  return policy === 'public' || policy === 'member' || (isOperator && policy === 'admin');
}

export function canManageOwnedApplication(input: {
  isOperator: boolean;
  userId: string;
  ownerUserIds: string[];
}): boolean {
  return input.isOperator || input.ownerUserIds.includes(input.userId);
}

export function nextAvailableClientId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header('Authorization') || '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function requireOperator(c: Context<{ Bindings: Env }>): Promise<{ userId: string } | Response> {
  const raw = bearer(c);
  if (!raw) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, 401);
  const userId = await authenticateAccessToken(c.env, raw, ADMIN_CLIENT_ID);
  if (!userId) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: '유효하지 않은 로그인입니다.' } }, 401);
  const [operator, user] = await Promise.all([
    c.env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id = ?`).bind(userId).first<{ role: string }>(),
    getUserWithMembership(c.env, userId),
  ]);
  if (!operator && user?.membership?.role !== 'admin') {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'NAKWOL Connect 운영 권한이 필요합니다.' } }, 403);
  }
  return { userId };
}

export function registerConnectDeveloperAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/admin/api/developers', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const result = await c.env.DB.prepare(
      `SELECT u.id AS user_id, u.display_name, u.avatar_url,
              COALESCE(cd.role, CASE WHEN ao.user_id IS NOT NULL THEN 'operator' ELSE NULL END) AS developer_role,
              COALESCE(cd.status, CASE WHEN ao.user_id IS NOT NULL THEN 'active' ELSE NULL END) AS developer_status,
              COUNT(DISTINCT ow.client_id) AS owned_app_count
         FROM users u
         LEFT JOIN connect_developers cd ON cd.user_id = u.id
         LEFT JOIN auth_operators ao ON ao.user_id = u.id
         LEFT JOIN application_owners ow ON ow.user_id = u.id
        GROUP BY u.id, u.display_name, u.avatar_url, cd.role, cd.status, ao.user_id
        ORDER BY CASE WHEN ao.user_id IS NOT NULL OR cd.role = 'operator' THEN 0 WHEN cd.role = 'developer' THEN 1 ELSE 2 END,
                 u.display_name ASC`
    ).all();
    return c.json({ ok: true, data: result.results || [] });
  });

  app.post('/admin/api/developers', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const body: { user_id?: string; role?: string } = await c.req.json().catch(() => ({} as { user_id?: string; role?: string }));
    const userId = String(body.user_id || '').trim();
    const role = body.role === 'operator' ? 'operator' : 'developer';
    if (!userId || !await getUserWithMembership(c.env, userId)) {
      return c.json({ ok: false, error: { code: 'USER_NOT_FOUND', message: 'NAKWOL 사용자를 찾을 수 없습니다.' } }, 404);
    }
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO connect_developers(user_id, role, status, created_at, updated_at, created_by_user_id)
       VALUES (?, ?, 'active', ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, status = 'active', updated_at = excluded.updated_at`
    ).bind(userId, role, now, now, identity.userId).run();
    await logAuthEvent(c.env, 'connect.developer.granted', identity.userId, null, { user_id: userId, role });
    return c.json({ ok: true });
  });

  app.patch('/admin/api/developers/:userId', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const target = c.req.param('userId');
    const body: { status?: string; role?: string } = await c.req.json().catch(() => ({} as { status?: string; role?: string }));
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    const role = body.role === 'operator' ? 'operator' : 'developer';
    const result = await c.env.DB.prepare(
      `UPDATE connect_developers SET role = ?, status = ?, updated_at = ? WHERE user_id = ?`
    ).bind(role, status, Date.now(), target).run();
    if (Number(result.meta?.changes ?? 0) < 1) return c.json({ ok: false, error: { code: 'DEVELOPER_NOT_FOUND', message: '개발자 등록을 찾을 수 없습니다.' } }, 404);
    await logAuthEvent(c.env, 'connect.developer.updated', identity.userId, null, { user_id: target, role, status });
    return c.json({ ok: true });
  });

  app.post('/admin/api/apps/:clientId/owners', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    const clientId = c.req.param('clientId');
    const body: { user_id?: string } = await c.req.json().catch(() => ({} as { user_id?: string }));
    const target = String(body.user_id || '').trim();
    if (!target) return c.json({ ok: false, error: { code: 'USER_ID_REQUIRED', message: 'user_id가 필요합니다.' } }, 400);
    const [appRow, developer] = await Promise.all([
      c.env.DB.prepare(`SELECT client_id FROM applications WHERE client_id = ?`).bind(clientId).first(),
      c.env.DB.prepare(`SELECT status FROM connect_developers WHERE user_id = ?`).bind(target).first<{ status: string }>(),
    ]);
    if (!appRow) return c.json({ ok: false, error: { code: 'APP_NOT_FOUND', message: '앱을 찾을 수 없습니다.' } }, 404);
    if (developer?.status !== 'active' && !await c.env.DB.prepare(`SELECT user_id FROM auth_operators WHERE user_id = ?`).bind(target).first()) {
      return c.json({ ok: false, error: { code: 'DEVELOPER_REQUIRED', message: '활성 개발자에게만 앱을 할당할 수 있습니다.' } }, 400);
    }
    await c.env.DB.prepare(
      `INSERT INTO application_owners(client_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)
       ON CONFLICT(client_id, user_id) DO NOTHING`
    ).bind(clientId, target, Date.now()).run();
    await logAuthEvent(c.env, 'connect.app.owner.assigned', identity.userId, clientId, { user_id: target });
    return c.json({ ok: true });
  });
}
