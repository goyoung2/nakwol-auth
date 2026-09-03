import type { Hono } from 'hono';
import { myDataPageHtml } from './my-data.ts';
import type { DataEnv } from './types.ts';

const COMPOSITION_SLOTS_MARKER = '<div id="composition-slots" class="composition"></div>';
const CONNECT_SCRIPT_MARKER = '<script\n  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"';

export const MY_DATA_OWNED_FIRST_SCRIPT = String.raw`
  let compositionMode = 'owned';
  let compositionDraft = [];

  const compositionOwnedButton = document.querySelector('#composition-mode-owned');
  const compositionResearchButton = document.querySelector('#composition-mode-research');
  const compositionOwnedWarning = document.querySelector('#composition-owned-warning');

  function compositionOwnedGeneralIds() { return new Set(owned.generals.map((row) => row.general_id)); }
  function compositionOwnedTacticIds() { return new Set(owned.tactics.map((row) => row.tactic_id)); }
  function registryGeneralName(id) { return (registry.generals || []).find((row) => row.id === id)?.name || id; }
  function registryTacticName(id) { return (registry.tactics || []).find((row) => row.id === id)?.name || id; }

  function syncCompositionModeButtons() {
    compositionOwnedButton.className = compositionMode === 'owned' ? 'button small' : 'button secondary small';
    compositionResearchButton.className = compositionMode === 'research' ? 'button small' : 'button secondary small';
    compositionOwnedButton.setAttribute('aria-pressed', compositionMode === 'owned' ? 'true' : 'false');
    compositionResearchButton.setAttribute('aria-pressed', compositionMode === 'research' ? 'true' : 'false');
  }

  function compositionDraftFromDeck(deck) {
    const existing = new Map((deck.generals || []).map((row) => [Number(row.position), row]));
    return [1, 2, 3].map((position) => {
      const current = existing.get(position);
      return {
        position,
        general_id: current?.general_id || '',
        tactic_1: current?.tactics?.find((row) => Number(row.slot) === 1)?.tactic_id || '',
        tactic_2: current?.tactics?.find((row) => Number(row.slot) === 2)?.tactic_id || '',
        weapon_instance_id: current?.weapon?.id || '',
        mount_instance_id: current?.mount?.id || '',
      };
    });
  }

  function captureCompositionDraft() {
    const cards = Array.from(ui.compositionSlots.querySelectorAll('.slot-card'));
    if (!cards.length) return;
    compositionDraft = cards.map((card) => ({
      position: Number(card.dataset.position),
      general_id: card.querySelector('.general-select')?.value || '',
      tactic_1: card.querySelector('.tactic-1')?.value || '',
      tactic_2: card.querySelector('.tactic-2')?.value || '',
      weapon_instance_id: card.querySelector('.weapon-instance')?.value || '',
      mount_instance_id: card.querySelector('.mount-instance')?.value || '',
    }));
  }

  function appendCurrentPair(pairs, currentId, label) {
    if (currentId && !pairs.some((pair) => pair[0] === currentId)) pairs.push([currentId, label]);
    return pairs;
  }

  function selectedDraftIds(field, currentPosition) {
    return new Set(
      compositionDraft
        .filter((row) => Number(row.position) !== Number(currentPosition))
        .map((row) => row[field])
        .filter(Boolean),
    );
  }

  function hideTakenPairs(pairs, currentId, takenIds) {
    return pairs.filter((pair) => !pair[0] || pair[0] === currentId || !takenIds.has(pair[0]));
  }

  function generalPairsForMode(currentId, position) {
    const ownedIds = compositionOwnedGeneralIds();
    const pairs = compositionMode === 'owned'
      ? owned.generals.map((row) => [row.general_id, row.name || row.general_id])
      : (registry.generals || []).filter((row) => row.enabled === 1).map((row) => [row.id, (row.name || row.id) + (ownedIds.has(row.id) ? '' : ' · 미등록 · 연구용')]);
    const withCurrent = appendCurrentPair(pairs, currentId, registryGeneralName(currentId) + ' · 미등록 · 현재 편성');
    return hideTakenPairs(withCurrent, currentId, selectedDraftIds('general_id', position));
  }

  function tacticPairsForMode(currentId) {
    const ownedIds = compositionOwnedTacticIds();
    const pairs = compositionMode === 'owned'
      ? owned.tactics.map((row) => [row.tactic_id, row.name || row.tactic_id])
      : canonicalTactics().map((row) => [row.id, (row.name || row.id) + (ownedIds.has(row.id) ? '' : ' · 미등록 · 연구용')]);
    return appendCurrentPair(pairs, currentId, registryTacticName(currentId) + ' · 미등록 · 현재 편성');
  }

  function equipmentPairs(type, currentId, position, field) {
    const pairs = owned.equipment
      .filter((row) => row.type === type)
      .map((row) => [row.id, (row.nickname || row.template_name) + ' · ' + row.id.slice(-6)]);
    return hideTakenPairs(pairs, currentId, selectedDraftIds(field, position));
  }

  function updateCompositionWarning() {
    const ownedGenerals = compositionOwnedGeneralIds();
    const ownedTactics = compositionOwnedTacticIds();
    let hasUnowned = false;
    for (const row of compositionDraft) {
      if (row.general_id && !ownedGenerals.has(row.general_id)) hasUnowned = true;
      if (row.tactic_1 && !ownedTactics.has(row.tactic_1)) hasUnowned = true;
      if (row.tactic_2 && !ownedTactics.has(row.tactic_2)) hasUnowned = true;
    }
    compositionOwnedWarning.hidden = !hasUnowned;
    compositionOwnedWarning.textContent = hasUnowned
      ? '현재 편성에 미등록 장수/전법이 포함되어 있습니다. 기존 편성은 유지되며, 새 연구 항목을 고르려면 “전체 Registry · 연구용”을 사용하세요.'
      : '';
  }

  function refreshCompositionDuplicateGuards() {
    const generalSelects = Array.from(ui.compositionSlots.querySelectorAll('.general-select'));
    const equipmentSelects = Array.from(ui.compositionSlots.querySelectorAll('.weapon-instance, .mount-instance'));
    const selectedGenerals = new Set(generalSelects.map((select) => select.value).filter(Boolean));
    const selectedEquipment = new Set(equipmentSelects.map((select) => select.value).filter(Boolean));

    for (const select of generalSelects) {
      for (const item of select.options) item.disabled = Boolean(item.value && item.value !== select.value && selectedGenerals.has(item.value));
    }
    for (const select of equipmentSelects) {
      for (const item of select.options) item.disabled = Boolean(item.value && item.value !== select.value && selectedEquipment.has(item.value));
    }
  }

  function onCompositionControlChanged() {
    captureCompositionDraft();
    renderOwnedFirstComposition();
  }

  function renderOwnedFirstComposition() {
    ui.compositionSlots.replaceChildren();
    const byPosition = new Map(compositionDraft.map((row) => [Number(row.position), row]));

    for (const position of [1, 2, 3]) {
      const current = byPosition.get(position) || { position, general_id:'', tactic_1:'', tactic_2:'', weapon_instance_id:'', mount_instance_id:'' };
      const card = element('article', 'slot-card'); card.dataset.position = String(position); card.appendChild(element('div', 'slot-title', position + '번 위치'));
      const grid = element('div', 'slot-grid');
      const general = compositionSelect('general-select', generalPairsForMode(current.general_id, position), current.general_id);
      const tactic1 = compositionSelect('tactic-1', tacticPairsForMode(current.tactic_1), current.tactic_1);
      const tactic2 = compositionSelect('tactic-2', tacticPairsForMode(current.tactic_2), current.tactic_2);
      const weapon = compositionSelect('weapon-instance', equipmentPairs('weapon', current.weapon_instance_id, position, 'weapon_instance_id'), current.weapon_instance_id);
      const mount = compositionSelect('mount-instance', equipmentPairs('mount', current.mount_instance_id, position, 'mount_instance_id'), current.mount_instance_id);
      for (const control of [general, tactic1, tactic2, weapon, mount]) control.addEventListener('change', onCompositionControlChanged);
      grid.append(field('장수', general), field('전법 1', tactic1), field('전법 2', tactic2), field('무기', weapon), field('탈것', mount));
      card.append(grid); ui.compositionSlots.appendChild(card);
    }

    syncCompositionModeButtons();
    refreshCompositionDuplicateGuards();
    updateCompositionWarning();
  }

  async function setCompositionMode(mode) {
    if (mode !== 'owned' && mode !== 'research') return;
    captureCompositionDraft();
    compositionMode = mode;
    renderOwnedFirstComposition();
  }

  openDeckComposition = async function(deckId) {
    const api = data();
    await Promise.all([ensureGeneralRegistry(), ensureTacticRegistry()]);
    const detailPayload = await api.decks.get(activeAccountId, deckId);
    const deck = detailPayload?.data;
    if (!deck) throw new Error('덱 상세 정보를 불러오지 못했습니다.');

    editingDeckId = deckId;
    compositionMode = 'owned';
    compositionDraft = compositionDraftFromDeck(deck);
    ui.compositionTitle.textContent = '덱 편성 · ' + (deck.name || deckId);
    ui.compositionPanel.hidden = false;
    renderOwnedFirstComposition();
    ui.compositionPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const baseLoadAccountData = loadAccountData;
  loadAccountData = async function(accountId) {
    const refreshOpenComposition = Boolean(editingDeckId && !ui.compositionPanel.hidden && accountId === activeAccountId);
    if (refreshOpenComposition) captureCompositionDraft();
    const result = await baseLoadAccountData(accountId);
    if (refreshOpenComposition && editingDeckId && !ui.compositionPanel.hidden && accountId === activeAccountId) {
      renderOwnedFirstComposition();
    }
    return result;
  };

  const baseCloseComposition = closeComposition;
  closeComposition = function() {
    compositionDraft = [];
    compositionMode = 'owned';
    baseCloseComposition();
  };

  compositionOwnedButton.addEventListener('click', () => setCompositionMode('owned'));
  compositionResearchButton.addEventListener('click', () => setCompositionMode('research'));
  syncCompositionModeButtons();
`;

export function myDataOwnedFirstPageHtml(): string {
  const controls = `
          <div id="composition-mode-controls" class="toolbar" style="margin-top:14px" aria-label="덱 편성 항목 범위">
            <span class="muted"><strong>편성 목록</strong></span>
            <button id="composition-mode-owned" class="button small" type="button" aria-pressed="true">내 보유만</button>
            <button id="composition-mode-research" class="button secondary small" type="button">전체 Registry · 연구용</button>
          </div>
          <div id="composition-owned-warning" class="warning-line" hidden></div>
          ${COMPOSITION_SLOTS_MARKER}`;

  const base = myDataPageHtml();
  if (!base.includes(COMPOSITION_SLOTS_MARKER) || !base.includes(CONNECT_SCRIPT_MARKER)) throw new Error('MY_DATA_BASE_CONTRACT_MISMATCH');
  return base
    .replace(COMPOSITION_SLOTS_MARKER, controls)
    .replace(CONNECT_SCRIPT_MARKER, `<script>\n${MY_DATA_OWNED_FIRST_SCRIPT}\n</script>\n${CONNECT_SCRIPT_MARKER}`);
}

export function registerMyDataRoutes(app: Hono<{ Bindings: DataEnv }>): void {
  app.get('/my-data', (c) => c.html(myDataOwnedFirstPageHtml()));
}
