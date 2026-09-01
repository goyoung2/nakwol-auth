import type { Hono } from 'hono';
import type { DataEnv } from './types.ts';

export const DATA_LAB_CLIENT_ID = 'nakwol-data-lab';

export function dataLabPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>NAKWOL DATA LAB</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e5e7eb;background:#071018}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 0,#12304a 0,#0b1724 35%,#05090f 100%);color:#e5e7eb}
    button{font:inherit}.shell{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:30px 0 60px}.header{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;margin-bottom:18px}.brand small{display:block;color:#67e8f9;letter-spacing:.12em}.brand h1{margin:5px 0 0;font-size:clamp(28px,4vw,40px)}.subtitle{margin:9px 0 0;color:#94a3b8;line-height:1.6}.identity{color:#cbd5e1;text-align:right}
    .panel,.notice{border:1px solid #284156;background:rgba(9,20,32,.9);border-radius:18px;box-shadow:0 18px 44px rgba(0,0,0,.22)}.panel{padding:20px;margin-top:14px}.notice{padding:18px;margin-top:14px}.notice.error{border-color:#7f1d1d;background:rgba(69,10,10,.72);color:#fecaca}.notice.warning{border-color:#854d0e;background:rgba(69,35,7,.72);color:#fde68a}[hidden]{display:none!important}
    .actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:15px}.button{appearance:none;border:1px solid transparent;border-radius:10px;padding:10px 14px;min-height:42px;background:#0891b2;color:white;font-weight:800;cursor:pointer}.button.secondary{background:#162636;border-color:#35506a;color:#e2e8f0}.button.danger{background:#7f1d1d}.button:disabled{opacity:.45;cursor:not-allowed}.button:focus-visible{outline:2px solid #67e8f9;outline-offset:3px}
    .status-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.status-card{padding:14px;border:1px solid #284156;border-radius:13px;background:#08131f}.label{font-size:12px;color:#94a3b8}.value{margin-top:5px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;overflow-wrap:anywhere}.ok{color:#86efac}.bad{color:#fca5a5}.info{color:#bae6fd}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}th,td{border-bottom:1px solid #23384b;padding:9px 8px;text-align:left}th{color:#94a3b8;font-size:12px}.yes{color:#86efac;font-weight:800}.no{color:#64748b}.steps{display:grid;gap:8px;margin-top:14px}.step{display:grid;grid-template-columns:76px minmax(130px,.7fr) 1fr;gap:10px;align-items:start;border:1px solid #23384b;border-radius:12px;padding:10px 12px;background:#07111b}.badge{display:inline-flex;justify-content:center;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:900}.badge.pass{background:#052e16;color:#86efac}.badge.fail{background:#450a0a;color:#fca5a5}.badge.info{background:#164e63;color:#a5f3fc}.step-name{font-weight:800}.step-detail{color:#94a3b8;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}
    pre{margin:12px 0 0;max-height:320px;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#02070c;border:1px solid #1e3345;border-radius:12px;padding:14px;color:#cbd5e1;font-size:12px}.foot{margin-top:14px;color:#94a3b8;font-size:12px;line-height:1.55}
    @media(max-width:760px){.header{flex-direction:column}.identity{text-align:left}.status-grid{grid-template-columns:1fr}.step{grid-template-columns:65px 1fr}.step-detail{grid-column:1/-1}.actions{display:grid;grid-template-columns:1fr}.button{width:100%}table{font-size:12px}}
  </style>
</head>
<body>
<main class="shell">
  <header class="header">
    <div class="brand">
      <small>落月 · NAKWOL DATA</small>
      <h1>DATA LAB</h1>
      <p class="subtitle">실제 production DATA API에 로그인한 관리자 계정으로 C/R/U/D 요청을 보내고, 저장·조회·수정·삭제 결과를 단계별로 확인합니다.</p>
    </div>
    <div id="identity" class="identity">인증 상태 확인 중</div>
  </header>

  <section id="login" class="notice" hidden>
    <strong>DATA Lab 로그인이 필요합니다.</strong>
    <p class="subtitle">전용 <code>nakwol-data-lab</code> 클라이언트는 관리자에게만 발급됩니다.</p>
    <div class="actions"><button id="login-button" class="button" type="button">관리자 로그인</button></div>
  </section>
  <section id="error" class="notice error" hidden aria-live="assertive"></section>

  <section id="workspace" hidden>
    <div class="panel">
      <strong>연결 상태</strong>
      <div class="status-grid" style="margin-top:12px">
        <div class="status-card"><div class="label">AUTH</div><div id="auth-status" class="value info">확인 전</div></div>
        <div class="status-card"><div class="label">DATA runtime</div><div id="data-status" class="value info">확인 전</div></div>
        <div class="status-card"><div class="label">Lab game account</div><div id="account-status" class="value info">아직 선택되지 않음</div></div>
      </div>
      <div class="actions">
        <button id="connection-button" class="button secondary" type="button">연결 다시 확인</button>
        <button id="smoke-button" class="button" type="button">CRUD 스모크 실행</button>
        <button id="logout-button" class="button secondary" type="button">앱 로그아웃</button>
        <button id="global-logout-button" class="button danger" type="button">전체 로그아웃</button>
      </div>
    </div>

    <div class="panel">
      <strong>현재 API CRUD 지원 범위</strong>
      <table aria-label="DATA CRUD 지원 범위">
        <thead><tr><th>도메인</th><th>Create</th><th>Read</th><th>Update</th><th>Delete</th><th>Lab 동작</th></tr></thead>
        <tbody>
          <tr><td>게임 계정</td><td class="yes">지원</td><td class="yes">지원</td><td class="no">미지원</td><td class="no">미지원</td><td>전용 계정 생성 후 재사용</td></tr>
          <tr><td>보유 장수</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td>PUT → GET → PUT → GET → DELETE → GET</td></tr>
          <tr><td>보유 전법</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td>PUT → GET → PUT → GET → DELETE → GET</td></tr>
          <tr><td>장비 인스턴스</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td>POST → GET → PATCH → GET → DELETE → GET</td></tr>
          <tr><td>덱</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td class="yes">지원</td><td>POST → composition PUT → GET → PATCH → GET → DELETE → GET</td></tr>
          <tr><td>스냅샷</td><td class="yes">지원</td><td class="yes">지원</td><td class="no">미지원</td><td class="no">미지원</td><td>불변 데이터라 자동 smoke에서는 생성하지 않음</td></tr>
          <tr><td>Registry</td><td class="no">미지원</td><td class="yes">지원</td><td class="no">미지원</td><td class="no">미지원</td><td>테스트용 canonical ID 선택에 사용</td></tr>
        </tbody>
      </table>
    </div>

    <div class="panel">
      <strong>실행 결과</strong>
      <p class="subtitle">자동 smoke는 전용 Lab 게임 계정 하나만 보존하고, 생성한 장수·전법·장비·덱은 마지막에 cleanup합니다.</p>
      <div id="steps" class="steps" aria-live="polite"></div>
      <div class="foot">Access token은 화면이나 로그에 표시하지 않습니다. 아래에는 마지막 DATA API JSON 응답만 표시됩니다.</div>
      <pre id="raw">-</pre>
    </div>
  </section>
</main>
<script type="module">
  import { NakwolAuthClient } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.2.0/nakwol-auth-web.js';

  const DATA_LAB_CLIENT_ID = 'nakwol-data-lab';
  const LAB_ACCOUNT_NAME = 'NAKWOL DATA Lab';
  const LAB_SERVER_CODE = 'data-lab';
  const auth = new NakwolAuthClient({
    clientId: DATA_LAB_CLIENT_ID,
    redirectUri: location.origin + '/lab',
  });

  const identity = document.querySelector('#identity');
  const login = document.querySelector('#login');
  const error = document.querySelector('#error');
  const workspace = document.querySelector('#workspace');
  const authStatus = document.querySelector('#auth-status');
  const dataStatus = document.querySelector('#data-status');
  const accountStatus = document.querySelector('#account-status');
  const steps = document.querySelector('#steps');
  const raw = document.querySelector('#raw');
  const smokeButton = document.querySelector('#smoke-button');

  function showError(message) {
    error.textContent = message || 'DATA Lab 오류가 발생했습니다.';
    error.hidden = false;
  }

  function clearError() { error.hidden = true; error.textContent = ''; }
  function setRaw(value) { raw.textContent = value === undefined ? '-' : JSON.stringify(value, null, 2); }

  function addStep(state, name, detail) {
    const row = document.createElement('div');
    row.className = 'step';
    const badge = document.createElement('span');
    badge.className = 'badge ' + state.toLowerCase();
    badge.textContent = state;
    const title = document.createElement('div');
    title.className = 'step-name';
    title.textContent = name;
    const text = document.createElement('div');
    text.className = 'step-detail';
    text.textContent = detail || '';
    row.append(badge, title, text);
    steps.appendChild(row);
  }

  async function dataRequest(path, options = {}) {
    const token = auth.getAccessToken();
    if (!token) throw new Error('DATA_LAB_AUTH_REQUIRED');
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    headers.set('X-NAKWOL-CLIENT-ID', DATA_LAB_CLIENT_ID);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await fetch(path, { ...options, headers });
    const payload = await response.json().catch(() => null);
    setRaw(payload);
    if (!response.ok || payload?.ok !== true) {
      const code = payload?.error?.code || ('HTTP_' + response.status);
      const message = payload?.error?.message || 'DATA 요청이 실패했습니다.';
      const failure = new Error(code + ': ' + message);
      failure.status = response.status;
      failure.payload = payload;
      throw failure;
    }
    return { status: response.status, data: payload.data };
  }

  async function runStep(name, fn, detail) {
    try {
      const value = await fn();
      addStep('PASS', name, typeof detail === 'function' ? detail(value) : (detail || 'OK'));
      return value;
    } catch (e) {
      addStep('FAIL', name, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  async function ensureLabAccount() {
    const listed = await dataRequest('/v1/game-accounts');
    let account = Array.isArray(listed.data) ? listed.data.find((row) => row.nickname === LAB_ACCOUNT_NAME && row.server_code === LAB_SERVER_CODE) : null;
    if (account) return { account, created: false };
    const created = await dataRequest('/v1/game-accounts', {
      method: 'POST',
      body: JSON.stringify({ nickname: LAB_ACCOUNT_NAME, server_code: LAB_SERVER_CODE, is_primary: false }),
    });
    return { account: created.data, created: true };
  }

  function canonicalTactic(tactics, generals) {
    const unique = new Set(generals.map((row) => row.unique_tactic_id).filter(Boolean));
    return tactics.find((row) => {
      const m = row.metadata || {};
      return Number(m.skill_class_raw) === 5
        && Number(m.learn_times) === 1
        && Number(m.get_type) === 3
        && Number(m.is_copy || 0) === 0
        && Number(m.chip_id || 0) > 0
        && !unique.has(row.id);
    });
  }

  async function checkConnection() {
    clearError();
    const user = await auth.getMe();
    identity.textContent = (user?.display_name || user?.id || 'NAKWOL 관리자');
    authStatus.textContent = 'PASS · ' + (user?.id || 'authenticated');
    authStatus.className = 'value ok';
    const schemaResponse = await fetch('/api/schema', { headers: { 'Cache-Control': 'no-cache' } });
    const schema = await schemaResponse.json();
    setRaw(schema);
    if (!schemaResponse.ok || schema?.ok !== true) throw new Error('DATA schema 확인 실패');
    dataStatus.textContent = 'PASS · v' + schema.version + ' / schema ' + schema.schema_version;
    dataStatus.className = 'value ok';
    const me = await dataRequest('/v1/me');
    return { user, schema, principal: me.data };
  }

  async function cleanup(state) {
    const accountId = state.accountId;
    if (!accountId) return;
    const attempts = [
      ['cleanup deck', state.deckId && ('/v1/game-accounts/' + encodeURIComponent(accountId) + '/decks/' + encodeURIComponent(state.deckId))],
      ['cleanup equipment', state.equipmentId && ('/v1/game-accounts/' + encodeURIComponent(accountId) + '/equipment/' + encodeURIComponent(state.equipmentId))],
      ['cleanup tactic', state.tacticId && ('/v1/game-accounts/' + encodeURIComponent(accountId) + '/roster/tactics/' + encodeURIComponent(state.tacticId))],
      ['cleanup general', state.generalId && ('/v1/game-accounts/' + encodeURIComponent(accountId) + '/roster/generals/' + encodeURIComponent(state.generalId))],
    ];
    for (const [name, path] of attempts) {
      if (!path) continue;
      try {
        await dataRequest(path, { method: 'DELETE' });
        addStep('INFO', name, '남은 테스트 데이터를 정리했습니다.');
      } catch (e) {
        addStep('FAIL', name, e instanceof Error ? e.message : String(e));
      }
    }
  }

  async function runCrudSmoke() {
    smokeButton.disabled = true;
    clearError();
    steps.replaceChildren();
    setRaw('-');
    const state = { accountId: null, generalId: null, tacticId: null, equipmentId: null, deckId: null };
    try {
      await runStep('AUTH + DATA 연결', checkConnection, 'AUTH /me와 DATA /v1/me가 모두 정상입니다.');

      const accountResult = await runStep('게임 계정 C/R', ensureLabAccount, (value) => value.created ? '전용 Lab 게임 계정을 생성했습니다. U/D endpoint는 현재 미지원입니다.' : '기존 전용 Lab 게임 계정을 재사용합니다.');
      state.accountId = accountResult.account.id;
      accountStatus.textContent = accountResult.account.id + ' · ' + accountResult.account.nickname;
      accountStatus.className = 'value ok';
      const accountId = encodeURIComponent(state.accountId);

      const generalsResult = await runStep('Registry 장수 조회', () => dataRequest('/v1/registry/generals?include_hidden=1'), (value) => {
        const enabled = value.data.filter((row) => row.enabled === 1).length;
        return enabled + '개 활성 / ' + value.data.length + '개 전체';
      });
      const tacticsResult = await runStep('Registry 전법 조회', () => dataRequest('/v1/registry/tactics'), (value) => String(value.data.length) + '개');
      const equipmentResult = await runStep('Registry 장비 조회', () => dataRequest('/v1/registry/equipment'), (value) => String(value.data.length) + '개');
      const general = generalsResult.data.find((row) => row.enabled === 1);
      const tactic = canonicalTactic(tacticsResult.data, generalsResult.data);
      const template = equipmentResult.data.find((row) => row.type === 'weapon') || equipmentResult.data[0];
      if (!general || !tactic || !template) throw new Error('CRUD smoke에 사용할 canonical Registry 항목을 선택하지 못했습니다.');
      addStep('INFO', '테스트 항목 선택', general.name + ' / ' + tactic.name + ' / ' + template.name);
      state.generalId = general.id;
      state.tacticId = tactic.id;

      const generalPath = '/v1/game-accounts/' + accountId + '/roster/generals/' + encodeURIComponent(general.id);
      await runStep('장수 Create', () => dataRequest(generalPath, { method: 'PUT', body: JSON.stringify({ breakthrough: 0, promotion: 0, favorite: false, note: 'DATA Lab smoke' }) }), general.name);
      await runStep('장수 Read', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/generals');
        if (!result.data.some((row) => row.general_id === general.id)) throw new Error('생성한 장수가 조회되지 않습니다.');
        return result;
      });
      await runStep('장수 Update', () => dataRequest(generalPath, { method: 'PUT', body: JSON.stringify({ breakthrough: 1, promotion: 0, favorite: true, note: 'DATA Lab smoke updated' }) }));
      await runStep('장수 Update 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/generals');
        const row = result.data.find((item) => item.general_id === general.id);
        if (!row || row.breakthrough !== 1 || row.favorite !== true) throw new Error('장수 수정값이 저장되지 않았습니다.');
        return result;
      });

      const tacticPath = '/v1/game-accounts/' + accountId + '/roster/tactics/' + encodeURIComponent(tactic.id);
      await runStep('전법 Create', () => dataRequest(tacticPath, { method: 'PUT', body: JSON.stringify({ breakthrough: 0, favorite: false, note: 'DATA Lab smoke' }) }), tactic.name);
      await runStep('전법 Read', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/tactics');
        if (!result.data.some((row) => row.tactic_id === tactic.id)) throw new Error('생성한 전법이 조회되지 않습니다.');
        return result;
      });
      await runStep('전법 Update', () => dataRequest(tacticPath, { method: 'PUT', body: JSON.stringify({ breakthrough: 1, favorite: true, note: 'DATA Lab smoke updated' }) }));
      await runStep('전법 Update 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/tactics');
        const row = result.data.find((item) => item.tactic_id === tactic.id);
        if (!row || row.breakthrough !== 1 || row.favorite !== true) throw new Error('전법 수정값이 저장되지 않았습니다.');
        return result;
      });

      const equipmentCreated = await runStep('장비 Create', () => dataRequest('/v1/game-accounts/' + accountId + '/equipment', {
        method: 'POST',
        body: JSON.stringify({ template_id: template.id, nickname: 'DATA Lab smoke', locked: false, favorite: false }),
      }), template.name);
      state.equipmentId = equipmentCreated.data.id;
      await runStep('장비 Read', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/equipment');
        if (!result.data.some((row) => row.id === state.equipmentId)) throw new Error('생성한 장비가 조회되지 않습니다.');
        return result;
      });
      const equipmentPath = '/v1/game-accounts/' + accountId + '/equipment/' + encodeURIComponent(state.equipmentId);
      await runStep('장비 Update', () => dataRequest(equipmentPath, { method: 'PATCH', body: JSON.stringify({ nickname: 'DATA Lab smoke updated', favorite: true }) }));
      await runStep('장비 Update 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/equipment');
        const row = result.data.find((item) => item.id === state.equipmentId);
        if (!row || row.nickname !== 'DATA Lab smoke updated' || row.favorite !== true) throw new Error('장비 수정값이 저장되지 않았습니다.');
        return result;
      });

      const deckCreated = await runStep('덱 Create', () => dataRequest('/v1/game-accounts/' + accountId + '/decks', {
        method: 'POST',
        body: JSON.stringify({ name: 'DATA Lab smoke', status: 'research', visibility: 'private', note: 'DATA Lab CRUD smoke' }),
      }));
      state.deckId = deckCreated.data.id;
      const deckPath = '/v1/game-accounts/' + accountId + '/decks/' + encodeURIComponent(state.deckId);
      const equipmentSlot = template.type === 'mount' ? { mount_instance_id: state.equipmentId } : { weapon_instance_id: state.equipmentId };
      await runStep('덱 composition PUT', () => dataRequest(deckPath + '/composition', {
        method: 'PUT',
        body: JSON.stringify({ generals: [{ position: 1, general_id: general.id, ...equipmentSlot, tactics: [{ slot: 1, tactic_id: tactic.id }] }] }),
      }));
      await runStep('덱 Read', async () => {
        const result = await dataRequest(deckPath);
        if (!result.data || result.data.id !== state.deckId) throw new Error('생성한 덱이 조회되지 않습니다.');
        return result;
      });
      await runStep('덱 Update', () => dataRequest(deckPath, { method: 'PATCH', body: JSON.stringify({ name: 'DATA Lab smoke updated', note: 'updated by DATA Lab' }) }));
      await runStep('덱 Update 확인', async () => {
        const result = await dataRequest(deckPath);
        if (result.data.name !== 'DATA Lab smoke updated') throw new Error('덱 수정값이 저장되지 않았습니다.');
        return result;
      });

      await runStep('덱 Delete', () => dataRequest(deckPath, { method: 'DELETE' }));
      state.deckId = null;
      await runStep('덱 Delete 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/decks');
        if (result.data.some((row) => row.id === deckCreated.data.id)) throw new Error('삭제한 덱이 남아 있습니다.');
        return result;
      });

      await runStep('장비 Delete', () => dataRequest(equipmentPath, { method: 'DELETE' }));
      state.equipmentId = null;
      await runStep('장비 Delete 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/equipment');
        if (result.data.some((row) => row.id === equipmentCreated.data.id)) throw new Error('삭제한 장비가 남아 있습니다.');
        return result;
      });

      await runStep('전법 Delete', () => dataRequest(tacticPath, { method: 'DELETE' }));
      state.tacticId = null;
      await runStep('전법 Delete 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/tactics');
        if (result.data.some((row) => row.tactic_id === tactic.id)) throw new Error('삭제한 전법이 남아 있습니다.');
        return result;
      });

      await runStep('장수 Delete', () => dataRequest(generalPath, { method: 'DELETE' }));
      state.generalId = null;
      await runStep('장수 Delete 확인', async () => {
        const result = await dataRequest('/v1/game-accounts/' + accountId + '/roster/generals');
        if (result.data.some((row) => row.general_id === general.id)) throw new Error('삭제한 장수가 남아 있습니다.');
        return result;
      });

      addStep('PASS', 'CRUD smoke 완료', '장수·전법·장비·덱 C/R/U/D와 덱 composition PUT을 실제 DATA API에서 확인했습니다. 게임 계정 U/D 및 스냅샷 U/D는 현재 API 미지원입니다.');
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e));
      await cleanup(state);
    } finally {
      smokeButton.disabled = false;
    }
  }

  document.querySelector('#login-button').onclick = () => auth.login();
  document.querySelector('#connection-button').onclick = async () => {
    try { await checkConnection(); clearError(); } catch (e) { showError(e instanceof Error ? e.message : String(e)); }
  };
  document.querySelector('#smoke-button').onclick = runCrudSmoke;
  document.querySelector('#logout-button').onclick = async () => { await auth.logout(); location.reload(); };
  document.querySelector('#global-logout-button').onclick = () => auth.logout({ global: true, returnTo: location.origin + '/lab' });

  try {
    const user = await auth.bootstrap();
    if (!user) {
      identity.textContent = '로그인하지 않음';
      login.hidden = false;
    } else {
      workspace.hidden = false;
      await checkConnection();
    }
  } catch (e) {
    identity.textContent = '인증 실패';
    login.hidden = false;
    showError(e instanceof Error ? e.message : String(e));
  }
</script>
</body>
</html>`;
}

export function registerDataLabRoutes(app: Hono<{ Bindings: DataEnv }>): void {
  app.get('/lab', (c) => c.html(dataLabPageHtml()));
}
