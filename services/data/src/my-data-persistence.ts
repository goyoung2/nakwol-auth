import type { Hono } from 'hono';
import { myDataOwnedFirstPageHtml } from './my-data-owned-first.ts';
import type { DataEnv } from './types.ts';

const MESSAGE_MARKER = '<section id="message" class="notice success" hidden aria-live="polite"></section>';
const CONNECT_SCRIPT_MARKER = '<script\n  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"';

export const MY_DATA_PERSISTENCE_SCRIPT = String.raw`
  const persistenceStatus = document.querySelector('#persistence-status');
  const persistenceBaseData = data;
  const persistenceBaseShowMessage = showMessage;
  let persistenceVerifiedAction = null;
  let persistenceVerifiedAt = null;

  function persistenceRows(payload) {
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  function persistenceBoolean(value) {
    return value === true || value === 1;
  }

  function persistenceNullable(value) {
    return value === undefined || value === null || value === '' ? null : String(value);
  }

  function persistenceOwn(input, key) {
    return Boolean(input && Object.prototype.hasOwnProperty.call(input, key));
  }

  function persistenceSetState(kind, message) {
    persistenceStatus.hidden = false;
    persistenceStatus.className = kind === 'verified' ? 'notice success' : (kind === 'request-failed' ? 'notice error' : 'notice');
    persistenceStatus.textContent = message;
  }

  function persistenceTime(date) {
    return new Intl.DateTimeFormat('ko-KR', { hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date);
  }

  function persistenceVerified(action) {
    persistenceVerifiedAction = action;
    persistenceVerifiedAt = new Date();
    persistenceSetState('verified', action + ' 확인됨 · ' + persistenceTime(persistenceVerifiedAt));
  }

  function persistenceVerifyError(cause) {
    const error = new Error('저장 요청은 성공했지만 재확인하지 못했습니다. 새로고침해 확인하세요.');
    error.code = 'PERSISTENCE_VERIFY_FAILED';
    error.cause = cause;
    return error;
  }

  async function persistenceMutation(action, mutate, verify) {
    persistenceSetState('pending', action + ' 중 · 서버 반영 후 재확인합니다.');
    let result;
    try {
      result = await mutate();
    } catch (error) {
      persistenceSetState('request-failed', action + ' 요청 실패');
      throw error;
    }
    try {
      const confirmed = await verify(result);
      if (!confirmed) throw new Error('PERSISTED_VALUE_MISMATCH');
      persistenceVerified(action);
      return result;
    } catch (error) {
      persistenceVerifiedAction = null;
      persistenceVerifiedAt = null;
      persistenceSetState('uncertain', action + ' 요청 성공 · 재확인 실패');
      throw persistenceVerifyError(error);
    }
  }

  function persistenceAccountMatches(row, input) {
    if (!row) return false;
    return row.nickname === input.nickname
      && row.server_code === input.server_code
      && persistenceBoolean(row.is_primary) === Boolean(input.is_primary);
  }

  function persistenceGeneralMatches(row, input) {
    if (!row) return false;
    return Number(row.breakthrough) === Number(input.breakthrough ?? 0)
      && Number(row.promotion) === Number(input.promotion ?? 0)
      && persistenceBoolean(row.favorite) === Boolean(input.favorite)
      && persistenceNullable(row.note) === persistenceNullable(input.note);
  }

  function persistenceTacticMatches(row, input) {
    if (!row) return false;
    return Number(row.breakthrough) === Number(input.breakthrough ?? 0)
      && persistenceBoolean(row.favorite) === Boolean(input.favorite)
      && persistenceNullable(row.note) === persistenceNullable(input.note);
  }

  function persistenceEquipmentMatches(row, input) {
    if (!row) return false;
    if (persistenceOwn(input, 'template_id') && row.template_id !== input.template_id) return false;
    if (persistenceOwn(input, 'nickname') && persistenceNullable(row.nickname) !== persistenceNullable(input.nickname)) return false;
    if (persistenceOwn(input, 'locked') && persistenceBoolean(row.locked) !== Boolean(input.locked)) return false;
    if (persistenceOwn(input, 'favorite') && persistenceBoolean(row.favorite) !== Boolean(input.favorite)) return false;
    return true;
  }

  function persistenceDeckMatches(row, input) {
    if (!row) return false;
    if (persistenceOwn(input, 'name') && row.name !== input.name) return false;
    if (persistenceOwn(input, 'status') && row.status !== input.status) return false;
    if (persistenceOwn(input, 'visibility') && row.visibility !== input.visibility) return false;
    if (persistenceOwn(input, 'note') && persistenceNullable(row.note) !== persistenceNullable(input.note)) return false;
    if (persistenceOwn(input, 'is_primary') && persistenceBoolean(row.is_primary) !== Boolean(input.is_primary)) return false;
    return true;
  }

  function persistenceNormalizeExpectedComposition(generals) {
    return (generals || []).map((row) => ({
      position:Number(row.position),
      general_id:row.general_id,
      weapon_instance_id:row.weapon_instance_id || null,
      mount_instance_id:row.mount_instance_id || null,
      tactics:(row.tactics || []).map((tactic) => ({ slot:Number(tactic.slot), tactic_id:tactic.tactic_id })).sort((a,b) => a.slot - b.slot),
    })).sort((a,b) => a.position - b.position);
  }

  function persistenceNormalizeActualComposition(generals) {
    return (generals || []).map((row) => ({
      position:Number(row.position),
      general_id:row.general_id,
      weapon_instance_id:row.weapon?.id || null,
      mount_instance_id:row.mount?.id || null,
      tactics:(row.tactics || []).map((tactic) => ({ slot:Number(tactic.slot), tactic_id:tactic.tactic_id })).sort((a,b) => a.slot - b.slot),
    })).sort((a,b) => a.position - b.position);
  }

  function persistenceApi(api) {
    if (!api) return api;
    return {
      ...api,
      accounts:{
        ...api.accounts,
        create:(input) => persistenceMutation('저장',
          () => api.accounts.create(input),
          async (result) => {
            const id = result?.data?.id; if (!id) return false;
            const list = persistenceRows(await api.accounts.list());
            return persistenceAccountMatches(list.find((row) => row.id === id), input);
          }),
      },
      roster:{
        ...api.roster,
        generals:{
          ...api.roster.generals,
          upsert:(accountId, generalId, input) => persistenceMutation('저장',
            () => api.roster.generals.upsert(accountId, generalId, input),
            async () => persistenceGeneralMatches(persistenceRows(await api.roster.generals.list(accountId)).find((row) => row.general_id === generalId), input)),
          remove:(accountId, generalId) => persistenceMutation('삭제',
            () => api.roster.generals.remove(accountId, generalId),
            async () => !persistenceRows(await api.roster.generals.list(accountId)).some((row) => row.general_id === generalId)),
        },
        tactics:{
          ...api.roster.tactics,
          upsert:(accountId, tacticId, input) => persistenceMutation('저장',
            () => api.roster.tactics.upsert(accountId, tacticId, input),
            async () => persistenceTacticMatches(persistenceRows(await api.roster.tactics.list(accountId)).find((row) => row.tactic_id === tacticId), input)),
          remove:(accountId, tacticId) => persistenceMutation('삭제',
            () => api.roster.tactics.remove(accountId, tacticId),
            async () => !persistenceRows(await api.roster.tactics.list(accountId)).some((row) => row.tactic_id === tacticId)),
        },
      },
      equipment:{
        ...api.equipment,
        create:(accountId, input) => persistenceMutation('저장',
          () => api.equipment.create(accountId, input),
          async (result) => {
            const id = result?.data?.id; if (!id) return false;
            return persistenceEquipmentMatches(persistenceRows(await api.equipment.list(accountId)).find((row) => row.id === id), input);
          }),
        update:(accountId, equipmentId, input) => persistenceMutation('저장',
          () => api.equipment.update(accountId, equipmentId, input),
          async () => persistenceEquipmentMatches(persistenceRows(await api.equipment.list(accountId)).find((row) => row.id === equipmentId), input)),
        remove:(accountId, equipmentId) => persistenceMutation('삭제',
          () => api.equipment.remove(accountId, equipmentId),
          async () => !persistenceRows(await api.equipment.list(accountId)).some((row) => row.id === equipmentId)),
      },
      decks:{
        ...api.decks,
        create:(accountId, input) => persistenceMutation('저장',
          () => api.decks.create(accountId, input),
          async (result) => {
            const id = result?.data?.id; if (!id) return false;
            return persistenceDeckMatches((await api.decks.get(accountId, id))?.data, input);
          }),
        update:(accountId, deckId, input) => persistenceMutation('저장',
          () => api.decks.update(accountId, deckId, input),
          async () => persistenceDeckMatches((await api.decks.get(accountId, deckId))?.data, input)),
        replaceComposition:(accountId, deckId, input) => persistenceMutation('저장',
          () => api.decks.replaceComposition(accountId, deckId, input),
          async () => {
            const actual = persistenceNormalizeActualComposition((await api.decks.get(accountId, deckId))?.data?.generals || []);
            const expected = persistenceNormalizeExpectedComposition(input?.generals || []);
            return JSON.stringify(actual) === JSON.stringify(expected);
          }),
        remove:(accountId, deckId) => persistenceMutation('삭제',
          () => api.decks.remove(accountId, deckId),
          async () => !persistenceRows(await api.decks.list(accountId)).some((row) => row.id === deckId)),
      },
    };
  }

  data = function() {
    return persistenceApi(persistenceBaseData());
  };

  showMessage = function(message) {
    if (persistenceVerifiedAction && persistenceVerifiedAt) {
      const prefix = persistenceVerifiedAction + ' 확인됨 · ' + persistenceTime(persistenceVerifiedAt);
      persistenceVerifiedAction = null;
      persistenceVerifiedAt = null;
      persistenceBaseShowMessage(prefix + ' · ' + message);
      return;
    }
    persistenceBaseShowMessage(message);
  };
`;

export function myDataPersistencePageHtml(): string {
  const base = myDataOwnedFirstPageHtml();
  if (!base.includes(MESSAGE_MARKER) || !base.includes(CONNECT_SCRIPT_MARKER)) throw new Error('MY_DATA_PERSISTENCE_BASE_CONTRACT_MISMATCH');
  const status = `${MESSAGE_MARKER}\n  <section id="persistence-status" class="notice" hidden aria-live="polite"></section>`;
  return base
    .replace(MESSAGE_MARKER, status)
    .replace(CONNECT_SCRIPT_MARKER, `<script>\n${MY_DATA_PERSISTENCE_SCRIPT}\n</script>\n${CONNECT_SCRIPT_MARKER}`);
}

export function registerMyDataRoutes(app: Hono<{ Bindings: DataEnv }>): void {
  app.get('/my-data', (c) => c.html(myDataPersistencePageHtml()));
}
