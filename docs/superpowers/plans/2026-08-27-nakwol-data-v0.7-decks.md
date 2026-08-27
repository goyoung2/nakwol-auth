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

---

### Task 1: Deck domain contract and TDD RED scaffolding

**Files:**
- Create: `services/data/src/decks-domain.ts`
- Create: `services/data/tests/decks-api.test.ts`
- Create: `services/data/tests/snapshots-api.test.ts`
- Modify: `services/data/tests/domain.test.ts`

**Interfaces:**
- Consumes: `isCanonicalOwnableTacticMetadata(metadata)` and existing DATA error-code conventions.
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

Add concrete tests to `services/data/tests/domain.test.ts`:

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
});

test('deck patch distinguishes omitted fields and rejects empty patches',()=>{
  const patch=normalizePatchDeckInput({note:null,status:'archived'});
  assert.equal(patch.hasNote,true);
  assert.equal(patch.note,null);
  assert.equal(patch.hasStatus,true);
  assert.equal(patch.status,'archived');
  assert.throws(()=>normalizePatchDeckInput({}),/EMPTY_DECK_PATCH/);
});

test('composition input enforces positions and tactic slots only',()=>{
  assert.deepEqual(normalizeReplaceCompositionInput({generals:[{position:1,general_id:' g:1 ',tactics:[{slot:2,tactic_id:' t:1 '}]}]}),{
    generals:[{position:1,generalId:'g:1',weaponInstanceId:null,mountInstanceId:null,tactics:[{slot:2,tacticId:'t:1'}]}],
  });
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:1,general_id:'g:1'},{position:1,general_id:'g:2'}]}),/DUPLICATE_GENERAL_POSITION/);
  assert.throws(()=>normalizeReplaceCompositionInput({generals:[{position:1,general_id:'g:1',tactics:[{slot:1,tactic_id:'t:1'},{slot:1,tactic_id:'t:2'}]}]}),/DUPLICATE_TACTIC_SLOT/);
});

test('snapshot visibility accepts alliance/public only',()=>{
  assert.deepEqual(normalizeCreateSnapshotInput({}),{visibility:'alliance'});
  assert.deepEqual(normalizeCreateSnapshotInput({visibility:'public'}),{visibility:'public'});
  assert.throws(()=>normalizeCreateSnapshotInput({visibility:'private'}),/INVALID_SNAPSHOT_VISIBILITY/);
});
```

- [ ] **Step 2: Write route-level RED tests**

Create `decks-api.test.ts` and `snapshots-api.test.ts` using the same `createSqliteD1`, AUTH fetch mocking, account seeding, Registry seeding, and scope-grant helpers used in `equipment-api.test.ts`.

Minimum deck contract cases:

```ts
test('deck routes are authenticated endpoints', async()=>{
  const response=await (app as any).fetch(new Request('https://data.example/v1/game-accounts/gac_a/decks'), env, ctx);
  assert.equal(response.status,401);
});

test('deck list/create/get are scope protected and owner isolated', async()=>{/* assert 403 without scope, 201 create, 200 owner list/get, 404 other user */});

test('deck patch validates metadata and cannot cross accounts', async()=>{/* assert update + 400 invalid status + 404 cross-account */});

test('composition accepts planned assets but rejects invalid registry/equipment references atomically', async()=>{/* seed previous composition, attempt invalid replace, assert previous rows unchanged */});

test('deck delete removes live rows while snapshot history survives', async()=>{/* create snapshot first, delete deck, assert source_deck_id null and snapshot JSON intact */});
```

Minimum snapshot cases:

```ts
test('snapshot creation freezes composition and permanent asset state', async()=>{/* assert names, ownership, breakthrough, promotion, equipment nickname/locked/favorite */});

test('later live and roster changes do not mutate stored snapshot JSON', async()=>{/* mutate live deck + owned rows, read same snapshot, deepEqual original payload */});

test('snapshot list/detail are owner isolated regardless of visibility', async()=>{/* public snapshot still 404 to another user */});
```

- [ ] **Step 3: Run the full suite to verify RED**

Run from `services/data`:

```bash
npm test
```

Expected: all existing v0.6 tests stay green; new deck/snapshot tests fail because `decks-domain.ts` and/or v0.7 routes are not yet implemented. Do not accept failures in unrelated existing tests.

- [ ] **Step 4: Implement only the domain normalizers**

Create `services/data/src/decks-domain.ts` with explicit structural types and deterministic error codes. Core implementation shape:

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

Normalize strings with `trim()`, store empty optional note/season/equipment IDs as `null`, reject non-object array entries, reject duplicate positions/slots, and reject more than 3 generals or more than 2 tactics per general through the position/slot uniqueness/range checks.

- [ ] **Step 5: Run domain tests**

```bash
npx tsx --test tests/domain.test.ts
```

Expected: domain tests pass; route tests remain RED.

- [ ] **Step 6: Commit the domain contract**

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
- Produces:
  - `listDecks(env,userId,accountId)`
  - `createDeck(env,userId,accountId,input)`
  - `getDeck(env,userId,accountId,deckId)`
  - `patchDeck(env,userId,accountId,deckId,input)`
  - `deleteDeck(env,userId,accountId,deckId)`
  - HTTP handlers `handleListDecks`, `handleCreateDeck`, `handleGetDeck`, `handlePatchDeck`, `handleDeleteDeck`

- [ ] **Step 1: Narrow RED tests to live deck metadata**

Run:

```bash
npx tsx --test --test-name-pattern="deck routes|deck list/create/get|deck patch" tests/decks-api.test.ts
```

Expected: FAIL because live deck routes do not exist.

- [ ] **Step 2: Implement ownership-safe deck queries**

`decks-store.ts` must join `decks` to `game_accounts` for deck-specific owner checks. Do not fetch a deck by ID and perform ownership checks later in application code.

List query must return structural counts without exposing user IDs:

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

Create must verify account ownership, verify non-null `season_id` against `game_seasons.enabled=1`, generate `newDataId('dek')`, and insert metadata. PATCH must resolve omitted-vs-null fields from `PatchDeckInput`, revalidate changed season ID, and update `updated_at`.

- [ ] **Step 3: Implement live deck routes**

`routes/decks.ts` should use local JSON-object parsing and a deck-specific validation-response mapping. Route status contract:

```ts
POST create -> 201
GET list/get -> 200
PATCH -> 200
DELETE -> 200 with {deleted:true,id:deckId}
```

Stable 400 codes include `INVALID_DECK_NAME`, `INVALID_DECK_STATUS`, `INVALID_DECK_VISIBILITY`, `INVALID_SEASON`, `INVALID_NOTE`, `INVALID_IS_PRIMARY`, `EMPTY_DECK_PATCH`; inaccessible account/deck is 404 `GAME_ACCOUNT_NOT_FOUND` / `DECK_NOT_FOUND`.

- [ ] **Step 4: Register live deck routes in `index.ts`**

Add exactly:

```ts
app.get('/v1/game-accounts/:accountId/decks', ...);
app.post('/v1/game-accounts/:accountId/decks', ...);
app.get('/v1/game-accounts/:accountId/decks/:deckId', ...);
app.patch('/v1/game-accounts/:accountId/decks/:deckId', ...);
app.delete('/v1/game-accounts/:accountId/decks/:deckId', ...);
```

Read routes use `decks:read`; mutations use `decks:write` inside handlers.

- [ ] **Step 5: Run live deck tests and regression suite**

```bash
npx tsx --test --test-name-pattern="deck routes|deck list/create/get|deck patch" tests/decks-api.test.ts
npm test
```

Expected: live metadata tests pass; composition/snapshot tests remain the only new RED failures; existing v0.6 tests pass.

- [ ] **Step 6: Commit live deck CRUD**

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
- Consumes: `ReplaceCompositionInput`, existing `isCanonicalOwnableTacticMetadata`, schema-2 Registry/roster/equipment tables.
- Produces:
  - `replaceDeckComposition(env,userId,accountId,deckId,input)`
  - `getDeckComposition(env,userId,accountId,deckId)` used by live GET and snapshots
  - `handlePutDeckComposition(...)`

- [ ] **Step 1: Verify composition tests are RED**

```bash
npx tsx --test --test-name-pattern="composition" tests/decks-api.test.ts
```

Expected: FAIL because composition route/store operations do not exist.

- [ ] **Step 2: Implement complete pre-write validation**

For every requested general:

```sql
SELECT id,name FROM game_generals WHERE id=? AND enabled=1 LIMIT 1;
```

For every tactic:

```sql
SELECT id,name,metadata_json FROM game_tactics WHERE id=? AND enabled=1 LIMIT 1;
SELECT 1 AS matched FROM game_generals WHERE unique_tactic_id=? LIMIT 1;
```

Parse metadata and require `isCanonicalOwnableTacticMetadata(metadata)===true` and no unique-tactic reference. Do not query `user_generals` or `user_tactics` as a legality prerequisite.

For equipment, query with account ownership and template type in the same SQL:

```sql
SELECT ue.id,et.type
FROM user_equipment ue
JOIN game_equipment_templates et ON et.id=ue.template_id
WHERE ue.id=? AND ue.account_id=?
LIMIT 1;
```

Return `EQUIPMENT_NOT_FOUND` when absent and `EQUIPMENT_TYPE_MISMATCH` when a weapon is supplied as a mount or vice versa.

- [ ] **Step 3: Implement one-batch replacement after all validation succeeds**

Build statements only after the entire request validates:

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

Because validation is complete before the first mutation, any 400/404 validation error leaves the previous composition unchanged.

- [ ] **Step 4: Implement ordered full-composition read**

Return generals ordered by `position`, tactics ordered by `(general_position,slot)`, with Registry names and attached equipment fields. Response general shape:

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

- [ ] **Step 5: Register composition route**

```ts
app.put('/v1/game-accounts/:accountId/decks/:deckId/composition', ...);
```

The handler requires `decks:write`.

- [ ] **Step 6: Prove atomicity and planned-asset behavior**

Run:

```bash
npx tsx --test --test-name-pattern="composition" tests/decks-api.test.ts
npm test
```

Expected: tests prove unowned enabled generals/canonical tactics are accepted, hidden/noncanonical records are rejected, cross-account/wrong-type equipment is rejected, and invalid replacement preserves previous rows.

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
- Consumes: `getDeckComposition(...)`, `CreateSnapshotInput`, `newDataId('dks')`, `user_generals`, `user_tactics`, `user_equipment`, Registry tables.
- Produces:
  - `createDeckSnapshot(env,userId,accountId,deckId,input)`
  - `listDeckSnapshots(env,userId)`
  - `getDeckSnapshot(env,userId,snapshotId)`
  - handlers `handleCreateDeckSnapshot`, `handleListDeckSnapshots`, `handleGetDeckSnapshot`

- [ ] **Step 1: Verify snapshot tests are RED**

```bash
npx tsx --test tests/snapshots-api.test.ts
```

Expected: FAIL because snapshot routes do not exist.

- [ ] **Step 2: Implement snapshot materialization as a value object**

Build the exact `snapshot_json` from current owner-visible live data. Top-level shape:

```ts
{
  format_version:1,
  captured_at:now,
  account:{id:accountId,nickname:account.nickname,server_code:account.server_code},
  deck:{id,name,season_id,status,visibility,note,is_primary,created_at,updated_at},
  generals:[...]
}
```

For each general, freeze:

```ts
{
  position,
  general_id,
  general_name,
  owned:boolean,
  breakthrough:number|null,
  promotion:number|null,
  weapon:{id,template_id,template_name,type:'weapon',nickname,locked,favorite}|null,
  mount:{id,template_id,template_name,type:'mount',nickname,locked,favorite}|null,
  tactics:[{
    slot,tactic_id,tactic_name,owned:boolean,breakthrough:number|null
  }]
}
```

Use left joins or explicit lookup queries so planned unowned assets serialize with `owned:false` and null permanent-state values.

- [ ] **Step 3: Insert snapshot only after materialization succeeds**

```ts
const id=newDataId('dks');
await env.DB.prepare(
  'INSERT INTO deck_snapshots(id,source_deck_id,owner_user_id,visibility,snapshot_json,created_at) VALUES (?,?,?,?,?,?)'
).bind(id,deckId,userId,input.visibility,JSON.stringify(snapshot),now).run();
```

Do not add PATCH/DELETE endpoints for snapshots.

- [ ] **Step 4: Implement owner-only list/detail**

List/detail must filter directly on `owner_user_id=?`. Detail returns parsed `snapshot_json`, stored visibility, source deck ID (possibly null), and created timestamp. A different owner gets `SNAPSHOT_NOT_FOUND` even when visibility is `public`.

- [ ] **Step 5: Register snapshot routes**

```ts
app.post('/v1/game-accounts/:accountId/decks/:deckId/snapshots', ...);
app.get('/v1/deck-snapshots', ...);
app.get('/v1/deck-snapshots/:snapshotId', ...);
```

Creation uses `decks:write`; list/detail use `decks:read`.

- [ ] **Step 6: Verify immutability and source-deck deletion behavior**

Tests must:

1. capture a snapshot;
2. mutate live deck name/composition;
3. mutate general/tactic breakthrough/promotion;
4. mutate equipment nickname/locked/favorite;
5. read snapshot and assert deep equality with the original captured payload;
6. delete the source deck;
7. assert snapshot still exists and `source_deck_id` is null while its JSON still names the deleted live deck.

Run:

```bash
npx tsx --test tests/snapshots-api.test.ts tests/decks-api.test.ts
npm test
```

Expected: all v0.7 functional tests plus all previous tests pass.

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
- Consumes: completed v0.7 API behavior from Tasks 1-4.
- Produces: release contract `DATA_SERVICE_VERSION='0.7.0'`, unchanged schema `2`, deployment smoke checks for 0.7.0, documentation of supported/deferred deck behavior.

- [ ] **Step 1: Move tests to the 0.7 release contract first**

Change version expectations before changing workflows/service constants:

```ts
assert.equal(DATA_SERVICE_VERSION,'0.7.0');
assert.deepEqual(await publicHealthResponse().json(),{
  ok:true,service:'nakwol-data',version:'0.7.0',schema_version:2,
});
assert.match(workflow,/"version":"0\.7\.0"/);
assert.equal(packageJson.version,'0.7.0');
```

- [ ] **Step 2: Run and record the expected release-contract RED**

```bash
npm test
```

Expected: version/deployment contract tests fail specifically because runtime/package/workflows still advertise 0.6.0. Functional deck/snapshot tests must remain green.

- [ ] **Step 3: Bump runtime/package/workflow versions**

Set:

```ts
export const DATA_SERVICE_VERSION='0.7.0' as const;
export const DATA_SCHEMA_VERSION=2 as const;
```

Set `services/data/package.json` version to `0.7.0`.

In both DATA deployment workflows rename steps to `Verify DATA v0.7` / `Verify production DATA v0.7` and change production health grep from `"version":"0.6.0"` to `"version":"0.7.0"`. Keep `"schema_version":2` unchanged.

- [ ] **Step 4: Document exact v0.7 surface and deferred behavior**

README/DATA/CHANGELOG/release record must include:

- live deck CRUD endpoints;
- atomic composition endpoint;
- owner-only immutable snapshot create/list/detail;
- research/planned unowned generals/tactics policy;
- canonical tactic restriction;
- account-owned type-correct equipment restriction;
- no migration / schema 2;
- `deck_settings`, cross-user sharing, snapshot mutation, game legality rules deferred.

`DATA.md` must preserve all existing Connect control API documentation and previous v0.4-v0.6 sections.

- [ ] **Step 5: Run the complete release candidate verification**

```bash
npm test
npm run typecheck
npm run bundle
```

Expected: zero test failures, typecheck exit 0, Wrangler dry-run bundle exit 0.

- [ ] **Step 6: Commit release preparation**

```bash
git add services/data/src/domain.ts services/data/package.json services/data/tests/domain.test.ts services/data/tests/http.test.ts services/data/tests/deployment.test.ts .github/workflows/bootstrap-data.yml .github/workflows/deploy-data.yml services/data/README.md services/data/CHANGELOG.md DATA.md docs/releases/2026-08-27-nakwol-data-v0.7.md
git commit -m "release(data): prepare v0.7.0"
```

---

### Task 6: PR review, merge, production deployment, and new golden baseline

**Files:**
- Modify after successful production deployment: `docs/releases/2026-08-27-nakwol-data-v0.7.md`
- Modify after successful production deployment: `DATA.md`
- Modify on `main` to trigger deployment: `ops/data-deploy.flag`

**Interfaces:**
- Consumes: fully verified feature branch and existing DATA GitHub Actions deployment pipeline.
- Produces: merged PR, deployed Worker 0.7.0/schema2, recorded Worker Version ID/workflow run/golden commit.

- [ ] **Step 1: Open a draft PR against `main` and inspect the complete diff**

PR title:

```text
Release NAKWOL DATA v0.7 decks and snapshots API
```

Review every changed file for scope creep, owner leaks, accidental Connect-doc deletion, migration changes, or any new game rule not in the approved spec.

- [ ] **Step 2: Verify the exact PR HEAD again**

Use the PR CI logs to confirm the exact final head has:

```text
npm test -> 0 failures
npm run typecheck -> success
npm run bundle -> success
```

Do not merge on stale earlier evidence.

- [ ] **Step 3: Mark ready and merge only the verified head**

Use the expected PR head SHA guard when merging. Record the merge commit in the release record.

- [ ] **Step 4: Trigger production deployment from `main`**

Change `ops/data-deploy.flag` to:

```text
deploy nakwol-data 0.7.0 decks snapshots
```

This must trigger the existing `Deploy NAKWOL DATA` workflow.

- [ ] **Step 5: Verify the production deployment pipeline**

Require every deployment step to succeed:

```text
Verify DATA v0.7
Require existing exact DATA D1
Apply DATA migrations -> No migrations to apply!
Seed DATA Registry
Verify DATA Registry counts -> NAKWOL_DATA_REGISTRY_COUNTS_OK
Deploy DATA Worker
Verify production DATA v0.7 -> NAKWOL_DATA_DEPLOY_OK
```

Production smoke must observe `/api/health` HTTP 200 with service `nakwol-data`, version `0.7.0`, and `/api/schema` HTTP 200 with schema version `2`.

- [ ] **Step 6: Record immutable production evidence**

Update `docs/releases/2026-08-27-nakwol-data-v0.7.md` with:

- PR number;
- merge commit;
- deploy-trigger commit;
- production workflow run ID;
- production Worker Version ID;
- final test count/pass/fail;
- D1 migration result;
- Registry count gate result;
- health/schema smoke result.

Update `DATA.md` `Current production golden` to 0.7.0 and link the v0.7 release record.

- [ ] **Step 7: Final verification of the recorded golden state**

Fetch `DATA.md`, the release record, PR metadata, and production workflow logs from `main`. Confirm the recorded SHAs/IDs match actual GitHub/Cloudflare deployment evidence before declaring v0.7 complete.
