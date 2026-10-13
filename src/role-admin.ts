import type { Context, Hono } from 'hono';
import { authenticateAccessToken, logAuthEvent } from './store';
import { getRequiredRoleIds, parseRequiredRoleIds, RoleSettingsError } from './role-settings';
import type { Env } from './types';
import { getApplicationQualificationRequirement, parseQualificationIds, parseQualificationMatchMode, QualificationSettingsError } from './qualifications';

type Role = { readonly id: string; readonly name: string };
class RoleCatalogError extends Error {}

async function requireOperator(c: Context<{ Bindings: Env }>): Promise<{ userId: string } | Response> {
  const token = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  const userId = await authenticateAccessToken(c.env, token, 'nakwol-connect-admin');
  if (!userId) return c.json({ error: { code: 'UNAUTHORIZED' } }, 401);
  const operator = await c.env.DB.prepare("SELECT ao.role FROM auth_operators ao JOIN users u ON u.id = ao.user_id WHERE ao.user_id = ? AND u.status = 'active'").bind(userId).first();
  if (!operator) return c.json({ error: { code: 'FORBIDDEN' } }, 403);
  return { userId };
}

export async function fetchRoleCatalog(env: Env): Promise<readonly Role[]> {
  const botToken = env.DISCORD_BOT_TOKEN2 || env.DISCORD_BOT_TOKEN;
  if (!botToken || !/^[0-9]{17,20}$/.test(env.NAKWOL_GUILD_ID)) throw new RoleCatalogError('Discord 봇 토큰과 서버 설정이 필요합니다.');
  let data: unknown;
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${env.NAKWOL_GUILD_ID}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new RoleCatalogError('Discord 역할 목록을 불러오지 못했습니다.');
    data = await response.json();
  } catch (error) {
    if (error instanceof RoleCatalogError) throw error;
    throw new RoleCatalogError('Discord 역할 목록을 불러오지 못했습니다.');
  }
  if (!Array.isArray(data)) throw new RoleCatalogError('Discord 역할 응답이 올바르지 않습니다.');
  const roles: Role[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null || typeof item.id !== 'string' || !/^[0-9]{17,20}$/.test(item.id) || typeof item.name !== 'string') throw new RoleCatalogError('Discord 역할 응답이 올바르지 않습니다.');
    // @everyone is the guild ID, not an explicit member role.
    if (item.id !== env.NAKWOL_GUILD_ID) roles.push({ id: item.id, name: item.name });
  }
  return roles;
}

function legacyRolePage(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAKWOL · 역할 관리</title>
<style>:root{font-family:system-ui,sans-serif;color:#e5e7eb;background:#080c14}body{max-width:960px;margin:auto;padding:24px}a{color:#c7d2fe}section{background:#111827;border:1px solid #263244;border-radius:12px;padding:20px;margin:18px 0}button{padding:9px 15px;cursor:pointer}label{display:block;padding:6px}small{color:#94a3b8}#status{white-space:pre-wrap}</style></head><body>
<nav><a href="/admin/roles">멤버 자격 관리</a> · <a href="/admin/apps">← 앱 관리</a></nav><h1>기존 시즌3 추가 역할 관리</h1>
<p>멤버 사이트는 시즌3 역할이 반드시 필요합니다. 추가로 선택한 세부 역할도 모두 보유해야 입장할 수 있습니다. AUTH 운영 권한은 멤버 입장 권한을 대신하지 않습니다.</p>
<p id="season"></p><button id="login">운영자 로그인</button> <button id="reload">역할 새로고침</button><p id="status" role="status"></p><main id="apps"></main>
<script type="module">
import { NakwolAuthClient } from '/sdk/v0.3.3/nakwol-auth-web.js';
const auth=new NakwolAuthClient({clientId:'nakwol-connect-admin',redirectUri:location.origin+'/admin/apps',authOrigin:location.origin});
const status=document.querySelector('#status'), apps=document.querySelector('#apps');
async function api(options={}){const headers=new Headers({'Authorization':'Bearer '+(auth.getAccessToken()||'')});if(options.body)headers.set('Content-Type','application/json');const r=await fetch('/admin/api/roles',{...options,headers});const p=await r.json();if(!r.ok)throw new Error(p.error?.message||p.error?.code||'요청 실패');return p;}
async function load(){status.textContent='불러오는 중…';apps.replaceChildren();try{const data=await api();document.querySelector('#season').textContent='필수 시즌3 역할: '+data.season_role.name+' ('+data.season_role.id+')';for(const app of data.applications){const card=document.createElement('section'),title=document.createElement('h2'),hint=document.createElement('small');title.textContent=app.name;hint.textContent=app.client_id+' · '+app.access_policy+(app.qualification_policy?' · 사용자 지정 자격 사용 중: 앱 관리에서 수정하세요.':' · 기존 시즌3 조건');card.append(title,hint);const checked=new Set(app.required_role_ids);for(const role of data.roles){if(role.id===data.season_role.id)continue;const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=checked.has(role.id);input.disabled=app.access_policy!=='member'||Boolean(app.qualification_policy);input.onchange=()=>input.checked?checked.add(role.id):checked.delete(role.id);label.append(input,document.createTextNode(' '+role.name+' ('+role.id+')'));card.append(label);}const missing=app.required_role_ids.filter(id=>id!==data.season_role.id&&!data.roles.some(role=>role.id===id));for(const id of missing){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.disabled=app.access_policy!=='member'||Boolean(app.qualification_policy);input.onchange=()=>input.checked?checked.add(id):checked.delete(id);label.append(input,document.createTextNode(' 목록에서 확인하지 못한 역할 ('+id+')'));card.append(label);}const manualLabel=document.createElement('label'),manual=document.createElement('input');manual.type='text';manual.placeholder='추가 역할 ID (쉼표로 구분)';manual.disabled=app.access_policy!=='member'||Boolean(app.qualification_policy);manualLabel.append(document.createTextNode('역할 ID 직접 입력 '),manual);card.append(manualLabel);const confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.type='checkbox';confirm.disabled=app.access_policy!=='member'||Boolean(app.qualification_policy);confirmLabel.append(confirm,document.createTextNode('역할 목록 조회 실패 시 직접 확인한 ID로 저장합니다. 잘못된 ID는 접근을 차단할 수 있습니다.'));card.append(confirmLabel);const save=document.createElement('button');save.textContent='요구 역할 저장';save.disabled=app.access_policy!=='member'||Boolean(app.qualification_policy);save.onclick=async()=>{save.disabled=true;try{await api({method:'POST',body:JSON.stringify({client_id:app.client_id,role_ids:[...new Set([...checked,...manual.value.split(',').map(id=>id.trim()).filter(Boolean)])].filter(id=>id!==data.season_role.id),manual_role_ids:confirm.checked})});status.textContent=app.name+' 역할 조건을 저장했습니다.';}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};card.append(save);apps.append(card);}status.textContent=data.catalog_warning?data.catalog_warning+' 기존 조건은 유지됩니다. Discord 개발자 모드에서 역할 ID를 복사해 직접 입력할 수 있습니다.':'현재 Discord 역할을 불러왔습니다.';}catch(e){status.textContent=e.message;}}
document.querySelector('#login').onclick=()=>auth.login();document.querySelector('#reload').onclick=load;
try{const user=await auth.bootstrap();if(user)await load();else status.textContent='로그인 후 앱 관리에서 역할 관리로 이동하세요.';}catch(e){status.textContent=e.message;}
</script></body></html>`;
}

function rolePage(): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAKWOL · 멤버 자격 관리</title>
<style>body{font:16px system-ui;max-width:900px;margin:24px auto;padding:20px;background:#080c14;color:#e5e7eb}a{color:#c7d2fe}section,form{padding:18px;border:1px solid #334155;margin:16px 0}label{display:block;margin:12px 0}input,select,button{font:inherit;padding:10px 12px;min-height:44px;max-width:100%;box-sizing:border-box;border:1px solid #334155;border-radius:10px;background:#0b1220;color:#f8fafc}input{width:min(100%,420px)}button{background:#4f46e5;cursor:pointer;margin:4px}button:disabled{opacity:.55}section,form{border-radius:14px;background:#111827}a{display:inline-block;min-height:44px;line-height:44px}#status{white-space:pre-wrap}</style></head><body>
<a href="/admin/apps">← 앱 관리 · 자격 선택</a><h1>멤버 자격 관리</h1><a href="/admin/roles/legacy">기존 시즌3 추가 역할 관리</a><p>시즌3 맹원, 시즌4 맹원 등 이름과 Discord 역할 ID를 등록하세요. 앱 관리에서 허용할 자격을 선택합니다. 자격은 AUTH 관리자 권한을 부여하지 않습니다.</p>
<button id="login">운영자 로그인</button><button id="reload">새로고침</button><p id="status" role="status"></p>
<form id="create"><h2>새 자격</h2><label>자격 이름 <input name="name" required maxlength="80"></label><label>Discord 역할 ID <input name="role_id" required pattern="[0-9]{17,20}"></label><p>Discord 개발자 모드에서 역할 ID를 복사하세요. 봇 연결 없이 등록할 수 있습니다.</p><button>자격 등록</button></form><main id="items"></main>
<script type="module">
import { NakwolAuthClient } from '/sdk/v0.3.3/nakwol-auth-web.js';
const auth=new NakwolAuthClient({clientId:'nakwol-connect-admin',redirectUri:location.origin+'/admin/apps',authOrigin:location.origin});
const status=document.querySelector('#status'),items=document.querySelector('#items');let generation=0;
async function api(path,options={}){const headers=new Headers({'Authorization':'Bearer '+(auth.getAccessToken()||'')});if(options.body)headers.set('Content-Type','application/json');const r=await fetch('/admin/api/qualifications'+path,{...options,headers});const p=await r.json();if(!r.ok)throw new Error(p.error?.message||p.error?.code||'요청 실패');return p;}
async function load(){const current=++generation;status.textContent='불러오는 중…';try{const data=await api('');if(current!==generation)return;items.replaceChildren();for(const q of data.qualifications){const f=document.createElement('form');const title=document.createElement('h2');title.textContent=q.name;f.append(title);for(const [key,label] of [['name','자격 이름'],['role_id','Discord 역할 ID']]){const l=document.createElement('label'),input=document.createElement('input');input.name=key;input.value=q[key];input.required=true;if(key==='name')input.maxLength=80;else input.pattern='[0-9]{17,20}';l.append(document.createTextNode(label+' '),input);f.append(l);}const select=document.createElement('select');select.name='status';for(const [value,text] of [['active','사용'],['disabled','사용 중지']]){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}select.value=q.status;const save=document.createElement('button');save.textContent='변경 저장';const hint=document.createElement('p');hint.textContent='역할 변경·사용 중지는 이 자격을 선택한 모든 앱에 적용됩니다.';f.append(select,hint,save);f.onsubmit=async e=>{e.preventDefault();save.disabled=true;try{await api('/'+encodeURIComponent(q.id),{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(f)))});await load();}catch(e){status.textContent=e.message;}finally{save.disabled=false;}};items.append(f);}status.textContent=data.qualifications.length+'개 자격';}catch(e){if(current===generation)status.textContent=e.message;}}
document.querySelector('#create').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,button=f.querySelector('button');button.disabled=true;try{await api('',{method:'POST',body:JSON.stringify({...Object.fromEntries(new FormData(f)),status:'active'})});f.reset();await load();}catch(e){status.textContent=e.message;}finally{button.disabled=false;}};
document.querySelector('#login').onclick=()=>auth.login();document.querySelector('#reload').onclick=load;try{if(await auth.bootstrap())await load();else status.textContent='운영자 로그인 후 이용하세요.';}catch(e){status.textContent=e.message;}
</script></body></html>`;
}

export function registerRoleAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  registerQualificationAdminRoutes(app);
  for (const path of ['/admin/roles', '/admin/api/roles']) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store');
      await next();
    });
  }
  app.get('/admin/roles', (c) => c.html(rolePage()));
  app.get('/admin/roles/legacy', (c) => {c.header('Cache-Control','no-store');return c.html(legacyRolePage());});
  app.get('/admin/api/roles', async (c) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    try {
      let roles: readonly Role[] = [];
      let catalogWarning: string | null = null;
      try { roles = await fetchRoleCatalog(c.env); }
      catch (error) {
        if (!(error instanceof RoleCatalogError)) throw error;
        catalogWarning = error.message;
      }
      const seasonRole = roles.find(role => role.id === c.env.NAKWOL_MEMBER_ROLE_ID)
        ?? { id: c.env.NAKWOL_MEMBER_ROLE_ID, name: '시즌3 (설정된 역할 ID)' };
      if (!catalogWarning && !roles.some(role => role.id === seasonRole.id)) catalogWarning = '필수 시즌3 역할이 서버 목록에 없습니다. 저장 전에 서버 설정을 확인하세요.';
      const rows = await c.env.DB.prepare(`SELECT a.client_id, a.name, COALESCE(s.access_policy, 'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id = a.client_id ORDER BY a.name`).all<{ client_id: string; name: string; access_policy: string }>();
      const applications = await Promise.all(rows.results.map(async row => ({ ...row, qualification_policy: await getApplicationQualificationRequirement(c.env, row.client_id), required_role_ids: await getRequiredRoleIds(c.env, row.client_id) })));
      return c.json({ ok: true, roles, season_role: seasonRole, applications, catalog_available: roles.length > 0 && !catalogWarning, catalog_warning: catalogWarning });
    } catch (error) {
      if (error instanceof RoleSettingsError || error instanceof RoleCatalogError) return c.json({ error: { code: 'ROLE_CONFIGURATION_UNAVAILABLE', message: error.message } }, 503);
      throw error;
    }
  });

  const save = async (c: Context<{ Bindings: Env }>) => {
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    if (c.req.header('Origin') !== new URL(c.env.AUTH_ORIGIN).origin) return c.json({ error: { code: 'INVALID_ORIGIN' } }, 403);
    if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: { code: 'JSON_REQUIRED' } }, 415);
    let body: unknown;
    try { body = await c.req.json(); }
    catch { return c.json({ error: { code: 'INVALID_JSON' } }, 400); }
    if (!body || typeof body !== 'object' || !('client_id' in body) || typeof body.client_id !== 'string' || !('role_ids' in body)) return c.json({ error: { code: 'INVALID_ROLE_SETTINGS' } }, 400);
    let roleIds: readonly string[];
    try { roleIds = parseRequiredRoleIds(body.role_ids); }
    catch (error) {
      if (error instanceof RoleSettingsError) return c.json({ error: { code: error.code, message: error.message } }, 400);
      throw error;
    }
    const row = await c.env.DB.prepare(`SELECT COALESCE(s.access_policy, 'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id = a.client_id WHERE a.client_id = ?`).bind(body.client_id).first<{ access_policy: string }>();
    if (!row) return c.json({ error: { code: 'APP_NOT_FOUND' } }, 404);
    if (await getApplicationQualificationRequirement(c.env, body.client_id)) return c.json({ error: { code: 'CUSTOM_QUALIFICATIONS_ACTIVE', message: '앱 관리에서 자격을 변경하거나 기존 시즌3 조건으로 복원하세요.' } }, 409);
    if (row.access_policy !== 'member') return c.json({ error: { code: 'MEMBER_POLICY_REQUIRED' } }, 400);
    if (roleIds.includes(c.env.NAKWOL_GUILD_ID)) return c.json({ error: { code: 'UNKNOWN_ROLE' } }, 400);
    let roles: readonly Role[] | null = null;
    try { roles = await fetchRoleCatalog(c.env); }
    catch (error) {
      if (!(error instanceof RoleCatalogError)) throw error;
      if (!('manual_role_ids' in body) || body.manual_role_ids !== true) return c.json({ error: { code: 'ROLE_CATALOG_UNAVAILABLE', message: error.message } }, 503);
    }
    if (roles) {
      if (!roles.some(role => role.id === c.env.NAKWOL_MEMBER_ROLE_ID)) return c.json({ error: { code: 'ROLE_CATALOG_UNAVAILABLE', message: '필수 시즌3 역할이 서버에 없습니다.' } }, 503);
      if (roleIds.some(id => !roles.some(role => role.id === id))) return c.json({ error: { code: 'UNKNOWN_ROLE' } }, 400);
    }
    const additional = roleIds.filter(id => id !== c.env.NAKWOL_MEMBER_ROLE_ID);
    await c.env.DB.prepare(`INSERT INTO application_role_requirements(client_id, role_ids, updated_at) VALUES (?, ?, ?) ON CONFLICT(client_id) DO UPDATE SET role_ids = excluded.role_ids, updated_at = excluded.updated_at`).bind(body.client_id, JSON.stringify(additional), Date.now()).run();
    await logAuthEvent(c.env, 'application.roles.updated', identity.userId, body.client_id, { role_ids: additional, season_role_id: c.env.NAKWOL_MEMBER_ROLE_ID, validation: roles ? 'discord_catalog' : 'manual_role_ids' });
    return c.json({ ok: true, required_role_ids: additional });
  };
  app.post('/admin/roles', save);
  app.post('/admin/api/roles', save);
}

type QualificationRow = { readonly id: string; readonly name: string; readonly role_id: string; readonly status: string };

function registerQualificationAdminRoutes(app: Hono<{ Bindings: Env }>): void {
  for (const path of ['/admin/api/qualifications', '/admin/api/qualifications/*', '/admin/api/apps/:clientId/qualification-policy']) {
    app.use(path, async (c, next) => {
      c.header('Cache-Control', 'no-store');
      const identity = await requireOperator(c);
      if (identity instanceof Response) return identity;
      if (c.req.method !== 'GET') {
        if (c.req.header('Origin') !== new URL(c.env.AUTH_ORIGIN).origin) return c.json({ error: { code: 'INVALID_ORIGIN' } }, 403);
        if (!c.req.header('Content-Type')?.toLowerCase().startsWith('application/json')) return c.json({ error: { code: 'JSON_REQUIRED' } }, 415);
      }
      await next();
    });
  }
  app.get('/admin/api/qualifications', async c => {
    const rows = await c.env.DB.prepare('SELECT id,name,role_id,status,created_at,updated_at FROM membership_qualifications ORDER BY name,id').all<QualificationRow>();
    return c.json({ ok: true, qualifications: rows.results });
  });
  const saveQualification = async (c: Context<{ Bindings: Env }>) => {
    let body: unknown;
    try { body = await c.req.json(); } catch { return c.json({ error: { code: 'INVALID_JSON' } }, 400); }
    if (!body || typeof body !== 'object' || !('name' in body) || typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name) || !('role_id' in body) || typeof body.role_id !== 'string' || !/^[0-9]{17,20}$/.test(body.role_id) || body.role_id === c.env.NAKWOL_GUILD_ID || !('status' in body) || typeof body.status !== 'string' || !['active','disabled'].includes(body.status)) return c.json({ error: { code: 'INVALID_QUALIFICATION', message: '자격 이름, Discord 역할 ID와 상태를 확인하세요.' } }, 400);
    const id = c.req.method === 'POST' ? crypto.randomUUID() : c.req.param('id');
    if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) return c.json({ error: { code: 'INVALID_QUALIFICATION_ID' } }, 400);
    if (c.req.method === 'PUT' && !await c.env.DB.prepare('SELECT id FROM membership_qualifications WHERE id = ?').bind(id).first()) return c.json({ error: { code: 'QUALIFICATION_NOT_FOUND' } }, 404);
    const duplicate = await c.env.DB.prepare('SELECT id FROM membership_qualifications WHERE name = ? AND id <> ?').bind(body.name.trim(),id).first();
    if (duplicate) return c.json({ error: { code: 'DUPLICATE_QUALIFICATION_NAME' } }, 409);
    const now = Date.now();
    if (c.req.method === 'POST') await c.env.DB.prepare('INSERT INTO membership_qualifications(id,name,role_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').bind(id,body.name.trim(),body.role_id,body.status,now,now).run();
    else await c.env.DB.prepare('UPDATE membership_qualifications SET name=?,role_id=?,status=?,updated_at=? WHERE id=?').bind(body.name.trim(),body.role_id,body.status,now,id).run();
    const identity = await requireOperator(c);
    if (identity instanceof Response) return identity;
    await logAuthEvent(c.env,'membership.qualification.updated',identity.userId, null,{ id,name:body.name.trim(),role_id:body.role_id,status:body.status });
    return c.json({ ok:true,id });
  };
  app.post('/admin/api/qualifications',saveQualification);
  app.put('/admin/api/qualifications/:id',saveQualification);
  app.get('/admin/api/apps/:clientId/qualification-policy', async c => {
    const clientId=c.req.param('clientId');
    const exists=await c.env.DB.prepare('SELECT client_id FROM applications WHERE client_id=?').bind(clientId).first();
    if (!exists) return c.json({error:{code:'APP_NOT_FOUND'}},404);
    const policy=await getApplicationQualificationRequirement(c.env,clientId);
    return c.json({ok:true,policy:policy ? {mode:'custom',...policy} : {mode:'legacy'},legacy_role_ids:await getRequiredRoleIds(c.env,clientId),season_role_id:c.env.NAKWOL_MEMBER_ROLE_ID});
  });
  app.put('/admin/api/apps/:clientId/qualification-policy',async c => {
    let body:unknown;
    try {body=await c.req.json();} catch {return c.json({error:{code:'INVALID_JSON'}},400);}
    if (!body || typeof body!=='object' || !('mode' in body) || (body.mode!=='legacy' && body.mode!=='custom')) return c.json({error:{code:'INVALID_QUALIFICATION_SETTINGS'}},400);
    const clientId=c.req.param('clientId');
    const row=await c.env.DB.prepare("SELECT COALESCE(s.access_policy,'member') AS access_policy FROM applications a LEFT JOIN application_settings s ON s.client_id=a.client_id WHERE a.client_id=?").bind(clientId).first<{access_policy:string}>();
    if (!row) return c.json({error:{code:'APP_NOT_FOUND'}},404);
    if (row.access_policy!=='member') return c.json({error:{code:'MEMBER_POLICY_REQUIRED'}},400);
    let detail: Record<string,unknown> = {mode:body.mode};
    if (body.mode==='legacy') {
      await c.env.DB.prepare('DELETE FROM application_qualification_requirements WHERE client_id=?').bind(clientId).run();
    } else {
      try {
        const ids=parseQualificationIds('qualification_ids' in body ? body.qualification_ids : null);
        const matchMode=parseQualificationMatchMode('match_mode' in body ? body.match_mode : null);
        const rows=await c.env.DB.prepare('SELECT id FROM membership_qualifications WHERE status=\'active\'').all<{id:string}>();
        if(ids.some(id=>!rows.results.some(row=>row.id===id))) return c.json({error:{code:'UNKNOWN_OR_DISABLED_QUALIFICATION',message:'사용 중인 자격만 선택할 수 있습니다.'}},400);
        await c.env.DB.prepare('INSERT INTO application_qualification_requirements(client_id,match_mode,qualification_ids,updated_at) VALUES(?,?,?,?) ON CONFLICT(client_id) DO UPDATE SET match_mode=excluded.match_mode,qualification_ids=excluded.qualification_ids,updated_at=excluded.updated_at').bind(clientId,matchMode,JSON.stringify(ids),Date.now()).run();
        detail={mode:'custom',match_mode:matchMode,qualification_ids:ids};
      } catch(error) {
        if (error instanceof Error && /\bMEMBER_POLICY_REQUIRED\b/.test(error.message)) return c.json({error:{code:'MEMBER_POLICY_REQUIRED',message:'다른 요청에서 앱 접근 정책을 변경했습니다. 새로고침 후 멤버 접근 정책을 저장하고 자격을 다시 선택하세요.'}},409);
        if(error instanceof QualificationSettingsError) return c.json({error:{code:error.code,message:error.message}},400);throw error;}
    }
    const identity=await requireOperator(c);
    if(identity instanceof Response)return identity;
    await logAuthEvent(c.env,'application.qualifications.updated',identity.userId,clientId,detail);
    return c.json({ok:true,policy:detail});
  });
}
