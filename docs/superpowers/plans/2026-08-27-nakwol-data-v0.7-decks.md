# NAKWOL DATA v0.7 Decks & Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship NAKWOL DATA 0.7.0 with owner-isolated live deck CRUD, atomic 3-general composition replacement, and immutable owner-readable deck snapshots while keeping DATA schema version 2.

**Architecture:** Add deck-specific domain and persistence modules rather than growing the existing general-purpose `store.ts`. `routes/decks.ts` owns live-deck HTTP contracts and `routes/snapshots.ts` owns immutable snapshot HTTP contracts; both use `runAuthedHandler` and the existing `decks:read` / `decks:write` scopes. Composition is fully validated before one D1 batch replaces general/tactic slots, and snapshot creation materializes a versioned JSON value object so later live or ownership changes cannot rewrite history.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Cloudflare D1, Node `node:test`, repository SQLite D1 test adapter, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-27-nakwol-data-v0.7-decks-design.md`

## Global Constraints

- Target DATA service version is exactly `0.7.0`.
- DATA schema version remains exactly `2`; v0.7 adds no migration.
- Base production golden is DATA `0.6.0`.
- Live deck reads require `decks:read`; live deck mutations and snapshot creation require `decks:write`.
- Snapshot list/detail reads require `decks:read` and remain owner-only in v0.7 regardless of stored visibility.
- Planned decks may reference enabled Registry generals and canonical equipable tactics even when those assets are not in the user's owned roster.
- Tactic slots must use the v0.5 canonical equipable-tactic predicate and must not reference a general unique tactic.
- Equipment references must be real equipment instances owned by the same game account and must match the requested weapon/mount type.
- Do not infer duplicate-general, duplicate-tactic, duplicate-equipment, formation, warbook, combat-legality, or other unsourced game rules.
- `deck_settings` public API, equipment stats/traits, cross-user snapshot sharing, snapshot editing/deletion, season population, and promotion-item work remain out of scope.
- Snapshot creation accepts a JSON object body; `{}` is valid and means `visibility='alliance'`.

---

### Task 1: Deck domain contract and TDD RED scaffolding

**Files:**
- Create: `services/data/src/decks-domain.ts`
- Create: `services/data/tests/decks-api.test.ts`
- Create: `services/data/tests/snapshots-api.test.ts`
- Modify: `services/data/tests/domain.test.ts`

**Interfaces:**
- Consumes: existing DATA validation/error-code conventions.
- Produces:
  - `type DeckStatus = 'active'|'candidate'|'research'|'archived'`
  - `type DeckVisibility = 'private'|'alliance'|'public'`
  - `interface CreateDeckInput`
  - `interface PatchDeckInput`
  - `interface CompositionGeneralInput`
  - `interface ReplaceCompositionInput`
  - `interface CreateSnapshotInput`
  - `normalizeCreateDeckInput(input:Record<string,unknown>):CreateDeckInput`
  - `normalizePatchDeckInput(input:Record<string,unknown>):PatchDeckInput`
  - `normalizeReplaceCompositionInput(input:Record<string,unknown>):ReplaceCompositionInput`
  - `normalizeCreateSnapshotInput(input:Record<string,unknown>):CreateSnapshotInput`

- [ ] **Step 1: Write domain normalization tests**

Add these tests to `services/data/tests/domain.test.ts`:

```ts
import {
  normalizeCreateDeckInput,
  normalizePatchDeckInput,
  normalizeReplaceCompositionInput,
  normalizeCreateSnapshotInput,
} from '../src/decks-domain.ts';

test('deck create input normalizes metadata without inventing game rules',()=>{
  assert.deepEqual(normalizeCreateDeckInput({name:' 연구덱 ',status:'research',visibility:'private',note:' 후보 ',is_primary:true}),{
    name:'연구덱',seasonId:null,status:'research',visibility:'private',note:'후보',isPrimary:true,
  });
  assert.throws(()=>normalizeCreateDeckInput({name:'   '}),/INVALID_DECK_NAME/);
  assert.throws(()=>normalizeCreateDeckInput({name:'x',status:'broken'}),/INVALID_DECK_STATUS/);
  assert.throws(()=>normalizeCreateDeckInput({name:'x',visibility:'friends'}),/INVALID_DECK_VISIBILITY/);
});

test('deck patch distinguishes omitted fields and rejects empty patches',()=>{
  const patch=normalizePatchDeckInput({note:null,status:'archived'});
  assert.equal(patch.hasNote,true);
  assert.equal(patch.note,null);
  assert.equal(patch.hasStatus,true);
  assert.equal(patch.status,'archived');
  assert.equal(patch.hasName,false);
  assert.throws(()=>normalizePatchDeckInput({}),/EMPTY_DECK_PATCH/);
});

test('composition input enforces positions and tactic slots only',()=>{
  assert.deepEqual(normalizeReplaceCompositionInput({generals:[{position:1,general_id:' g:1 ',tactics:[{slot:2,tactic_id:' t:1 '}]}]}),{
    generals:[{position:1,generalId:'g:1',weaponInstanceId:null,mountInstanceId:null,tactics:[{slot:2,tacticId:'t:1'}]}],
  });
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:0,general_id:'g:1'}]}),/INVALID_GENERAL_POSITION/);
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:1,general_id:'g:1'},{position:1,general_id:'g:2'}]}),/DUPLICATE_GENERAL_POSITION/);
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:1,general_id:'g:1',tactics:[{slot:3,tactic_id:'t:1'}]}]}),/INVALID_TACTIC_SLOT/);
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:1,general_id:'g:1',tactics:[{slot:1,tactic_id:'t:1'},{slot:1,tactic_id:'t:2'}]}]}),/DUPLICATE_TACTIC_SLOT/);
});

test('snapshot visibility accepts alliance/public only',()=>{
  assert.deepEqual(normalizeCreateSnapshotInput({}),{visibility:'alliance'});
  assert.deepEqual(normalizeCreateSnapshotInput({visibility:'public'}),{visibility:'public'});
  assert.throws(()=>normalizeCreateSnapshotInput({visibility:'private'}),/INVALID_SNAPSHOT_VISIBILITY/);
});
```

- [ ] **Step 2: Write route-level RED tests with exact assertions**

Create `decks-api.test.ts` and `snapshots-api.test.ts` using the same `createSqliteD1`, AUTH fetch mocking, account seeding, Registry seeding, and scope-grant helpers used in `equipment-api.test.ts`.

`decks-api.test.ts` must contain these scenarios:

```ts
test('deck routes are authenticated endpoints', async()=>{
  const DB=createSqliteD1(migration);
  const env={DB,AUTH_ORIGIN:'https://auth.example'} as any;
  const response=await (app as any).fetch(
    new Request('https://data.example/v1/game-accounts/gac_a/decks'),
    env,
    {waitUntil(){},passThroughOnException(){}},
  );
  assert.equal(response.status,401);
  assert.equal((await response.json() as any).error.code,'UNAUTHORIZED');
});
```

List/create/get scenario, in order:

```text
seed gac_a for usr_abc and gac_other for usr_other
GET gac_a/decks before grant -> 403 SCOPE_DENIED
grant decks:write
POST gac_a/decks with {name:' 연구덱 ',status:'research'} -> 201
assert returned id /^dek_/, name '연구덱', status 'research', visibility 'private'
grant decks:read
GET gac_a/decks -> 200, one row, general_count=0, tactic_count=0, equipment_count=0
GET gac_a/decks/:createdId -> 200 and matching metadata
GET gac_other/decks as usr_abc -> 404 GAME_ACCOUNT_NOT_FOUND
GET gac_other/decks/:createdId as usr_abc -> 404 DECK_NOT_FOUND
```

Metadata PATCH scenario:

```text
seed owner deck dek_one and grant decks:write
PATCH note/status/is_primary -> 200 and trimmed note + archived + true
PATCH {status:'broken'} -> 400 INVALID_DECK_STATUS
PATCH {} -> 400 EMPTY_DECK_PATCH
PATCH same deck through gac_other -> 404 DECK_NOT_FOUND
```

Composition scenario:

```text
seed enabled g:1/g:2 and hidden g:hidden
seed canonical tactic t:20010 metadata {class:5,learn:1,get:3,copy:0,chip:1001}
seed chipless tactic t:bad metadata {class:5,learn:1,get:3,copy:0,chip:0}
seed same-account weapon eqp_w and mount eqp_m plus other-account weapon eqp_other
PUT planned general g:1 + t:20010 without user_generals/user_tactics rows -> 200
assert deck_general_slots and deck_tactic_slots contain requested rows
PUT hidden general -> 404 GENERAL_NOT_FOUND
PUT chipless tactic -> 404 TACTIC_NOT_FOUND
PUT eqp_other -> 404 EQUIPMENT_NOT_FOUND
PUT mount eqp_m into weapon_instance_id -> 400 EQUIPMENT_TYPE_MISMATCH
after each invalid PUT assert previous valid composition rows are unchanged
```

Live delete + snapshot survival scenario:

```text
seed deck + deck_snapshots row whose source_deck_id is that deck
DELETE owner deck -> 200 {deleted:true,id:'dek_one'}
assert decks/deck_general_slots/deck_tactic_slots no longer contain live rows
assert deck_snapshots row still exists, source_deck_id is null, snapshot_json byte-for-byte unchanged
```

`snapshots-api.test.ts` scenarios:

```text
snapshot creation:
seed owned g:1 breakthrough=4 promotion=2 and planned unowned g:2
seed owned t:20010 breakthrough=5 and planned unowned canonical t:20350
seed eqp_w nickname='주력검', locked=1, favorite=1
create live composition referencing those assets
POST snapshot with {} -> 201, visibility alliance, id /^dks_/
assert snapshot_json format_version=1, account/deck metadata, ordered generals/tactics,
owned flags and permanent values, and equipment nickname/locked/favorite

immutability:
save the returned snapshot payload
mutate live deck name, composition, user_generals, user_tactics, and user_equipment state
GET same snapshot -> 200 and deepEqual snapshot payload to originally returned value

owner isolation:
create public snapshot for usr_abc
GET list/detail as usr_abc with decks:read -> 200 and snapshot visible
GET detail as usr_other with decks:read -> 404 SNAPSHOT_NOT_FOUND
```

- [ ] **Step 3: Run the suite to verify RED without unrelated regressions**

Run from `services/data`:

```bash
npm test
```

Expected: existing v0.6 tests remain green. New deck/snapshot route tests fail because the routes are not registered. If compilation fails only because `decks-domain.ts` does not yet exist, create the exported types/functions with throwing bodies first, rerun, and require behavioral RED to be route/implementation failures rather than unrelated import failures.

- [ ] **Step 4: Implement the domain normalizers**

Create `services/data/src/decks-domain.ts` with these public types:

```ts
export type DeckStatus='active'|'candidate'|'research'|'archived';
export type DeckVisibility='private'|'alliance'|'public';
export interface CreateDeckInput {
  name:string; seasonId:string|null; status:DeckStatus; visibility:DeckVisibility; note:string|null; isPrimary:boolean;
}
export interface PatchDeckInput {
  hasName:boolean; name:string;
  hasSeasonId:boolean; seasonId:string|null;
  hasStatus:boolean; status:DeckStatus;
  hasVisibility:boolean; visibility:DeckVisibility;
  hasNote:boolean; note:string|null;
  hasIsPrimary:boolean; isPrimary:boolean;
}
export interface CompositionTacticInput { slot:number; tacticId:string; }
export interface CompositionGeneralInput {
  position:number; generalId:string; weaponInstanceId:string|null; mountInstanceId:string|null; tactics:CompositionTacticInput[];
}
export interface ReplaceCompositionInput { generals:CompositionGeneralInput[]; }
export interface CreateSnapshotInput { visibility:'alliance'|'public'; }
```

Normalization rules:

```text
name: required string, trim, non-empty
season_id: undefined/null/trimmed empty => null; otherwise trimmed string
note: undefined/null/trimmed empty => null; non-string non-null => INVALID_NOTE
is_primary: undefined => false on create; present non-boolean => INVALID_IS_PRIMARY
composition.generals: required array; every entry is a non-array object
position: integer 1..3, unique
general_id: non-empty trimmed string
weapon_instance_id/mount_instance_id: undefined/null/trimmed empty => null; otherwise trimmed string
tactics: defaults []; every tactic is an object with integer slot 1..2, unique in its general, and non-empty trimmed tactic_id
snapshot visibility: defaults alliance; only alliance/public accepted
```

- [ ] **Step 5: Run domain tests**

```bash
npx tsx --test tests/domain.test.ts
```

Expected: domain tests pass; route tests remain RED.

- [ ] **Step 6: Commit the domain contract and RED tests**

```bash
git add services/data/src/decks-domain.ts services/data/tests/domain.test.ts services/data/tests/decks-api.test.ts services/data/tests/snapshots-api.test.ts
git commit -m "test(data): define v0.7 deck contracts"
```

---

### Task 2: Live deck metadata persistence and HTTP CRUD

**Files:**
- Create: `services/data/src/decks-store.ts`
- Create: `services/data/src/routes/decks.ts`
- Modify: `services/data/src/index.ts`
- Test: `services/data/tests/decks-api.test.ts`

**Interfaces:**
- Consumes: `CreateDeckInput`, `PatchDeckInput`, `newDataId('dek')`, `runAuthedHandler`, `DataAccessError`, D1 schema-2 `decks` and `game_accounts`.
- Produces: `listDecks`, `createDeck`, `getDeck`, `patchDeck`, `deleteDeck`, and HTTP handlers `handleListDecks`, `handleCreateDeck`, `handleGetDeck`, `handlePatchDeck`, `handleDeleteDeck`.

- [ ] **Step 1: Verify live-deck metadata tests are RED**

```bash
npx tsx --test --test-name-pattern="deck routes|deck list/create/get|deck patch" tests/decks-api.test.ts
```

Expected: route tests fail with NOT_FOUND/404.

- [ ] **Step 2: Implement ownership-safe list/create/get**

List query:

```sql
SELECT d.id,d.name,d.season_id,d.status,d.visibility,d.note,d.is_primary,d.created_at,d.updated_at,
  (SELECT COUNT(*) FROM deck_general_slots gs WHERE gs.deck_id=d.id) AS general_count,
  (SELECT COUNT(*) FROM deck_tactic_slots ts WHERE ts.deck_id=d.id) AS tactic_count,
  (SELECT COUNT(weapon_instance_id)+COUNT(mount_instance_id) FROM deck_general_slots es WHERE es.deck_id=d.id) AS equipment_count
FROM decks d
JOIN game_accounts ga ON ga.id=d.account_id
WHERE d.account_id=? AND ga.user_id=?
ORDER BY d.is_primary DESC,d.updated_at DESC,d.id;
```

Create flow:

```text
SELECT account WHERE id=? AND user_id=?; absent => account_not_found
if seasonId non-null, SELECT enabled game_seasons row; absent => invalid_season
newDataId('dek'), Date.now(), INSERT decks
return normalized metadata
```

Get must query by deck ID + account ID + owner user ID in one join. During Task 2 return metadata plus `composition:{generals:[]}`; Task 3 replaces that with actual composition.

- [ ] **Step 3: Implement PATCH/delete**

PATCH loads the owner-scoped current row, applies `has*` fields, revalidates changed season, updates `updated_at`, and returns normalized metadata. Delete first owner-scopes the deck, then deletes by `(id,account_id)`. Inaccessible deck => `DECK_NOT_FOUND`.

- [ ] **Step 4: Implement live deck routes**

`routes/decks.ts` uses a local JSON-object parser and deck validation-message map. Status contract:

```text
POST create -> 201
GET list/get -> 200
PATCH -> 200
DELETE -> 200 with {deleted:true,id:deckId}
```

400 codes: `INVALID_DECK_NAME`, `INVALID_DECK_STATUS`, `INVALID_DECK_VISIBILITY`, `INVALID_SEASON`, `INVALID_NOTE`, `INVALID_IS_PRIMARY`, `EMPTY_DECK_PATCH`. 404 codes: `GAME_ACCOUNT_NOT_FOUND`, `DECK_NOT_FOUND`.

- [ ] **Step 5: Register live deck routes**

```ts
app.get('/v1/game-accounts/:accountId/decks', (c)=>handleListDecks(c.req.param('accountId'),c.req.raw,c.env));
app.post('/v1/game-accounts/:accountId/decks', (c)=>handleCreateDeck(c.req.param('accountId'),c.req.raw,c.env));
app.get('/v1/game-accounts/:accountId/decks/:deckId', (c)=>handleGetDeck(c.req.param('accountId'),c.req.param('deckId'),c.req.raw,c.env));
app.patch('/v1/game-accounts/:accountId/decks/:deckId', (c)=>handlePatchDeck(c.req.param('accountId'),c.req.param('deckId'),c.req.raw,c.env));
app.delete('/v1/game-accounts/:accountId/decks/:deckId', (c)=>handleDeleteDeck(c.req.param('accountId'),c.req.param('deckId'),c.req.raw,c.env));
```

Handlers enforce `decks:read` or `decks:write` with `runAuthedHandler`.

- [ ] **Step 6: Run live deck tests and regression suite**

```bash
npx tsx --test --test-name-pattern="deck routes|deck list/create/get|deck patch" tests/decks-api.test.ts
npm test
```

Expected: live metadata tests pass; composition/snapshot tests remain RED; v0.6 tests pass.

- [ ] **Step 7: Commit live deck CRUD**

```bash
git add services/data/src/decks-store.ts services/data/src/routes/decks.ts services/data/src/index.ts services/data/tests/decks-api.test.ts
git commit -m "feat(data): add v0.7 live deck CRUD"
```

---

### Task 3: Atomic composition replacement and full deck read

**Files:**
- Modify: `services/data/src/decks-store.ts`
- Modify: `services/data/src/routes/decks.ts`
- Modify: `services/data/src/index.ts`
- Test: `services/data/tests/decks-api.test.ts`

**Interfaces:**
- Consumes: `ReplaceCompositionInput`, `isCanonicalOwnableTacticMetadata`, Registry/roster/equipment tables.
- Produces: `replaceDeckComposition(env,userId,accountId,deckId,input)`, `getDeckComposition(env,userId,accountId,deckId)`, `handlePutDeckComposition(...)`.

- [ ] **Step 1: Verify composition tests are RED**

```bash
npx tsx --test --test-name-pattern="composition" tests/decks-api.test.ts
```

Expected: composition route returns NOT_FOUND/404.

- [ ] **Step 2: Implement complete pre-write validation**

General:

```sql
SELECT id,name FROM game_generals WHERE id=? AND enabled=1 LIMIT 1;
```

Tactic:

```sql
SELECT id,name,metadata_json FROM game_tactics WHERE id=? AND enabled=1 LIMIT 1;
SELECT 1 AS matched FROM game_generals WHERE unique_tactic_id=? LIMIT 1;
```

Require `isCanonicalOwnableTacticMetadata(metadata)===true` and no unique-tactic reference. Do not require `user_generals` / `user_tactics` ownership.

Equipment:

```sql
SELECT ue.id,et.type
FROM user_equipment ue
JOIN game_equipment_templates et ON et.id=ue.template_id
WHERE ue.id=? AND ue.account_id=?
LIMIT 1;
```

Absent => `EQUIPMENT_NOT_FOUND`; wrong type => `EQUIPMENT_TYPE_MISMATCH`.

- [ ] **Step 3: Replace all slots in one D1 batch after validation**

```ts
const statements=[
  env.DB.prepare('DELETE FROM deck_tactic_slots WHERE deck_id=?').bind(deckId),
  env.DB.prepare('DELETE FROM deck_general_slots WHERE deck_id=?').bind(deckId),
  ...generalSlotInserts,
  ...tacticSlotInserts,
  env.DB.prepare('UPDATE decks SET updated_at=? WHERE id=? AND account_id=?').bind(now,deckId,accountId),
];
await env.DB.batch(statements);
```

No write is constructed/executed before all validation succeeds.

- [ ] **Step 4: Implement ordered full composition read**

Return generals ordered by `position`, tactics by `(general_position,slot)`, with Registry names and equipment identity/state:

```ts
{
  position:1,
  general_id:'g:1',
  general_name:'조조',
  weapon:{id:'eqp_x',template_id:'w:1',template_name:'...',nickname:null,locked:false,favorite:false}|null,
  mount:null,
  tactics:[{slot:1,tactic_id:'t:20010',tactic_name:'문무겸비'}],
}
```

Update single-deck GET to return `composition:{generals:[...]}`.

- [ ] **Step 5: Implement/register composition route**

```ts
app.put('/v1/game-accounts/:accountId/decks/:deckId/composition', (c)=>handlePutDeckComposition(c.req.param('accountId'),c.req.param('deckId'),c.req.raw,c.env));
```

Use `decks:write`; map structural errors to 400, inaccessible/invalid referenced resources to 404 except type mismatch 400.

- [ ] **Step 6: Prove atomicity and planned-asset behavior**

```bash
npx tsx --test --test-name-pattern="composition" tests/decks-api.test.ts
npm test
```

Expected: planned unowned assets accepted; hidden/noncanonical records and invalid equipment rejected; invalid replacements preserve last valid composition.

- [ ] **Step 7: Commit composition support**

```bash
git add services/data/src/decks-store.ts services/data/src/routes/decks.ts services/data/src/index.ts services/data/tests/decks-api.test.ts
git commit -m "feat(data): add atomic deck composition"
```

---

### Task 4: Immutable snapshot materialization and owner reads

**Files:**
- Modify: `services/data/src/decks-store.ts`
- Create: `services/data/src/routes/snapshots.ts`
- Modify: `services/data/src/index.ts`
- Test: `services/data/tests/snapshots-api.test.ts`
- Test: `services/data/tests/decks-api.test.ts`

**Interfaces:**
- Consumes: `getDeckComposition(...)`, `CreateSnapshotInput`, `newDataId('dks')`, roster/equipment/Registry tables.
- Produces: `createDeckSnapshot`, `listDeckSnapshots`, `getDeckSnapshot`, `handleCreateDeckSnapshot`, `handleListDeckSnapshots`, `handleGetDeckSnapshot`.

- [ ] **Step 1: Verify snapshot tests are RED**

```bash
npx tsx --test tests/snapshots-api.test.ts
```

Expected: snapshot routes return NOT_FOUND/404.

- [ ] **Step 2: Materialize snapshot value object**

Load owner-scoped account/deck/composition and enrich permanent state from the same account. Build:

```ts
{
  format_version:1,
  captured_at:now,
  account:{id:accountId,nickname:account.nickname,server_code:account.server_code},
  deck:{id,name,season_id,status,visibility,note,is_primary,created_at,updated_at},
  generals:[{
    position,general_id,general_name,
    owned:boolean,breakthrough:number|null,promotion:number|null,
    weapon:{id,template_id,template_name,type:'weapon',nickname,locked,favorite}|null,
    mount:{id,template_id,template_name,type:'mount',nickname,locked,favorite}|null,
    tactics:[{slot,tactic_id,tactic_name,owned:boolean,breakthrough:number|null}],
  }],
}
```

Planned unowned assets use `owned:false` and null permanent values.

- [ ] **Step 3: Insert immutable snapshot after materialization**

```ts
const id=newDataId('dks');
await env.DB.prepare(
  'INSERT INTO deck_snapshots(id,source_deck_id,owner_user_id,visibility,snapshot_json,created_at) VALUES (?,?,?,?,?,?)'
).bind(id,deckId,userId,input.visibility,JSON.stringify(snapshot),now).run();
```

Return `{id,source_deck_id:deckId,visibility,snapshot,created_at:now}`. No mutation/delete endpoint.

- [ ] **Step 4: Implement owner-only list/detail**

```sql
SELECT id,source_deck_id,visibility,snapshot_json,created_at
FROM deck_snapshots
WHERE owner_user_id=?
ORDER BY created_at DESC,id;
```

Detail adds `AND id=? LIMIT 1`. Parse JSON to `snapshot`. Different owner => `SNAPSHOT_NOT_FOUND`, even for public visibility.

- [ ] **Step 5: Implement/register snapshot routes**

```ts
app.post('/v1/game-accounts/:accountId/decks/:deckId/snapshots', (c)=>handleCreateDeckSnapshot(c.req.param('accountId'),c.req.param('deckId'),c.req.raw,c.env));
app.get('/v1/deck-snapshots', (c)=>handleListDeckSnapshots(c.req.raw,c.env));
app.get('/v1/deck-snapshots/:snapshotId', (c)=>handleGetDeckSnapshot(c.req.param('snapshotId'),c.req.raw,c.env));
```

Creation requires `decks:write`; list/detail `decks:read`. `{}` body is valid for creation.

- [ ] **Step 6: Verify immutability and source-deck deletion**

Exact sequence:

```text
capture snapshot -> save returned snapshot object
PATCH live deck name/note
PUT different live composition
UPDATE user_generals breakthrough/promotion
UPDATE user_tactics breakthrough
UPDATE user_equipment nickname/locked/favorite
GET same snapshot -> snapshot deep-equals saved object
DELETE source deck
GET same snapshot -> 200, source_deck_id=null, snapshot deep-equals saved object
```

Run:

```bash
npx tsx --test tests/snapshots-api.test.ts tests/decks-api.test.ts
npm test
```

Expected: all functional and regression tests pass.

- [ ] **Step 7: Commit snapshots**

```bash
git add services/data/src/decks-store.ts services/data/src/routes/snapshots.ts services/data/src/index.ts services/data/tests/snapshots-api.test.ts services/data/tests/decks-api.test.ts
git commit -m "feat(data): add immutable deck snapshots"
```

---

### Task 5: Version 0.7 release contract, docs, and deployment gates

**Files:**
- Modify: `services/data/src/domain.ts`
- Modify: `services/data/package.json`
- Modify: `services/data/tests/domain.test.ts`
- Modify: `services/data/tests/http.test.ts`
- Modify: `services/data/tests/deployment.test.ts`
- Modify: `.github/workflows/bootstrap-data.yml`
- Modify: `.github/workflows/deploy-data.yml`
- Modify: `services/data/README.md`
- Modify: `services/data/CHANGELOG.md`
- Modify: `DATA.md`
- Create: `docs/releases/2026-08-27-nakwol-data-v0.7.md`

**Interfaces:**
- Consumes: completed v0.7 behavior.
- Produces: `DATA_SERVICE_VERSION='0.7.0'`, unchanged schema `2`, deployment smoke checks for 0.7.0, release docs.

- [ ] **Step 1: Move tests to 0.7 release contract first**

```ts
assert.equal(DATA_SERVICE_VERSION,'0.7.0');
assert.deepEqual(await publicHealthResponse().json(),{ok:true,service:'nakwol-data',version:'0.7.0',schema_version:2});
assert.match(workflow,/"version":"0\.7\.0"/);
assert.equal(packageJson.version,'0.7.0');
```

- [ ] **Step 2: Run expected release-contract RED**

```bash
npm test
```

Expected: version/deployment tests fail only because runtime/package/workflows still say 0.6.0; deck/snapshot tests remain green.

- [ ] **Step 3: Bump runtime/package/workflows**

```ts
export const DATA_SERVICE_VERSION='0.7.0' as const;
export const DATA_SCHEMA_VERSION=2 as const;
```

Set package version 0.7.0. In both workflows rename verification steps to v0.7 and change production grep to `"version":"0.7.0"`; keep schema 2.

- [ ] **Step 4: Document exact v0.7 surface**

README/DATA/CHANGELOG/release record enumerate live CRUD, atomic composition, owner-only immutable snapshots, planned-unowned policy, canonical tactic rule, same-account typed equipment rule, schema2/no migration, and all deferred domains. Preserve Connect control API docs and v0.4-v0.6 history.

- [ ] **Step 5: Run complete release candidate verification**

```bash
npm test
npm run typecheck
npm run bundle
```

Expected: zero failures and exit 0 for typecheck/bundle.

- [ ] **Step 6: Commit release preparation**

```bash
git add services/data/src/domain.ts services/data/package.json services/data/tests/domain.test.ts services/data/tests/http.test.ts services/data/tests/deployment.test.ts .github/workflows/bootstrap-data.yml .github/workflows/deploy-data.yml services/data/README.md services/data/CHANGELOG.md DATA.md docs/releases/2026-08-27-nakwol-data-v0.7.md
git commit -m "release(data): prepare v0.7.0"
```

---

### Task 6: PR review, merge, production deployment, and new golden baseline

**Files:**
- Modify after deployment: `docs/releases/2026-08-27-nakwol-data-v0.7.md`
- Modify after deployment: `DATA.md`
- Modify on `main`: `ops/data-deploy.flag`

**Interfaces:**
- Consumes: verified feature branch and existing DATA Actions pipeline.
- Produces: merged PR, deployed Worker 0.7.0/schema2, recorded immutable deployment evidence.

- [ ] **Step 1: Open draft PR and inspect complete diff**

PR title:

```text
Release NAKWOL DATA v0.7 decks and snapshots API
```

Review for owner leaks, scope creep, accidental Connect-doc deletion, migration changes, and unsourced game rules.

- [ ] **Step 2: Verify exact final PR HEAD**

```text
npm test -> 0 failures
npm run typecheck -> success
npm run bundle -> success
```

Do not merge on stale evidence.

- [ ] **Step 3: Mark ready and merge guarded by expected head SHA**

Record actual PR number and merge commit.

- [ ] **Step 4: Trigger production deployment**

Set `ops/data-deploy.flag` exactly:

```text
deploy nakwol-data 0.7.0 decks snapshots
```

- [ ] **Step 5: Verify every production gate**

```text
Verify DATA v0.7 -> success
Require existing exact DATA D1 -> success
Apply DATA migrations -> No migrations to apply!
Seed DATA Registry -> success
Verify DATA Registry counts -> NAKWOL_DATA_REGISTRY_COUNTS_OK
Deploy DATA Worker -> success
Verify production DATA v0.7 -> NAKWOL_DATA_DEPLOY_OK
```

Smoke must see health/schema HTTP 200, service `nakwol-data`, version `0.7.0`, schema `2`.

- [ ] **Step 6: Record actual production evidence**

Write PR number, merge commit, deploy commit, workflow run ID, Worker Version ID, final test totals, migration result, Registry gate, and smoke result into the release record. Update `DATA.md` Current production golden to 0.7.0.

- [ ] **Step 7: Verify recorded golden state against GitHub/Cloudflare evidence**

Fetch `DATA.md`, release record, merged PR metadata, and production workflow logs from `main`; compare every recorded SHA/ID/version before declaring v0.7 complete.
