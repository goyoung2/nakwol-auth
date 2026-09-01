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
    button,input,select,textarea{font:inherit}button{cursor:pointer}.shell{width:min(1180px,calc(100% - 32px));margin:0 auto;padding:28px 0 64px}
    .topbar{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:24px}.brand small{display:block;color:#9a6c17;font-weight:800;letter-spacing:.12em}.brand h1{margin:5px 0 0;font-size:clamp(28px,5vw,42px)}.subtitle{margin:8px 0 0;color:#637083;line-height:1.6}.identity{text-align:right;color:#4b5563;font-size:14px}
    .panel{background:#fff;border:1px solid #ddd7c9;border-radius:16px;padding:20px;margin-top:14px;box-shadow:0 10px 28px rgba(65,50,25,.06)}.notice{background:#fff9e9;border:1px solid #e2c882;border-radius:14px;padding:16px;margin-top:14px}.notice.error{background:#fff1f1;border-color:#e6aaaa;color:#922}.notice.success{background:#effaf2;border-color:#a9d5b4;color:#285d36}[hidden]{display:none!important}
    .toolbar{display:flex;align-items:end;gap:12px;flex-wrap:wrap}.field{display:grid;gap:6px}.field.grow{flex:1;min-width:240px}.field label{font-size:12px;font-weight:800;color:#64748b}.control{width:100%;min-height:42px;border:1px solid #cfc8b9;border-radius:10px;padding:9px 11px;background:white;color:#142033}.control:focus{outline:2px solid #c99219;outline-offset:1px;border-color:#c99219}.control.compact{min-height:36px;padding:7px 9px}.control.note{min-width:150px}
    .button{appearance:none;border:0;border-radius:10px;min-height:42px;padding:10px 15px;background:#b27a16;color:white;font-weight:800}.button.secondary{background:#fff;color:#39465a;border:1px solid #cfc8b9}.button.danger{background:#fff;color:#9b2c2c;border:1px solid #e3b5b5}.button.small{min-height:36px;padding:7px 11px;font-size:13px}.button:focus-visible{outline:2px solid #142033;outline-offset:2px}.button:disabled{opacity:.5;cursor:not-allowed}
    .overview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}.metric{border:1px solid #e2ddd1;border-radius:14px;padding:16px;background:#fcfbf8;cursor:pointer}.metric:hover{border-color:#caa866}.metric .label{font-size:12px;color:#718096}.metric .value{font-size:30px;font-weight:900;margin-top:5px}.metric .hint{font-size:12px;color:#8a94a3;margin-top:4px}
    .account-summary{display:flex;justify-content:space-between;gap:14px;align-items:center}.account-name{font-size:20px;font-weight:900}.account-meta{margin-top:4px;color:#6b7280;font-size:13px}.status{font-size:12px;font-weight:800;color:#9a6c17}.empty{text-align:center;padding:34px 16px;color:#64748b}.empty strong{display:block;color:#263244;font-size:19px;margin-bottom:7px}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.check{display:flex;align-items:center;gap:8px;min-height:42px}.form-actions{display:flex;gap:9px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap}.section-title{display:flex;justify-content:space-between;align-items:center;gap:12px}.section-title h2{font-size:18px;margin:0}.section-title p{margin:4px 0 0;color:#778396;font-size:13px}.future{font-size:12px;color:#8a94a3}
    .tabs{display:flex;gap:8px;overflow:auto;padding:4px 0 1px}.tab{white-space:nowrap;border:1px solid #d8d1c3;background:#fff;color:#3f4b5d;border-radius:999px;padding:9px 14px;font-weight:800}.tab[aria-selected="true"]{background:#142033;color:#fff;border-color:#142033}
    .section-page{margin-top:14px}.section-tools{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin:14px 0}.search{flex:1;min-width:220px}.count-pill{font-size:12px;font-weight:800;color:#8a5d0d;background:#fff5d8;border:1px solid #ebd192;border-radius:999px;padding:6px 10px}
    .asset-list{display:grid;gap:9px}.asset-row{border:1px solid #e2ddd1;border-radius:13px;padding:13px;background:#fcfbf8}.asset-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.asset-name{font-weight:900}.asset-meta{font-size:12px;color:#8791a0;margin-top:3px}.owned-mark{font-size:11px;font-weight:900;color:#267044;background:#eaf7ef;border:1px solid #b9dfc6;border-radius:999px;padding:4px 8px}.available-mark{font-size:11px;font-weight:800;color:#7c6335}.asset-controls{display:grid;grid-template-columns:110px 110px minmax(120px,1fr) auto;gap:8px;align-items:end;margin-top:10px}.asset-controls.tactic{grid-template-columns:110px minmax(140px,1fr) auto}.asset-actions{display:flex;gap:7px;flex-wrap:wrap}.inline-check{display:flex;align-items:center;gap:6px;min-height:36px;font-size:13px;color:#536174}
    .equipment-list,.deck-list{display:grid;gap:10px;margin-top:12px}.equipment-row,.deck-row{border:1px solid #e2ddd1;border-radius:13px;padding:14px;background:#fcfbf8}.equipment-controls{display:grid;grid-template-columns:minmax(150px,1fr) auto auto auto;gap:8px;align-items:end;margin-top:10px}.deck-controls{display:grid;grid-template-columns:minmax(170px,1.4fr) 120px 120px minmax(150px,1fr);gap:8px;align-items:end;margin-top:10px}.deck-meta{color:#778396;font-size:12px;margin-top:4px}.deck-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .subpanel{border:1px solid #e4decf;border-radius:14px;padding:16px;background:#fffdf9;margin-top:14px}.subpanel h3{margin:0 0 4px;font-size:16px}.subpanel p{margin:0;color:#7a8595;font-size:13px;line-height:1.55}.muted{color:#7a8595;font-size:13px}.warning-line{margin-top:10px;border-left:3px solid #c99219;padding:8px 10px;background:#fff8e8;color:#6d572d;font-size:13px;line-height:1.5}
    .composition{display:grid;gap:12px;margin-top:14px}.slot-card{border:1px solid #dcd5c7;border-radius:14px;padding:14px;background:#fbfaf7}.slot-title{font-weight:900;margin-bottom:10px}.slot-grid{display:grid;grid-template-columns:1.3fr 1fr 1fr 1fr 1fr;gap:8px}.composition-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
    .screen-reader{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    @media(max-width:900px){.asset-controls,.asset-controls.tactic,.equipment-controls,.deck-controls,.slot-grid{grid-template-columns:1fr 1fr}.asset-actions,.deck-actions{grid-column:1/-1}.slot-grid .field:first-child{grid-column:1/-1}}
    @media(max-width:760px){.shell{width:min(100% - 20px,1180px);padding-top:18px}.topbar{flex-direction:column}.identity{text-align:left}.overview{grid-template-columns:repeat(2,minmax(0,1fr))}.toolbar{display:grid;grid-template-columns:1fr}.field.grow{min-width:0}.toolbar>.button{width:100%}.form-grid{grid-template-columns:1fr}.account-summary{align-items:flex-start;flex-direction:column}.section-title{align-items:flex-start;flex-direction:column}.asset-controls,.asset-controls.tactic,.equipment-controls,.deck-controls,.slot-grid{grid-template-columns:1fr}.asset-actions,.deck-actions{grid-column:auto}.composition-actions .button,.form-actions .button{flex:1}.search{min-width:0;width:100%}}
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

  <section id="message" class="notice success" hidden aria-live="polite"></section>
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
      <div class="section-title"><div><h2>새 게임 계정</h2><p>게임 내 계정을 기준으로 장수·전법·장비·덱을 분리해 저장합니다.</p></div><span class="future">게임 계정 수정/삭제는 현재 API 미지원</span></div>
      <form id="account-form">
        <div class="form-grid" style="margin-top:14px">
          <div class="field"><label for="nickname">게임 닉네임</label><input id="nickname" name="nickname" class="control" required maxlength="80" autocomplete="off" placeholder="예: 고영"></div>
          <div class="field"><label for="server-code">서버 코드</label><input id="server-code" name="server_code" class="control" required maxlength="40" autocomplete="off" placeholder="예: 5"></div>
        </div>
        <label class="check"><input id="is-primary" name="is_primary" type="checkbox"> 이 계정을 기본 계정으로 사용</label>
        <div class="form-actions"><button id="cancel-account-button" class="button secondary" type="button">취소</button><button id="save-account-button" class="button" type="submit">계정 저장</button></div>
      </form>
    </section>

    <section id="empty-panel" class="panel empty" hidden>
      <strong>등록된 게임 계정이 없습니다.</strong>
      게임 계정을 하나 만들면 장수·전법·장비·덱 정보를 이 계정 아래에 저장할 수 있습니다.
      <div class="form-actions" style="justify-content:center"><button id="empty-create-button" class="button" type="button">첫 게임 계정 만들기</button></div>
    </section>

    <section id="account-data" hidden>
      <section class="panel account-summary">
        <div><div id="account-name" class="account-name">-</div><div id="account-meta" class="account-meta">-</div></div>
        <div id="overview-status" class="status">데이터 불러오는 중</div>
      </section>

      <div class="overview" aria-label="내 데이터 요약">
        <article class="metric" data-jump="generals" tabindex="0"><div class="label">내 장수</div><div id="general-count" class="value">-</div><div class="hint">장수 관리</div></article>
        <article class="metric" data-jump="tactics" tabindex="0"><div class="label">내 전법</div><div id="tactic-count" class="value">-</div><div class="hint">전법 관리</div></article>
        <article class="metric" data-jump="equipment" tabindex="0"><div class="label">내 장비</div><div id="equipment-count" class="value">-</div><div class="hint">장비 관리</div></article>
        <article class="metric" data-jump="decks" tabindex="0"><div class="label">내 덱</div><div id="deck-count" class="value">-</div><div class="hint">덱 관리</div></article>
      </div>

      <section class="panel">
        <nav class="tabs" aria-label="My Data 관리 메뉴">
          <button class="tab" type="button" data-section="overview" aria-selected="true">개요</button>
          <button class="tab" type="button" data-section="generals" aria-selected="false">장수 관리</button>
          <button class="tab" type="button" data-section="tactics" aria-selected="false">전법 관리</button>
          <button class="tab" type="button" data-section="equipment" aria-selected="false">장비 관리</button>
          <button class="tab" type="button" data-section="decks" aria-selected="false">덱 관리</button>
        </nav>
      </section>

      <section class="section-page panel" data-section="overview" id="section-overview">
        <div class="section-title"><div><h2>내 덱</h2><p>현재 계정에 저장된 live deck입니다. 다른 낙월 서비스가 같은 deck ID를 읽게 됩니다.</p></div></div>
        <div id="overview-deck-list" class="deck-list"></div>
      </section>

      <section class="section-page panel" data-section="generals" id="section-generals" hidden>
        <div class="section-title"><div><h2>장수 관리</h2><p>Registry 장수를 검색해 보유 등록하고 돌파·승급·즐겨찾기·메모를 관리합니다.</p></div><span id="general-section-count" class="count-pill">0명 보유</span></div>
        <div class="section-tools"><div class="field search"><label for="general-search">장수 검색</label><input id="general-search" class="control" autocomplete="off" placeholder="장수 이름 검색"></div></div>
        <div id="general-list" class="asset-list"></div>
      </section>

      <section class="section-page panel" data-section="tactics" id="section-tactics" hidden>
        <div class="section-title"><div><h2>전법 관리</h2><p>실제 보유 가능한 canonical 전법만 등록 대상으로 표시합니다.</p></div><span id="tactic-section-count" class="count-pill">0개 보유</span></div>
        <div class="section-tools"><div class="field search"><label for="tactic-search">전법 검색</label><input id="tactic-search" class="control" autocomplete="off" placeholder="전법 이름 검색"></div></div>
        <div id="tactic-list" class="asset-list"></div>
      </section>

      <section class="section-page panel" data-section="equipment" id="section-equipment" hidden>
        <div class="section-title"><div><h2>장비 관리</h2><p>무기·탈것 인스턴스를 등록하고 별칭·잠금·즐겨찾기를 관리합니다.</p></div><span id="equipment-section-count" class="count-pill">0개 보유</span></div>
        <div class="warning-line"><strong>장비 특성:</strong> 현재 canonical applicability가 0이라 어떤 특성이 어떤 장비 타입에 적용되는지 검증된 적용 대상 정보가 없습니다. My Data는 임의 특성을 입력하거나 추론하지 않습니다.</div>
        <form id="equipment-create-form" class="subpanel">
          <h3>새 장비 등록</h3><p>Registry 템플릿을 선택해 내 장비 인스턴스를 만듭니다.</p>
          <div class="form-grid" style="margin-top:12px">
            <div class="field"><label for="equipment-template">장비 템플릿</label><select id="equipment-template" class="control" required></select></div>
            <div class="field"><label for="equipment-nickname">별칭</label><input id="equipment-nickname" class="control" autocomplete="off" placeholder="선택 사항"></div>
          </div>
          <div class="toolbar" style="margin-top:8px"><label class="inline-check"><input id="equipment-locked" type="checkbox"> 잠금</label><label class="inline-check"><input id="equipment-favorite" type="checkbox"> 즐겨찾기</label><button class="button small" type="submit">장비 등록</button></div>
        </form>
        <div id="equipment-list" class="equipment-list"></div>
      </section>

      <section class="section-page panel" data-section="decks" id="section-decks" hidden>
        <div class="section-title"><div><h2>덱 관리</h2><p>덱 메타데이터와 편성을 관리합니다. 장수·전법 보유 등록을 먼저 끝내지 않아도 Registry에서 바로 편성할 수 있습니다.</p></div><span id="deck-section-count" class="count-pill">0개</span></div>
        <form id="deck-create-form" class="subpanel">
          <h3>새 덱 만들기</h3><p>먼저 덱을 만든 뒤 편성에서 장수·전법·장비를 연결합니다.</p>
          <div class="form-grid" style="margin-top:12px">
            <div class="field"><label for="deck-name">덱 이름</label><input id="deck-name" class="control" required autocomplete="off" placeholder="예: 연무대회 1군"></div>
            <div class="field"><label for="deck-note">메모</label><input id="deck-note" class="control" autocomplete="off" placeholder="선택 사항"></div>
            <div class="field"><label for="deck-status">상태</label><select id="deck-status" class="control"><option value="active">활성</option><option value="candidate">후보</option><option value="research">연구</option><option value="archived">보관</option></select></div>
            <div class="field"><label for="deck-visibility">공개 범위</label><select id="deck-visibility" class="control"><option value="private">비공개</option><option value="alliance">연맹</option><option value="public">공개</option></select></div>
          </div>
          <div class="toolbar" style="margin-top:8px"><label class="inline-check"><input id="deck-primary" type="checkbox"> 기본 덱</label><button class="button small" type="submit">덱 생성</button></div>
        </form>
        <div id="deck-list" class="deck-list"></div>
        <section id="composition-panel" class="subpanel" hidden>
          <div class="section-title"><div><h3 id="composition-title">덱 편성</h3><p>최대 장수 3명, 장수별 전법 2개, 보유 무기·탈것을 연결합니다.</p></div><button id="close-composition-button" class="button secondary small" type="button">편성 닫기</button></div>
          <div id="composition-slots" class="composition"></div>
          <div class="composition-actions"><button id="save-composition-button" class="button" type="button">편성 저장</button></div>
        </section>
      </section>
    </section>
  </section>
</main>

<script>
  const ui = {
    identity: document.querySelector('#identity'), message: document.querySelector('#message'), error: document.querySelector('#error'),
    loginPanel: document.querySelector('#login-panel'), workspace: document.querySelector('#workspace'), accountSelect: document.querySelector('#account-select'),
    accountFormPanel: document.querySelector('#account-form-panel'), accountForm: document.querySelector('#account-form'), saveAccountButton: document.querySelector('#save-account-button'),
    emptyPanel: document.querySelector('#empty-panel'), accountData: document.querySelector('#account-data'), accountName: document.querySelector('#account-name'), accountMeta: document.querySelector('#account-meta'), overviewStatus: document.querySelector('#overview-status'),
    generalCount: document.querySelector('#general-count'), tacticCount: document.querySelector('#tactic-count'), equipmentCount: document.querySelector('#equipment-count'), deckCount: document.querySelector('#deck-count'),
    overviewDeckList: document.querySelector('#overview-deck-list'), generalList: document.querySelector('#general-list'), tacticList: document.querySelector('#tactic-list'), equipmentList: document.querySelector('#equipment-list'), deckList: document.querySelector('#deck-list'),
    generalSearch: document.querySelector('#general-search'), tacticSearch: document.querySelector('#tactic-search'), equipmentTemplate: document.querySelector('#equipment-template'),
    generalSectionCount: document.querySelector('#general-section-count'), tacticSectionCount: document.querySelector('#tactic-section-count'), equipmentSectionCount: document.querySelector('#equipment-section-count'), deckSectionCount: document.querySelector('#deck-section-count'),
    compositionPanel: document.querySelector('#composition-panel'), compositionSlots: document.querySelector('#composition-slots'), compositionTitle: document.querySelector('#composition-title'), saveCompositionButton: document.querySelector('#save-composition-button'),
  };

  let accounts = [];
  let activeAccountId = '';
  let activeSection = 'overview';
  let accountBusy = false;
  let editingDeckId = '';
  const owned = { generals: [], tactics: [], equipment: [], decks: [] };
  const registry = { generals: null, tactics: null, equipment: null };

  function connect() { return window.NAKWOL_CONNECT; }
  function data() { return connect()?.data; }
  function rows(payload) { return Array.isArray(payload?.data) ? payload.data : []; }
  function text(value) { return value == null ? '' : String(value); }
  function lower(value) { return text(value).toLocaleLowerCase('ko'); }
  function byId(list, key) { return new Map(list.map((row) => [row[key], row])); }

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = text(content);
    return node;
  }
  function option(value, label, selected) {
    const node = document.createElement('option'); node.value = value; node.textContent = label; node.selected = Boolean(selected); return node;
  }
  function field(labelText, control) {
    const wrap = element('div', 'field'); const label = element('label', '', labelText); wrap.append(label, control); return wrap;
  }
  function checkbox(labelText, checked) {
    const label = element('label', 'inline-check'); const input = document.createElement('input'); input.type = 'checkbox'; input.checked = Boolean(checked); label.append(input, document.createTextNode(' ' + labelText)); return { wrap: label, input };
  }
  function breakthroughSelect(value) {
    const select = element('select', 'control compact');
    for (let i = 0; i <= 5; i += 1) select.appendChild(option(String(i), String(i), Number(value) === i));
    return select;
  }
  function selectFromPairs(pairs, current) {
    const select = element('select', 'control compact');
    for (const pair of pairs) select.appendChild(option(pair[0], pair[1], pair[0] === current));
    if (current && !pairs.some((pair) => pair[0] === current)) select.appendChild(option(current, '현재 항목 · ' + current, true));
    return select;
  }
  function showError(error) {
    const code = error?.code ? '[' + error.code + '] ' : '';
    ui.error.textContent = code + (error?.message || text(error) || '요청을 처리하지 못했습니다.');
    ui.error.hidden = false;
  }
  function clearError() { ui.error.hidden = true; ui.error.textContent = ''; }
  function showMessage(message) { ui.message.textContent = message; ui.message.hidden = false; }
  function clearMessage() { ui.message.hidden = true; ui.message.textContent = ''; }
  async function withButton(button, action) {
    if (!button || button.disabled) return;
    button.disabled = true; clearError(); clearMessage();
    try { await action(); } catch (error) { showError(error); }
    finally { button.disabled = false; }
  }

  function openAccountForm() { clearError(); clearMessage(); ui.accountForm.reset(); ui.accountFormPanel.hidden = false; document.querySelector('#nickname').focus(); }
  function closeAccountForm() { ui.accountFormPanel.hidden = true; }

  function renderAccountOptions(preferredId) {
    ui.accountSelect.replaceChildren();
    for (const account of accounts) {
      ui.accountSelect.appendChild(option(account.id, (account.nickname || account.id) + (account.server_code ? ' · 서버 ' + account.server_code : '') + (account.is_primary ? ' · 기본' : ''), false));
    }
    const preferred = accounts.find((row) => row.id === preferredId);
    const primary = accounts.find((row) => row.is_primary === true || row.is_primary === 1);
    activeAccountId = (preferred || primary || accounts[0])?.id || '';
    ui.accountSelect.value = activeAccountId;
  }

  function updateCounts() {
    ui.generalCount.textContent = text(owned.generals.length); ui.tacticCount.textContent = text(owned.tactics.length); ui.equipmentCount.textContent = text(owned.equipment.length); ui.deckCount.textContent = text(owned.decks.length);
    ui.generalSectionCount.textContent = owned.generals.length + '명 보유'; ui.tacticSectionCount.textContent = owned.tactics.length + '개 보유'; ui.equipmentSectionCount.textContent = owned.equipment.length + '개 보유'; ui.deckSectionCount.textContent = owned.decks.length + '개';
  }

  function renderOverviewDecks() {
    ui.overviewDeckList.replaceChildren();
    if (!owned.decks.length) { const empty = element('div', 'empty', '아직 등록된 덱이 없습니다.'); ui.overviewDeckList.appendChild(empty); return; }
    for (const deck of owned.decks.slice(0, 8)) {
      const row = element('div', 'deck-row'); const head = element('div', 'asset-head');
      const info = element('div'); info.append(element('div', 'asset-name', deck.name || '이름 없는 덱'), element('div', 'deck-meta', (deck.general_count || 0) + '장수 · ' + (deck.tactic_count || 0) + '전법 · ' + (deck.visibility || 'private')));
      const button = element('button', 'button secondary small', '덱 관리'); button.type = 'button'; button.addEventListener('click', () => switchSection('decks'));
      head.append(info, button); row.append(head); ui.overviewDeckList.appendChild(row);
    }
  }

  async function loadAccountData(accountId) {
    if (!accountId) return;
    clearError(); const account = accounts.find((row) => row.id === accountId); if (!account) return;
    activeAccountId = accountId; ui.overviewStatus.textContent = '데이터 불러오는 중'; ui.accountName.textContent = account.nickname || '게임 계정';
    ui.accountMeta.textContent = (account.server_code ? '서버 ' + account.server_code : '서버 코드 없음') + (account.is_primary ? ' · 기본 계정' : '');
    const api = data();
    try {
      const [generalsPayload, tacticsPayload, equipmentPayload, decksPayload] = await Promise.all([
        api.roster.generals.list(accountId), api.roster.tactics.list(accountId), api.equipment.list(accountId), api.decks.list(accountId),
      ]);
      owned.generals = rows(generalsPayload); owned.tactics = rows(tacticsPayload); owned.equipment = rows(equipmentPayload); owned.decks = rows(decksPayload);
      updateCounts(); renderOverviewDecks(); ui.overviewStatus.textContent = '동기화됨';
      await prepareSection(activeSection);
    } catch (error) { ui.overviewStatus.textContent = '불러오기 실패'; showError(error); }
  }

  async function loadAccounts(preferredId) {
    clearError(); const payload = await data().accounts.list(); accounts = rows(payload);
    if (!accounts.length) {
      activeAccountId = ''; ui.accountSelect.replaceChildren(); ui.accountSelect.disabled = true; ui.emptyPanel.hidden = false; ui.accountData.hidden = true; return;
    }
    ui.accountSelect.disabled = false; ui.emptyPanel.hidden = true; ui.accountData.hidden = false; renderAccountOptions(preferredId); await loadAccountData(activeAccountId);
  }

  async function ensureGeneralRegistry() {
    if (registry.generals) return registry.generals;
    const api = data(); registry.generals = rows(await api.registry.generals({ includeHidden: true })); return registry.generals;
  }
  async function ensureTacticRegistry() {
    if (!registry.tactics) { const api = data(); registry.tactics = rows(await api.registry.tactics()); }
    await ensureGeneralRegistry(); return registry.tactics;
  }
  async function ensureEquipmentRegistry() {
    if (registry.equipment) return registry.equipment;
    const api = data(); registry.equipment = rows(await api.registry.equipment()); return registry.equipment;
  }
  function canonicalTactics() {
    const unique = new Set((registry.generals || []).map((row) => row.unique_tactic_id).filter(Boolean));
    return (registry.tactics || []).filter((row) => {
      const m = row.metadata || {};
      return row.enabled === 1
        && Number(m.skill_class_raw) === 5
        && Number(m.learn_times) === 1
        && Number(m.get_type) === 3
        && Number(m.is_copy || 0) === 0
        && Number(m.chip_id || 0) > 0
        && !unique.has(row.id);
    });
  }

  function makeGeneralRow(row, current) {
    const card = element('article', 'asset-row'); const head = element('div', 'asset-head'); const info = element('div');
    info.append(element('div', 'asset-name', row.name || row.id), element('div', 'asset-meta', (row.rarity ? '희귀도 ' + row.rarity + ' · ' : '') + row.id));
    head.append(info, element('span', current ? 'owned-mark' : 'available-mark', current ? '보유 중' : (row.enabled === 1 ? '미등록' : '등록 불가'))); card.append(head);
    const controls = element('div', 'asset-controls'); const breakthrough = breakthroughSelect(current?.breakthrough ?? 0);
    const promotion = element('input', 'control compact'); promotion.type = 'number'; promotion.min = '0'; promotion.step = '1'; promotion.value = String(current?.promotion ?? 0);
    const note = element('input', 'control compact note'); note.value = current?.note || ''; note.placeholder = '메모';
    const fav = checkbox('즐겨찾기', current?.favorite === true);
    controls.append(field('돌파', breakthrough), field('승급', promotion));
    const noteField = field('메모', note); noteField.appendChild(fav.wrap); controls.append(noteField);
    const actions = element('div', 'asset-actions'); const save = element('button', 'button small', current ? '저장' : '보유 등록'); save.type = 'button'; save.disabled = !current && row.enabled !== 1;
    save.addEventListener('click', () => withButton(save, async () => {
      const api = data(); await api.roster.generals.upsert(activeAccountId, row.id, { breakthrough: Number(breakthrough.value), promotion: Number(promotion.value), favorite: fav.input.checked, note: note.value.trim() || null });
      showMessage((row.name || '장수') + ' 정보를 저장했습니다.'); await loadAccountData(activeAccountId);
    })); actions.append(save);
    if (current) { const remove = element('button', 'button danger small', '삭제'); remove.type = 'button'; remove.addEventListener('click', () => withButton(remove, async () => { if (!confirm((row.name || '장수') + ' 보유 정보를 삭제할까요?')) return; const api = data(); await api.roster.generals.remove(activeAccountId, row.id); showMessage((row.name || '장수') + ' 보유 정보를 삭제했습니다.'); await loadAccountData(activeAccountId); })); actions.append(remove); }
    controls.append(actions); card.append(controls); return card;
  }

  async function renderGenerals() {
    const all = await ensureGeneralRegistry(); const currentMap = byId(owned.generals, 'general_id'); const query = lower(ui.generalSearch.value).trim();
    const visible = all.filter((row) => (row.enabled === 1 || currentMap.has(row.id)) && (!query || lower(row.name).includes(query) || lower(row.id).includes(query)));
    ui.generalList.replaceChildren();
    if (!visible.length) { ui.generalList.appendChild(element('div', 'empty', '검색 결과가 없습니다.')); return; }
    for (const row of visible) ui.generalList.appendChild(makeGeneralRow(row, currentMap.get(row.id)));
  }

  function makeTacticRow(row, current) {
    const card = element('article', 'asset-row'); const head = element('div', 'asset-head'); const info = element('div');
    info.append(element('div', 'asset-name', row.name || row.id), element('div', 'asset-meta', (row.category || '전법') + ' · ' + row.id)); head.append(info, element('span', current ? 'owned-mark' : 'available-mark', current ? '보유 중' : '미등록')); card.append(head);
    const controls = element('div', 'asset-controls tactic'); const breakthrough = breakthroughSelect(current?.breakthrough ?? 0); const note = element('input', 'control compact note'); note.value = current?.note || ''; note.placeholder = '메모';
    const fav = checkbox('즐겨찾기', current?.favorite === true); const noteField = field('메모', note); noteField.appendChild(fav.wrap); controls.append(field('돌파', breakthrough), noteField);
    const actions = element('div', 'asset-actions'); const save = element('button', 'button small', current ? '저장' : '보유 등록'); save.type = 'button';
    save.addEventListener('click', () => withButton(save, async () => { const api = data(); await api.roster.tactics.upsert(activeAccountId, row.id, { breakthrough: Number(breakthrough.value), favorite: fav.input.checked, note: note.value.trim() || null }); showMessage((row.name || '전법') + ' 정보를 저장했습니다.'); await loadAccountData(activeAccountId); })); actions.append(save);
    if (current) { const remove = element('button', 'button danger small', '삭제'); remove.type = 'button'; remove.addEventListener('click', () => withButton(remove, async () => { if (!confirm((row.name || '전법') + ' 보유 정보를 삭제할까요?')) return; const api = data(); await api.roster.tactics.remove(activeAccountId, row.id); showMessage((row.name || '전법') + ' 보유 정보를 삭제했습니다.'); await loadAccountData(activeAccountId); })); actions.append(remove); }
    controls.append(actions); card.append(controls); return card;
  }

  async function renderTactics() {
    await ensureTacticRegistry(); const currentMap = byId(owned.tactics, 'tactic_id'); const query = lower(ui.tacticSearch.value).trim();
    const visible = canonicalTactics().filter((row) => !query || lower(row.name).includes(query) || lower(row.id).includes(query)); ui.tacticList.replaceChildren();
    if (!visible.length) { ui.tacticList.appendChild(element('div', 'empty', '검색 결과가 없습니다.')); return; }
    for (const row of visible) ui.tacticList.appendChild(makeTacticRow(row, currentMap.get(row.id)));
  }

  async function populateEquipmentTemplates() {
    const all = await ensureEquipmentRegistry(); const current = ui.equipmentTemplate.value; ui.equipmentTemplate.replaceChildren();
    ui.equipmentTemplate.appendChild(option('', '장비를 선택하세요', false));
    for (const row of all) ui.equipmentTemplate.appendChild(option(row.id, (row.type === 'weapon' ? '무기 · ' : '탈것 · ') + row.name, row.id === current));
  }

  function renderEquipment() {
    ui.equipmentList.replaceChildren();
    if (!owned.equipment.length) { ui.equipmentList.appendChild(element('div', 'empty', '아직 등록된 장비가 없습니다.')); return; }
    for (const item of owned.equipment) {
      const card = element('article', 'equipment-row'); const head = element('div', 'asset-head'); const info = element('div');
      info.append(element('div', 'asset-name', item.nickname || item.template_name || item.id), element('div', 'asset-meta', (item.type === 'weapon' ? '무기 · ' : '탈것 · ') + item.template_name + ' · ' + item.id)); head.append(info, element('span', 'owned-mark', '보유 중')); card.append(head);
      const controls = element('div', 'equipment-controls'); const nickname = element('input', 'control compact'); nickname.value = item.nickname || ''; nickname.placeholder = '별칭';
      const locked = checkbox('잠금', item.locked === true); const favorite = checkbox('즐겨찾기', item.favorite === true); const actions = element('div', 'asset-actions');
      const save = element('button', 'button small', '저장'); save.type = 'button'; save.addEventListener('click', () => withButton(save, async () => { const api = data(); await api.equipment.update(activeAccountId, item.id, { nickname: nickname.value.trim() || null, locked: locked.input.checked, favorite: favorite.input.checked }); showMessage((item.nickname || item.template_name) + ' 장비를 저장했습니다.'); await loadAccountData(activeAccountId); }));
      const remove = element('button', 'button danger small', '삭제'); remove.type = 'button'; remove.addEventListener('click', () => withButton(remove, async () => { if (!confirm((item.nickname || item.template_name) + ' 장비를 삭제할까요? 덱에서 참조 중이면 편성을 먼저 변경해야 할 수 있습니다.')) return; const api = data(); await api.equipment.remove(activeAccountId, item.id); showMessage('장비를 삭제했습니다.'); await loadAccountData(activeAccountId); }));
      actions.append(save, remove); controls.append(field('별칭', nickname), locked.wrap, favorite.wrap, actions); card.append(controls); ui.equipmentList.appendChild(card);
    }
  }

  function deckStatusPairs() { return [['active','활성'],['candidate','후보'],['research','연구'],['archived','보관']]; }
  function deckVisibilityPairs() { return [['private','비공개'],['alliance','연맹'],['public','공개']]; }
  function closeComposition() { editingDeckId = ''; ui.compositionPanel.hidden = true; ui.compositionSlots.replaceChildren(); }

  async function renderDecks() {
    ui.deckList.replaceChildren();
    if (!owned.decks.length) { ui.deckList.appendChild(element('div', 'empty', '아직 등록된 덱이 없습니다.')); closeComposition(); return; }
    for (const deck of owned.decks) {
      const card = element('article', 'deck-row'); const head = element('div', 'asset-head'); const info = element('div');
      info.append(element('div', 'asset-name', deck.name || '이름 없는 덱'), element('div', 'deck-meta', (deck.general_count || 0) + '장수 · ' + (deck.tactic_count || 0) + '전법 · ' + (deck.equipment_count || 0) + '장비 · ' + deck.id)); head.append(info, element('span', deck.is_primary ? 'owned-mark' : 'available-mark', deck.is_primary ? '기본 덱' : 'live deck')); card.append(head);
      const controls = element('div', 'deck-controls'); const name = element('input', 'control compact'); name.value = deck.name || ''; const status = selectFromPairs(deckStatusPairs(), deck.status); const visibility = selectFromPairs(deckVisibilityPairs(), deck.visibility); const note = element('input', 'control compact'); note.value = deck.note || ''; note.placeholder = '메모';
      controls.append(field('덱 이름', name), field('상태', status), field('공개 범위', visibility), field('메모', note)); card.append(controls);
      const primary = checkbox('기본 덱', deck.is_primary === true); const actions = element('div', 'deck-actions'); actions.append(primary.wrap);
      const save = element('button', 'button small', '저장'); save.type = 'button'; save.addEventListener('click', () => withButton(save, async () => { const api = data(); await api.decks.update(activeAccountId, deck.id, { name: name.value.trim(), status: status.value, visibility: visibility.value, note: note.value.trim() || null, is_primary: primary.input.checked }); showMessage((deck.name || '덱') + ' 정보를 저장했습니다.'); await loadAccountData(activeAccountId); }));
      const composition = element('button', 'button secondary small', '덱 편성'); composition.type = 'button'; composition.addEventListener('click', () => withButton(composition, () => openDeckComposition(deck.id)));
      const remove = element('button', 'button danger small', '삭제'); remove.type = 'button'; remove.addEventListener('click', () => withButton(remove, async () => { if (!confirm((deck.name || '덱') + '을 삭제할까요? live deck은 삭제되지만 기존 스냅샷은 불변 기록으로 남습니다.')) return; const api = data(); await api.decks.remove(activeAccountId, deck.id); if (editingDeckId === deck.id) closeComposition(); showMessage('덱을 삭제했습니다.'); await loadAccountData(activeAccountId); }));
      actions.append(save, composition, remove); card.append(actions); ui.deckList.appendChild(card);
    }
  }

  function compositionSelect(className, pairs, current) { const select = selectFromPairs([['','선택 안 함'], ...pairs], current || ''); select.classList.add(className); return select; }
  async function openDeckComposition(deckId) {
    const api = data(); await Promise.all([ensureGeneralRegistry(), ensureTacticRegistry()]); const detailPayload = await api.decks.get(activeAccountId, deckId); const deck = detailPayload?.data; if (!deck) throw new Error('덱 상세 정보를 불러오지 못했습니다.');
    editingDeckId = deckId; ui.compositionTitle.textContent = '덱 편성 · ' + (deck.name || deckId); ui.compositionPanel.hidden = false; ui.compositionSlots.replaceChildren();
    const generalPairs = (registry.generals || []).filter((row) => row.enabled === 1).map((row) => [row.id, row.name]);
    const tacticPairs = canonicalTactics().map((row) => [row.id, row.name]);
    const weaponPairs = owned.equipment.filter((row) => row.type === 'weapon').map((row) => [row.id, (row.nickname || row.template_name) + ' · ' + row.id.slice(-6)]);
    const mountPairs = owned.equipment.filter((row) => row.type === 'mount').map((row) => [row.id, (row.nickname || row.template_name) + ' · ' + row.id.slice(-6)]);
    const existing = new Map((deck.generals || []).map((row) => [Number(row.position), row]));
    for (const position of [1, 2, 3]) {
      const current = existing.get(position); const card = element('article', 'slot-card'); card.dataset.position = String(position); card.appendChild(element('div', 'slot-title', position + '번 위치'));
      const grid = element('div', 'slot-grid');
      const general = compositionSelect('general-select', generalPairs, current?.general_id || '');
      const t1 = current?.tactics?.find((row) => Number(row.slot) === 1); const t2 = current?.tactics?.find((row) => Number(row.slot) === 2);
      const tactic1 = compositionSelect('tactic-1', tacticPairs, t1?.tactic_id || ''); const tactic2 = compositionSelect('tactic-2', tacticPairs, t2?.tactic_id || '');
      const weapon = compositionSelect('weapon-instance', weaponPairs, current?.weapon?.id || ''); const mount = compositionSelect('mount-instance', mountPairs, current?.mount?.id || '');
      grid.append(field('장수', general), field('전법 1', tactic1), field('전법 2', tactic2), field('무기', weapon), field('탈것', mount)); card.append(grid); ui.compositionSlots.appendChild(card);
    }
    ui.compositionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function saveComposition(button) {
    if (!editingDeckId) return;
    await withButton(button, async () => {
      const composition = [];
      for (const card of ui.compositionSlots.querySelectorAll('.slot-card')) {
        const generalId = card.querySelector('.general-select').value; if (!generalId) continue;
        const position = Number(card.dataset.position); const tactic1 = card.querySelector('.tactic-1').value; const tactic2 = card.querySelector('.tactic-2').value;
        const weapon = card.querySelector('.weapon-instance').value; const mount = card.querySelector('.mount-instance').value; const tactics = [];
        if (tactic1) tactics.push({ slot: 1, tactic_id: tactic1 }); if (tactic2) tactics.push({ slot: 2, tactic_id: tactic2 });
        const row = { position, general_id: generalId, tactics }; if (weapon) row.weapon_instance_id = weapon; if (mount) row.mount_instance_id = mount; composition.push(row);
      }
      const api = data(); await api.decks.replaceComposition(activeAccountId, editingDeckId, { generals: composition }); showMessage('덱 편성을 저장했습니다.'); const keep = editingDeckId; await loadAccountData(activeAccountId); await openDeckComposition(keep);
    });
  }

  async function prepareSection(section) {
    if (!activeAccountId) return;
    if (section === 'generals') await renderGenerals();
    else if (section === 'tactics') await renderTactics();
    else if (section === 'equipment') { await populateEquipmentTemplates(); renderEquipment(); }
    else if (section === 'decks') await renderDecks();
    else renderOverviewDecks();
  }
  async function switchSection(section) {
    activeSection = section; clearError();
    document.querySelectorAll('.tab').forEach((button) => button.setAttribute('aria-selected', button.dataset.section === section ? 'true' : 'false'));
    document.querySelectorAll('.section-page').forEach((page) => { page.hidden = page.dataset.section !== section; });
    try { await prepareSection(section); } catch (error) { showError(error); }
  }

  async function bootstrap(user) {
    if (!user) { ui.identity.textContent = '로그인하지 않음'; ui.loginPanel.hidden = false; ui.workspace.hidden = true; return; }
    ui.identity.textContent = user.display_name || user.username || user.id || 'NAKWOL 사용자'; ui.loginPanel.hidden = true; ui.workspace.hidden = false;
    try { await loadAccounts(); } catch (error) { showError(error); }
  }

  window.addEventListener('nakwol-ready', (event) => bootstrap(event.detail));
  window.addEventListener('nakwol-error', (event) => showError(event.detail));
  document.querySelector('#login-button').addEventListener('click', () => connect()?.login());
  document.querySelector('#logout-button').addEventListener('click', async () => { await connect()?.logout(); location.reload(); });
  document.querySelector('#new-account-button').addEventListener('click', openAccountForm); document.querySelector('#empty-create-button').addEventListener('click', openAccountForm); document.querySelector('#cancel-account-button').addEventListener('click', closeAccountForm);
  document.querySelector('#refresh-button').addEventListener('click', () => loadAccounts(activeAccountId).catch(showError)); ui.accountSelect.addEventListener('change', () => { closeComposition(); loadAccountData(ui.accountSelect.value); });
  document.querySelectorAll('.tab').forEach((button) => button.addEventListener('click', () => switchSection(button.dataset.section)));
  document.querySelectorAll('[data-jump]').forEach((card) => { const jump = () => switchSection(card.dataset.jump); card.addEventListener('click', jump); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); jump(); } }); });
  ui.generalSearch.addEventListener('input', () => renderGenerals().catch(showError)); ui.tacticSearch.addEventListener('input', () => renderTactics().catch(showError));
  document.querySelector('#close-composition-button').addEventListener('click', closeComposition); ui.saveCompositionButton.addEventListener('click', () => saveComposition(ui.saveCompositionButton));

  ui.accountForm.addEventListener('submit', async (event) => {
    event.preventDefault(); if (accountBusy) return; accountBusy = true; ui.saveAccountButton.disabled = true; clearError(); clearMessage();
    try {
      const input = { nickname: document.querySelector('#nickname').value.trim(), server_code: document.querySelector('#server-code').value.trim(), is_primary: document.querySelector('#is-primary').checked };
      const created = await data().accounts.create(input); closeAccountForm(); showMessage('게임 계정을 저장했습니다. 이제 이 계정에 장수·전법·장비·덱을 연결할 수 있습니다.'); await loadAccounts(created?.data?.id || '');
    } catch (error) { showError(error); } finally { accountBusy = false; ui.saveAccountButton.disabled = false; }
  });

  document.querySelector('#equipment-create-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = event.submitter || form.querySelector('button[type="submit"]');
    await withButton(button, async () => {
      const templateId = ui.equipmentTemplate.value; if (!templateId) throw new Error('장비 템플릿을 선택해 주세요.'); const api = data();
      await api.equipment.create(activeAccountId, { template_id: templateId, nickname: document.querySelector('#equipment-nickname').value.trim() || null, locked: document.querySelector('#equipment-locked').checked, favorite: document.querySelector('#equipment-favorite').checked });
      form.reset(); showMessage('장비를 등록했습니다.'); await loadAccountData(activeAccountId);
    });
  });

  document.querySelector('#deck-create-form').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const button = event.submitter || form.querySelector('button[type="submit"]');
    await withButton(button, async () => {
      const name = document.querySelector('#deck-name').value.trim(); if (!name) throw new Error('덱 이름을 입력해 주세요.'); const api = data();
      const created = await api.decks.create(activeAccountId, { name, status: document.querySelector('#deck-status').value, visibility: document.querySelector('#deck-visibility').value, note: document.querySelector('#deck-note').value.trim() || null, is_primary: document.querySelector('#deck-primary').checked });
      form.reset(); showMessage('덱을 만들었습니다. 편성에서 장수와 전법을 연결할 수 있습니다.'); await loadAccountData(activeAccountId); if (created?.data?.id) await openDeckComposition(created.data.id);
    });
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
