import type { Context, Hono } from 'hono';
import { requirePrincipal } from './connect-cli-apps';
import { authenticateAccessToken, logAuthEvent } from './store';
import { getApplicationQualificationRequirement, parseQualificationIds, parseQualificationMatchMode, QualificationSettingsError } from './qualifications';
import type { Env } from './types';

type Identity = { readonly userId: string; readonly isOperator: boolean };
type Qualification = { readonly id: string; readonly name: string; readonly role_id: string; readonly status: string; readonly developer_selectable: number };
type App = { readonly client_id: string; readonly name: string; readonly access_policy: string };

const mutationAccessSql = `EXISTS(SELECT 1 FROM users u LEFT JOIN connect_developers d ON d.user_id=u.id
  WHERE u.id=? AND u.status='active' AND (
    EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id)
    OR (d.status='active' AND d.role='operator')
    OR (d.status='active' AND d.role='developer' AND EXISTS(
      SELECT 1 FROM application_owners a WHERE a.user_id=u.id AND a.client_id=?))))`;

async function identity(c: Context<{ Bindings: Env }>, cli: boolean): Promise<Identity | Response> {
  let userId: string | null;
  if (cli) {
    const principal = await requirePrincipal(c);
    if (principal instanceof Response) return principal;
    userId = principal.userId;
  } else {
    const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    userId = token ? await authenticateAccessToken(c.env, token, 'nakwol-connect-admin') : null;
  }
  if (!userId) return c.json({ ok: false, error: { code: 'UNAUTHORIZED' } }, 401);
  const row = await c.env.DB.prepare(`SELECT d.role, d.status,
      EXISTS(SELECT 1 FROM auth_operators o WHERE o.user_id=u.id) AS operator
    FROM users u LEFT JOIN connect_developers d ON d.user_id=u.id
    WHERE u.id=? AND u.status='active'`).bind(userId).first<{ role: string | null; status: string | null; operator: number }>();
  const isOperator = Boolean(row?.operator) || (row?.status === 'active' && row.role === 'operator');
  if (!row || (!isOperator && !(row.status === 'active' && row.role === 'developer'))) {
    return c.json({ ok: false, error: { code: 'DEVELOPER_REQUIRED' } }, 403);
  }
  return { userId, isOperator };
}

async function allowedQualifications(env: Env, user: Identity): Promise<readonly Qualification[]> {
  const result = await env.DB.prepare(`SELECT id,name,role_id,status,developer_selectable FROM membership_qualifications
    WHERE status='active' AND (?=1 OR developer_selectable=1) ORDER BY name,id`).bind(user.isOperator ? 1 : 0).all<Qualification>();
  return result.results;
}

async function ownedApp(c: Context<{ Bindings: Env }>, user: Identity, clientId: string): Promise<App | Response> {
  if (!user.isOperator) {
    const owner = await c.env.DB.prepare('SELECT user_id FROM application_owners WHERE client_id=? AND user_id=?').bind(clientId, user.userId).first();
    if (!owner) return c.json({ ok: false, error: { code: 'APP_OWNERSHIP_REQUIRED' } }, 403);
  }
  const row = await c.env.DB.prepare(`SELECT a.client_id,a.name,COALESCE(s.access_policy,'member') AS access_policy
    FROM applications a LEFT JOIN application_settings s ON s.client_id=a.client_id WHERE a.client_id=?`).bind(clientId).first<App>();
  return row ?? c.json({ ok: false, error: { code: 'APP_NOT_FOUND' } }, 404);
}

export function registerDeveloperQualificationRoutes(app: Hono<{ Bindings: Env }>): void {
  for (const [base, cli] of [['/connect/developer/api', false], ['/connect/cli', true]] as const) {
    for (const path of [`${base}/qualifications`, `${base}/apps/:clientId/qualification-policy`, ...(!cli ? [`${base}/apps`] : [])]) {
      app.use(path, async (c, next) => { c.header('Cache-Control', 'no-store'); await next(); });
    }
    if (!cli) app.get(`${base}/apps`, async c => {
      const user = await identity(c, cli);
      if (user instanceof Response) return user;
      const result = await c.env.DB.prepare(`SELECT a.client_id,a.name,COALESCE(s.access_policy,'member') AS access_policy
        FROM applications a LEFT JOIN application_settings s ON s.client_id=a.client_id
        WHERE ?=1 OR EXISTS(SELECT 1 FROM application_owners o WHERE o.client_id=a.client_id AND o.user_id=?)
        ORDER BY a.name,a.client_id`).bind(user.isOperator ? 1 : 0, user.userId).all<App>();
      return c.json({ ok: true, data: result.results });
    });
    app.get(`${base}/qualifications`, async c => {
      const user = await identity(c, cli);
      if (user instanceof Response) return user;
      return c.json({ ok: true, qualifications: await allowedQualifications(c.env, user) });
    });
    app.get(`${base}/apps/:clientId/qualification-policy`, async c => {
      const user = await identity(c, cli);
      if (user instanceof Response) return user;
      const clientId = c.req.param('clientId');
      const access = await ownedApp(c, user, clientId);
      if (access instanceof Response) return access;
      const policy = await getApplicationQualificationRequirement(c.env, clientId);
      const allowed = new Set((await allowedQualifications(c.env, user)).map(q => q.id));
      return c.json({ ok: true, policy: policy ? { mode: 'custom', ...policy } : { mode: 'legacy' },
        locked_qualification_ids: policy?.qualification_ids.filter(id => !allowed.has(id)) ?? [] });
    });
    app.put(`${base}/apps/:clientId/qualification-policy`, async c => {
      const user = await identity(c, cli);
      if (user instanceof Response) return user;
      const origin = c.req.header('Origin');
      if ((!cli || origin !== undefined) && origin !== new URL(c.env.AUTH_ORIGIN).origin) return c.json({ ok: false, error: { code: 'INVALID_ORIGIN' } }, 403);
      if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ ok: false, error: { code: 'JSON_REQUIRED' } }, 415);
      const clientId = c.req.param('clientId');
      const access = await ownedApp(c, user, clientId);
      if (access instanceof Response) return access;
      let body: unknown;
      try { body = await c.req.json(); }
      catch (error) { if (error instanceof SyntaxError) return c.json({ ok: false, error: { code: 'INVALID_JSON' } }, 400); throw error; }
      if (!body || typeof body !== 'object' || !('mode' in body) || (body.mode !== 'legacy' && body.mode !== 'custom')) return c.json({ ok: false, error: { code: 'INVALID_QUALIFICATION_SETTINGS' } }, 400);
      let policy: { readonly mode: 'legacy' } | { readonly mode: 'custom'; readonly match_mode: 'any' | 'all'; readonly qualification_ids: readonly string[] };
      try {
        if (body.mode === 'legacy') {
          const deleted = await c.env.DB.prepare(`DELETE FROM application_qualification_requirements WHERE client_id=? AND ${mutationAccessSql}`)
            .bind(clientId, user.userId, clientId).run();
          if (deleted.meta.changes === 0) {
            const currentUser = await identity(c, cli);
            if (currentUser instanceof Response) return currentUser;
            const currentAccess = await ownedApp(c, currentUser, clientId);
            if (currentAccess instanceof Response) return currentAccess;
          }
          policy = { mode: 'legacy' };
        } else {
          if (access.access_policy !== 'member') return c.json({ ok: false, error: { code: 'MEMBER_POLICY_REQUIRED' } }, 400);
          const ids = parseQualificationIds('qualification_ids' in body ? body.qualification_ids : null);
          const matchMode = parseQualificationMatchMode('match_mode' in body ? body.match_mode : null);
          const allowed = new Set((await allowedQualifications(c.env, user)).map(q => q.id));
          if (ids.some(id => !allowed.has(id))) return c.json({ ok: false, error: { code: 'QUALIFICATION_NOT_SELECTABLE', message: '개발자에게 공개된 사용 중인 자격만 선택할 수 있습니다.' } }, 400);
          const saved = await c.env.DB.prepare(`INSERT INTO application_qualification_requirements(client_id,match_mode,qualification_ids,updated_at)
            SELECT ?,?,?,? WHERE ${mutationAccessSql} AND (SELECT COUNT(*) FROM membership_qualifications
              WHERE id IN (SELECT value FROM json_each(?)) AND status='active' AND (developer_selectable=1
                OR EXISTS(SELECT 1 FROM auth_operators WHERE user_id=?)
                OR EXISTS(SELECT 1 FROM connect_developers WHERE user_id=? AND role='operator' AND status='active')))=?
            ON CONFLICT(client_id) DO UPDATE SET match_mode=excluded.match_mode,qualification_ids=excluded.qualification_ids,updated_at=excluded.updated_at`)
            .bind(clientId, matchMode, JSON.stringify(ids), Date.now(), user.userId, clientId, JSON.stringify(ids), user.userId, user.userId, ids.length).run();
          if (saved.meta.changes !== 1) {
            const currentUser = await identity(c, cli);
            if (currentUser instanceof Response) return currentUser;
            const currentAccess = await ownedApp(c, currentUser, clientId);
            if (currentAccess instanceof Response) return currentAccess;
            return c.json({ ok: false, error: { code: 'QUALIFICATION_SELECTION_CHANGED', message: '선택 가능한 자격이 변경되었습니다. 새로고침 후 다시 선택하세요.' } }, 409);
          }
          policy = { mode: 'custom', match_mode: matchMode, qualification_ids: ids };
        }
      } catch (error) {
        if (error instanceof QualificationSettingsError) return c.json({ ok: false, error: { code: error.code, message: error.message } }, 400);
        if (error instanceof Error && /\bMEMBER_POLICY_REQUIRED\b/.test(error.message)) return c.json({ ok: false, error: { code: 'MEMBER_POLICY_REQUIRED' } }, 409);
        throw error;
      }
      await logAuthEvent(c.env, 'application.qualifications.updated', user.userId, clientId, { ...policy, surface: cli ? 'cli' : 'developer' });
      return c.json({ ok: true, policy });
    });
  }
}
