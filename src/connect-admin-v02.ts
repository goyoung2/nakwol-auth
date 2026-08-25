import type { Context, Hono } from 'hono';
import developerAdminSource from './assets/nakwol-connect-developers.js.txt';
import { authenticateAccessToken, getUserWithMembership, logAuthEvent } from './store';
import { canManageDeveloperRoles, type ConnectRole } from './connect-permissions';
import type { Env } from './types';

const ADMIN_CLIENT_ID = 'nakwol-connect-admin';

function jsResponse(source: string): Response {
  return new Response(source, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function bearer(c: Context<{ Bindings: Env }>): string | null {
  return (c.req.header('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || null;
}

async function identity(c: Context<{ Bindings: Env }>) {
  const token = bearer(c);
  if (!token) return null;
  const userId = await authenticateAccessToken(c.env, token, ADMIN_CLIENT_ID);
  if (!userId) return null;
  const user = await getUserWithMembership(c.env, userId);
  if (!user) return null;
  const row = await c.env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id=?`).bind(userId).first<{ role: string }>();
  const role: ConnectRole = row?.role === 'owner' || row?.role === 'operator' || row?.role === 'developer' ? row.role : null;
  return { userId, user, role };
}

async function manager(c: Context<{ Bindings: Env }>) {
  const current = await identity(c);
  if (!current) return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'NAKWOL 로그인이 필요합니다.' } }, 401);
  if (!canManageDeveloperRoles(current.role, current.user.membership?.role)) {
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: '개발자 권한을 관리할 수 없습니다.' } }, 403);
  }
  return current;
}

function page(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAKWOL Connect · Developers</title><style>
:root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#e5e7eb;background:#080c14}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 10% 0,#17213a,#080c14 38%);min-height:100vh}header{height:70px;padding:0 22px;border-bottom:1px solid #263244;display:flex;align-items:center;justify-content:space-between;background:#080c14dd}a{color:#c7d2fe;text-decoration:none}main{max-width:1000px;margin:0 auto;padding:26px}.card{background:#111827;border:1px solid #263244;border-radius:16px;padding:20px;margin-bottom:16px}h1,h2{margin-top:0}.muted{color:#94a3b8}.row{display:flex;gap:9px;align-items:center;flex-wrap:wrap}input{flex:1;min-width:220px;background:#0b1220;color:#fff;border:1px solid #334155;border-radius:10px;padding:10px}button{border:0;border-radius:9px;padding:9px 12px;font-weight:700;cursor:pointer;background:#4f46e5;color:#fff}.ghost{background:#263244}.danger{background:#4c1d2d}.person{display:grid;grid-template-columns:1fr auto;gap:8px;padding:12px 0;border-bottom:1px solid #1f2937}.person:last-child{border-bottom:0}.meta{color:#94a3b8;font-size:12px;margin-top:3px}.badge{display:inline-block;border-radius:999px;padding:2px 7px;background:#263244;font-size:11px}.ok{color:#86efac}.bad{color:#fca5a5}</style></head><body><header><strong>落月 · NAKWOL Connect Developers</strong><nav><a href="/admin/apps">앱 관리</a></nav></header><main><section class="card"><h1>CLI 개발자 권한</h1><p class="muted">developer는 현재 낙월 맹원인 동안 자기 소유 앱만 CLI로 생성·수정할 수 있습니다. owner/operator/Discord admin은 전체 앱을 관리합니다.</p><div id="session">로그인 확인 중…</div></section><section id="manager" class="card" hidden><div class="row"><input id="query" placeholder="NAKWOL ID 또는 Discord 표시명 검색"><button id="search">검색</button></div><div id="people" style="margin-top:14px"></div></section></main><script type="module" src="/admin/developers/app.js"></script></body></html>`;
}

export function registerConnectAdminV02Routes(app: Hono<{ Bindings: Env }>): void {
  // Compatibility guard: v0.1 considered any auth_operators row a manager. A v0.2
  // developer row must never inherit those broad admin APIs.
  app.use('/admin/api/*', async (c, next) => {
    const current = await identity(c);
    if (!current || current.role !== 'developer' || current.user.membership?.role === 'admin') return next();
    if (new URL(c.req.url).pathname === '/admin/api/session') {
      const operators = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM auth_operators WHERE role IN ('owner','operator')`).first<{ count: number }>();
      return c.json({ ok: true, data: {
        user: current.user,
        operator_role: 'developer',
        operator_count: Number(operators?.count || 0),
        can_manage: false,
        bootstrap_available: false,
      } });
    }
    return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'developer는 전체 관리자 API를 사용할 수 없습니다.' } }, 403);
  });

  app.get('/admin/developers', (c) => c.html(page()));
  app.get('/admin/developers/app.js', () => jsResponse(developerAdminSource));

  app.get('/admin/api/developers', async (c) => {
    const current = await manager(c);
    if (current instanceof Response) return current;
    const q = (c.req.query('q') || '').trim();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const result = await c.env.DB.prepare(
      `SELECT u.id,u.display_name,u.status,
              m.role AS membership_role,m.status AS membership_status,
              o.role AS connect_role
         FROM users u
         LEFT JOIN memberships m ON m.user_id=u.id AND m.guild_id=?
         LEFT JOIN auth_operators o ON o.user_id=u.id
        WHERE u.status='active' AND (?='' OR u.display_name LIKE ? OR u.id LIKE ?)
        ORDER BY CASE WHEN o.role IS NULL THEN 1 ELSE 0 END,u.display_name ASC
        LIMIT 40`
    ).bind(c.env.NAKWOL_GUILD_ID, q, like, like).all();
    return c.json({ ok: true, data: result.results || [] });
  });

  app.put('/admin/api/developers/:userId', async (c) => {
    const current = await manager(c);
    if (current instanceof Response) return current;
    const userId = c.req.param('userId');
    const target = await c.env.DB.prepare(
      `SELECT u.id,u.status,m.role AS membership_role,m.status AS membership_status,o.role AS connect_role
         FROM users u
         LEFT JOIN memberships m ON m.user_id=u.id AND m.guild_id=?
         LEFT JOIN auth_operators o ON o.user_id=u.id
        WHERE u.id=?`
    ).bind(c.env.NAKWOL_GUILD_ID, userId).first<any>();
    if (!target || target.status !== 'active') return c.json({ ok: false, error: { code: 'USER_NOT_FOUND', message: '활성 사용자를 찾을 수 없습니다.' } }, 404);
    if (!['member','admin'].includes(target.membership_role) || target.membership_status !== 'active') {
      return c.json({ ok: false, error: { code: 'MEMBER_REQUIRED', message: '현재 낙월 맹원에게만 developer 권한을 줄 수 있습니다.' } }, 403);
    }
    if (target.connect_role === 'owner' || target.connect_role === 'operator') {
      return c.json({ ok: false, error: { code: 'OPERATOR_EXISTS', message: '이미 상위 Connect 운영 권한이 있습니다.' } }, 409);
    }
    await c.env.DB.prepare(
      `INSERT INTO auth_operators(user_id,role,created_at,created_by_user_id) VALUES (?,'developer',?,?)
       ON CONFLICT(user_id) DO UPDATE SET role='developer',created_by_user_id=excluded.created_by_user_id`
    ).bind(userId, Date.now(), current.userId).run();
    await logAuthEvent(c.env, 'connect.developer.granted', userId, ADMIN_CLIENT_ID, { by: current.userId });
    return c.json({ ok: true, data: { user_id: userId, role: 'developer' } });
  });

  app.delete('/admin/api/developers/:userId', async (c) => {
    const current = await manager(c);
    if (current instanceof Response) return current;
    const userId = c.req.param('userId');
    const row = await c.env.DB.prepare(`SELECT role FROM auth_operators WHERE user_id=?`).bind(userId).first<{ role: string }>();
    if (row?.role !== 'developer') return c.json({ ok: false, error: { code: 'NOT_DEVELOPER', message: 'developer 권한이 없는 사용자입니다.' } }, 409);
    const now = Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM auth_operators WHERE user_id=? AND role='developer'`).bind(userId),
      c.env.DB.prepare(`UPDATE connect_cli_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL`).bind(now, userId),
    ]);
    await logAuthEvent(c.env, 'connect.developer.revoked', userId, ADMIN_CLIENT_ID, { by: current.userId });
    return c.json({ ok: true });
  });
}
