import type { Hono } from 'hono';
import type { DataEnv } from './types.ts';

export const MY_DATA_CLIENT_ID = 'nakwol-my-data';

export function myDataPageHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>NAKWOL My Data</title>
  <style>
    :root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#142033;background:#f6f3eb}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#f8f6f0 0,#f2eee4 100%);color:#142033}
    button,input,select{font:inherit}button{cursor:pointer}.shell{width:min(1080px,calc(100% - 32px));margin:0 auto;padding:28px 0 64px}
    .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.brand small{display:block;color:#9a6c17;font-weight:800;letter-spacing:.12em}.brand h1{margin:5px 0 0;font-size:clamp(28px,5vw,42px)}.subtitle{margin:8px 0 0;color:#637083;line-height:1.6}.identity{text-align:right;color:#4b5563;font-size:14px}
    .panel{background:#fff;border:1px solid #ddd7c9;border-radius:16px;padding:20px;margin-top:14px;box-shadow:0 10px 28px rgba(65,50,25,.06)}.notice{background:#fff9e9;border:1px solid #e2c882;border-radius:14px;padding:16px;margin-top:14px}.notice.error{background:#fff1f1;border-color:#e6aaaa;color:#922}.notice.success{background:#effaf2;border-color:#a9d5b4;color:#285d36}[hidden]{display:none!important}
    .toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.field{display:grid;gap:6px}.field.grow{flex:1;min-width:240px}.field label{font-size:12px;font-weight:800;color:#64748b}.control{width:100%;min-height:42px;border:1px solid #cfc8b9;border-radius:10px;padding:9px 11px;background:white;color:#142033}.control:focus{outline:2px solid #c99219;outline-offset:1px;border-color:#c99219}
    .button{appearance:none;border:0;border-radius:10px;min-height:42px;padding:10px 15px;background:#b27a16;color:white;font-weight:800}.button.secondary{background:#fff;color:#39465a;border:1px solid #cfc8b9}.button:focus-visible{outline:2px solid #142033;outline-offset:2px}.button:disabled{opacity:.5;cursor:not-allowed}
    .overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}.metric{border:1px solid #e2ddd1;border-radius:14px;padding:16px;background:#fcfbf8}.metric .label{font-size:12px;color:#718096}.metric .value{font-size:30px;font-weight:900;margin-top:5px}.metric .hint{font-size:12px;color:#8a94a3;margin-top:4px}
    .account-summary{display:flex;justify-content:space-between;gap:14px;align-items:center}.account-name{font-size:20px;font-weight:900}.account-meta{margin-top:4px;color:#6b7280;font-size:13px}.status{font-size:12px;font-weight:800;color:#9a6c17}.empty{text-align:center;padding:34px 16px;color:#64748b}.empty strong{display:block;color:#263244;font-size:19px;margin-bottom:7px}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.check{display:flex;align-items:center;gap:8px;min-height:42px}.form-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:14px}.section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.section-title h2{font-size:17px;margin:0}.future{font-size:12px;color:#8a94a3}.deck-list{display:grid;gap:8px;margin-top:12px}.deck-row{border:1px solid #e5e0d5;border-radius:11px;padding:11px 13px;display:flex;justify-content:space-between;gap:10px}.deck-row small{color:#8a94a3}
    @media(max-width:760px){.shell{width:min(100% - 20px,1080px);padding-top:18px}.topbar{flex-direction:column}.identity{text-align:left}.overview{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{display:grid;grid-template-columns:1fr}.field.grow{min-width:0}.button{width:100%}.form-grid{grid-template-columns:1fr}.account-summary{align-items:flex-start;flex-direction:column}}
    @media(max-width:420px){.overview{grid-template-columns:1fr 1fr}.metric{padding:13px}.metric .value{font-size:25px}}
  </style>
</head>
<body>
<main class="shell">
  <header class="topbar">
    <div class="brand">
      <small>落月 · NAKWOL</small>
      <h1>My Data</h1>
      <p class="subtitle">내 게임 계정과 덱 정보를 한 번 등록하고, 낙월의 여러 서비스에서 같은 데이터를 재사용합니다.</p>
    </div>
    <div id="identity" class="identity">연결 확인 중</div>
  </header>

  <section id="message" class="notice" hidden aria-live="polite"></section>
  <section id="error" class="notice error" hidden aria-live="assertive"></section>

  <section id="login-panel" class="panel" hidden>
    <strong>NAKWOL 로그인이 필요합니다.</strong>
    <p class="subtitle">Discord로 연결된 NAKWOL 계정으로 로그인하면 저장된 게임 데이터를 불러옵니다.</p>
    <div class="form-actions"><button id="login-button" class="button" type="button">NAKWOL 로그인</button></div>
  </section>

  <section id="workspace" hidden>
    <section class="panel">
      <div class="toolbar">
        <div class="field grow">
          <label for="account-select">게임 계정</label>
          <select id="account-select" class="control" aria-label="게임 계정 선택"></select>
        </div>
        <button id="new-account-button" class="button secondary" type="button">새 게임 계정</button>
        <button id="refresh-button" class="button secondary" type="button">새로고침</button>
        <button id="logout-button" class="button secondary" type="button">로그아웃</button>
      </div>
    </section>

    <section id="account-form-panel" class="panel" hidden>
      <div class="section-title"><h2>새 게임 계정</h2><span class="future">게임 계정 수정/삭제는 현재 API 미지원</span></div>
      <form id="account-form">
        <div class="form-grid" style="margin-top:14px">
          <div class="field">
            <label for="nickname">게임 닉네임</label>
            <input id="nickname" name="nickname" class="control" required maxlength="80" autocomplete="off" placeholder="예: 고영">
          </div>
          <div class="field">
            <label for="server-code">서버 코드</label>
            <input id="server-code" name="server_code" class="control" required maxlength="40" autocomplete="off" placeholder="예: 5">
          </div>
        </div>
        <label class="check"><input id="is-primary" name="is_primary" type="checkbox"> 이 계정을 기본 계정으로 사용</label>
        <div class="form-actions">
          <button id="cancel-account-button" class="button secondary" type="button">취소</button>
          <button id="save-account-button" class="button" type="submit">계정 저장</button>
        </div>
      </form>
    </section>

    <section id="empty-panel" class="panel empty" hidden>
      <strong>등록된 게임 계정이 없습니다.</strong>
      게임 계정을 하나 만들면 장수·전법·장비·덱 정보를 이 계정 아래에 저장할 수 있습니다.
      <div class="form-actions" style="justify-content:center"><button id="empty-create-button" class="button" type="button">첫 게임 계정 만들기</button></div>
    </section>

    <section id="overview-panel" hidden>
      <section class="panel account-summary">
        <div>
          <div id="account-name" class="account-name">-</div>
          <div id="account-meta" class="account-meta">-</div>
        </div>
        <div id="overview-status" class="status">데이터 불러오는 중</div>
      </section>

      <div class="overview" aria-label="내 데이터 요약">
        <article class="metric"><div class="label">내 장수</div><div id="general-count" class="value">-</div><div class="hint">보유 등록</div></article>
        <article class="metric"><div class="label">내 전법</div><div id="tactic-count" class="value">-</div><div class="hint">보유 등록</div></article>
        <article class="metric"><div class="label">내 장비</div><div id="equipment-count" class="value">-</div><div class="hint">장비 인스턴스</div></article>
        <article class="metric"><div class="label">내 덱</div><div id="deck-count" class="value">-</div><div class="hint">현재 live deck</div></article>
      </div>

      <section class="panel">
        <div class="section-title"><h2>내 덱</h2><span class="future">덱 편집 UI는 다음 개발 단계에서 추가됩니다.</span></div>
        <div id="deck-list" class="deck-list"></div>
      </section>
    </section>
  </section>
</main>

<script>
  const ui = {
    identity: document.querySelector('#identity'),
    message: document.querySelector('#message'),
    error: document.querySelector('#error'),
    loginPanel: document.querySelector('#login-panel'),
    workspace: document.querySelector('#workspace'),
    accountSelect: document.querySelector('#account-select'),
    accountFormPanel: document.querySelector('#account-form-panel'),
    accountForm: document.querySelector('#account-form'),
    saveAccountButton: document.querySelector('#save-account-button'),
    emptyPanel: document.querySelector('#empty-panel'),
    overviewPanel: document.querySelector('#overview-panel'),
    accountName: document.querySelector('#account-name'),
    accountMeta: document.querySelector('#account-meta'),
    overviewStatus: document.querySelector('#overview-status'),
    generalCount: document.querySelector('#general-count'),
    tacticCount: document.querySelector('#tactic-count'),
    equipmentCount: document.querySelector('#equipment-count'),
    deckCount: document.querySelector('#deck-count'),
    deckList: document.querySelector('#deck-list'),
  };

  let accounts = [];
  let activeAccountId = '';
  let busy = false;

  function connect() { return window.NAKWOL_CONNECT; }
  function data() { return connect()?.data; }
  function rows(payload) { return Array.isArray(payload?.data) ? payload.data : []; }
  function text(value) { return value == null ? '' : String(value); }

  function showError(error) {
    const code = error?.code ? '[' + error.code + '] ' : '';
    ui.error.textContent = code + (error?.message || text(error) || '요청을 처리하지 못했습니다.');
    ui.error.hidden = false;
  }
  function clearError() { ui.error.hidden = true; ui.error.textContent = ''; }
  function showMessage(message) { ui.message.textContent = message; ui.message.hidden = false; }
  function clearMessage() { ui.message.hidden = true; ui.message.textContent = ''; }
  function setBusy(value) { busy = value; ui.saveAccountButton.disabled = value; }

  function openAccountForm() {
    clearError(); clearMessage();
    ui.accountForm.reset();
    ui.accountFormPanel.hidden = false;
    document.querySelector('#nickname').focus();
  }
  function closeAccountForm() { ui.accountFormPanel.hidden = true; }

  function renderDecks(decks) {
    ui.deckList.replaceChildren();
    if (!decks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '아직 등록된 덱이 없습니다.';
      ui.deckList.appendChild(empty);
      return;
    }
    for (const deck of decks.slice(0, 8)) {
      const row = document.createElement('div'); row.className = 'deck-row';
      const name = document.createElement('strong'); name.textContent = deck.name || '이름 없는 덱';
      const meta = document.createElement('small'); meta.textContent = (deck.status || 'active') + ' · ' + (deck.visibility || 'private');
      row.append(name, meta); ui.deckList.appendChild(row);
    }
  }

  function renderAccountOptions(preferredId) {
    ui.accountSelect.replaceChildren();
    for (const account of accounts) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = (account.nickname || account.id) + (account.server_code ? ' · 서버 ' + account.server_code : '') + (account.is_primary ? ' · 기본' : '');
      ui.accountSelect.appendChild(option);
    }
    const preferred = accounts.find((row) => row.id === preferredId);
    const primary = accounts.find((row) => row.is_primary === true || row.is_primary === 1);
    activeAccountId = (preferred || primary || accounts[0])?.id || '';
    ui.accountSelect.value = activeAccountId;
  }

  async function loadOverview(accountId) {
    if (!accountId) return;
    clearError();
    const account = accounts.find((row) => row.id === accountId);
    if (!account) return;
    activeAccountId = accountId;
    ui.overviewStatus.textContent = '데이터 불러오는 중';
    ui.accountName.textContent = account.nickname || '게임 계정';
    ui.accountMeta.textContent = (account.server_code ? '서버 ' + account.server_code : '서버 코드 없음') + (account.is_primary ? ' · 기본 계정' : '');
    try {
      const api = data();
      const [generalsPayload, tacticsPayload, equipmentPayload, decksPayload] = await Promise.all([
        api.roster.generals.list(accountId),
        api.roster.tactics.list(accountId),
        api.equipment.list(accountId),
        api.decks.list(accountId),
      ]);
      const generals = rows(generalsPayload);
      const tactics = rows(tacticsPayload);
      const equipment = rows(equipmentPayload);
      const decks = rows(decksPayload);
      ui.generalCount.textContent = text(generals.length);
      ui.tacticCount.textContent = text(tactics.length);
      ui.equipmentCount.textContent = text(equipment.length);
      ui.deckCount.textContent = text(decks.length);
      renderDecks(decks);
      ui.overviewStatus.textContent = '동기화됨';
    } catch (error) {
      ui.overviewStatus.textContent = '불러오기 실패';
      showError(error);
    }
  }

  async function loadAccounts(preferredId) {
    clearError();
    const payload = await data().accounts.list();
    accounts = rows(payload);
    if (!accounts.length) {
      activeAccountId = '';
      ui.accountSelect.replaceChildren();
      ui.accountSelect.disabled = true;
      ui.emptyPanel.hidden = false;
      ui.overviewPanel.hidden = true;
      return;
    }
    ui.accountSelect.disabled = false;
    ui.emptyPanel.hidden = true;
    ui.overviewPanel.hidden = false;
    renderAccountOptions(preferredId);
    await loadOverview(activeAccountId);
  }

  async function bootstrap(user) {
    if (!user) {
      ui.identity.textContent = '로그인하지 않음';
      ui.loginPanel.hidden = false;
      ui.workspace.hidden = true;
      return;
    }
    ui.identity.textContent = user.display_name || user.username || user.id || 'NAKWOL 사용자';
    ui.loginPanel.hidden = true;
    ui.workspace.hidden = false;
    try { await loadAccounts(); } catch (error) { showError(error); }
  }

  window.addEventListener('nakwol-ready', (event) => bootstrap(event.detail));
  window.addEventListener('nakwol-error', (event) => showError(event.detail));

  document.querySelector('#login-button').addEventListener('click', () => connect()?.login());
  document.querySelector('#logout-button').addEventListener('click', async () => { await connect()?.logout(); location.reload(); });
  document.querySelector('#new-account-button').addEventListener('click', openAccountForm);
  document.querySelector('#empty-create-button').addEventListener('click', openAccountForm);
  document.querySelector('#cancel-account-button').addEventListener('click', closeAccountForm);
  document.querySelector('#refresh-button').addEventListener('click', () => loadAccounts(activeAccountId).catch(showError));
  ui.accountSelect.addEventListener('change', () => loadOverview(ui.accountSelect.value));

  ui.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    clearError(); clearMessage(); setBusy(true);
    try {
      const input = {
        nickname: document.querySelector('#nickname').value.trim(),
        server_code: document.querySelector('#server-code').value.trim(),
        is_primary: document.querySelector('#is-primary').checked,
      };
      const created = await data().accounts.create(input);
      closeAccountForm();
      showMessage('게임 계정을 저장했습니다. 이제 이 계정에 장수·전법·장비·덱을 연결할 수 있습니다.');
      await loadAccounts(created?.data?.id || '');
    } catch (error) { showError(error); }
    finally { setBusy(false); }
  });
</script>
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="nakwol-my-data"
  data-ui="headless"
  data-data-scopes="profile:read,profile:write,roster:read,roster:write,equipment:read,equipment:write,decks:read,decks:write"
  data-redirect-uri="https://nakwol-data.sepsd21.workers.dev/my-data">
</script>
</body>
</html>`;
}

export function registerMyDataRoutes(app: Hono<{ Bindings: DataEnv }>): void {
  app.get('/my-data', (c) => c.html(myDataPageHtml()));
}
