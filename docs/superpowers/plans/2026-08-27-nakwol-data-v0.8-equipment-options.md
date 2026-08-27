# NAKWOL DATA v0.8 Equipment Options Implementation Plan

**Goal:** Promote 180 Korean-client equipment special-option identities into authoritative DATA Registry, add schema-3 applicability evidence, expose Registry reads, and support evidence-gated equipment trait writes while keeping generic stat writes blocked.

**Architecture:** Keep v0.2 Registry immutable in meaning. Add a v0.8 supplement seed containing `equipment_skill` / `equipment_effect` identities. Schema 3 separates canonical identity from weapon/mount applicability. Existing equipment instance routes gain whole-set trait replacement, and deck snapshots freeze trait display state.

**Base:** production golden DATA `0.7.0`, schema `2`, main `9608424b520f1320bcf6b30b143ab86c5f48bc9e`.

**Branch:** `feature/nakwol-data-v0.8-equipment-options`

**TDD rule:** for every behavior change, commit a failing test first and verify that it fails for the intended missing behavior before production code is added.

---

## Task 1 — Schema 3 contract

Files:
- Create `services/data/migrations/0003_equipment_options_v08.sql`
- Modify `services/data/tests/migration.test.mjs`
- Modify any shared test migration loader that currently concatenates only 0001+0002.

RED:
- assert schema becomes 3;
- assert `game_equipment_traits` has `native_id`, `kind`, `evidence_state`;
- assert `(kind,native_id)` unique when populated;
- assert `game_equipment_trait_applicability` exists with typed equipment/evidence constraints;
- assert old schema-2 data remains valid through migration.

GREEN:
- add only the columns/table/index required by the approved design;
- update `data_schema_meta` to 3;
- do not alter existing user equipment/stat/trait rows destructively.

Gate:
- migration tests green;
- all prior tests still green except deliberate future RED tests.

## Task 2 — Deterministic v0.8 special-option supplement

Files:
- Create `services/data/seeds/equipment-options-v0.8.json` or compact split equivalent;
- Create `services/data/scripts/equipment-options-seed.mjs` if a loader is needed;
- Create/modify `services/data/scripts/seed-registry.mjs` to apply the supplement after v0.2 Registry;
- Create `services/data/tests/equipment-options-seed.test.mjs`;
- Modify `services/data/tests/registry-import.test.mjs`.

Source authority snapshot:
- repository: `goyoung2/nslg-warroom`
- path: `viewer/enemy-decks/gear-catalog.json`
- blob: `c1f94bc603be73c7498aa7258ba5b68cb8c32536`
- source contents: 106 `skills`, 74 `effects`, `unresolved=[]`.

RED:
- seed artifact absent or loader cannot produce 180 canonical identities;
- assert stable IDs `ets:<id>` and `ete:<id>`;
- assert examples: `ets:56=구주`, `ete:54=투영`;
- assert 106 skill + 74 effect + zero unresolved identities;
- assert source repository/path/blob provenance;
- assert seed rerun preserves user-owned rows;
- assert no canonical applicability is invented from names/ID ranges/absence of observations.

GREEN:
- commit deterministic normalized supplement;
- UPSERT `game_equipment_traits` only;
- UPSERT applicability only if separately supplied with evidence;
- no DELETE/TRUNCATE;
- update Registry meta with supplement version/provenance.

Gate:
- deterministic counts/provenance green;
- idempotent import green.

## Task 3 — Equipment-trait Registry read API

Files:
- Modify `services/data/src/domain.ts`
- Modify `services/data/src/store.ts`
- Modify `services/data/src/routes/registry.ts`
- Modify `services/data/src/index.ts`
- Add `services/data/tests/equipment-traits-registry-api.test.ts` or extend Registry API tests.

RED:
- `GET /v1/registry/equipment-traits` is 404 before implementation;
- without `equipment:read`, request is denied;
- with scope, canonical identity rows and applicability evidence are returned;
- observed/unresolved applicability is visible but distinguishable;
- cross-scope behavior remains deny-by-default.

GREEN:
- add typed Registry DTO/store query;
- join applicability rows ordered by type;
- route requires `equipment:read`;
- do not change existing Registry endpoint behavior.

Gate:
- new Registry tests green;
- prior Registry tests green.

## Task 4 — Equipment trait mutation domain contract

Files:
- Modify `services/data/src/domain.ts`
- Modify `services/data/tests/domain.test.ts`.

RED:
- `traits` currently throws `EQUIPMENT_OPTIONS_UNSUPPORTED`;
- define accepted `[{slot:1|2, trait_id:string}]` normalization;
- reject non-array, >2 rows, invalid slot, blank ID, duplicate slot;
- allow identical trait IDs in different slots;
- distinguish omitted PATCH traits from `traits:[]`;
- keep any `stats` input rejected.

GREEN:
- add trait input types and normalizer;
- create accepts traits optionally;
- patch uses `traits?: ... | undefined` whole-set semantics;
- `stats` remains unsupported.

Gate:
- domain tests green.

## Task 5 — Evidence-gated equipment trait writes

Files:
- Modify `services/data/src/store.ts`
- Modify `services/data/src/routes/equipment.ts`
- Modify `services/data/tests/equipment-api.test.ts`.

RED scenarios:
- canonical identity + canonical matching type applicability succeeds;
- canonical identity with no applicability returns `EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE`;
- observed/unresolved identity returns `EQUIPMENT_TRAIT_UNVERIFIED`;
- missing/disabled identity returns `EQUIPMENT_TRAIT_NOT_FOUND`;
- canonical applicability for the other equipment type is rejected;
- two input rows where the second is invalid leave previous trait set untouched;
- PATCH omission preserves traits;
- `traits:[]` clears traits;
- same trait ID in slots 1 and 2 is accepted;
- cross-account access remains not-found/isolated;
- `stats` remains rejected.

GREEN:
- add store query that resolves identity plus applicability for the target template type;
- validate every row before mutation;
- create equipment + traits through one D1 batch;
- patch base fields + optional whole trait set through one D1 batch where needed;
- list/get/create/patch return joined trait display information.

Gate:
- equipment API suite green;
- owner-isolation tests green.

## Task 6 — Snapshot trait freezing

Files:
- Modify `services/data/src/snapshots-store.ts`
- Modify `services/data/tests/snapshots-api.test.ts`.

RED:
- snapshot of a deck using an equipment instance with traits currently omits trait state;
- after snapshot creation, rename Registry trait and replace live equipment traits;
- old snapshot must still retain original trait ID/kind/name/description.

GREEN:
- snapshot capture joins current equipment traits and embeds them in weapon/mount snapshot objects;
- snapshot reads continue to use only stored `snapshot_json`.

Gate:
- snapshot trait freeze test green;
- all previous snapshot tests green.

## Task 7 — Version 0.8 / schema 3 release contract

Files:
- Modify `services/data/src/domain.ts`
- Modify `services/data/package.json`
- Modify `services/data/tests/http.test.ts`
- Modify `services/data/tests/deployment.test.ts`
- Modify `.github/workflows/bootstrap-data.yml`
- Modify `.github/workflows/deploy-data.yml`
- Modify `services/data/README.md`
- Modify `services/data/CHANGELOG.md`
- Modify `DATA.md`
- Create `docs/releases/2026-08-27-nakwol-data-v0.8.md`.

Release-contract RED:
- service/package/health tests demand `0.8.0` and schema `3` while workflows still assert 0.7/2.

GREEN:
- workflows migrate existing D1 to schema3;
- apply v0.2 Registry then v0.8 supplement;
- production count gate verifies existing Registry counts plus exactly 106 skill / 74 effect canonical special identities;
- health/schema smoke expects `0.8.0` / `3`;
- docs explicitly state that generic stats remain blocked and canonical type applicability controls real writes.

Gate:
- full test suite passes;
- `tsc --noEmit` passes;
- `wrangler deploy --dry-run` passes.

## Task 8 — Review, merge, production deployment

- Open/update PR from `feature/nakwol-data-v0.8-equipment-options` to `main`.
- Review entire diff for ownership leakage, partial mutation, migration safety, seed destructiveness, evidence overclaim, route collisions, and snapshot regressions.
- Add review-driven RED tests for any discovered edge case before fixes.
- Verify exact final HEAD with full tests/typecheck/bundle.
- Merge PR.
- Update `ops/data-deploy.flag` to trigger 0.8 deploy.
- Verify production workflow on exact deploy commit:
  - full tests/typecheck/bundle;
  - exact existing D1;
  - migration 0003 applies once;
  - v0.2 Registry seed succeeds;
  - v0.8 special-option supplement succeeds;
  - original Registry counts preserved;
  - special identity counts 106/74;
  - Worker deployment returns new Version ID;
  - `/api/health` and `/api/schema` HTTP 200 with `0.8.0` / schema `3`;
  - deployment marker emitted.
- Only then update `DATA.md` Current production golden and release record with merge/deploy/run/Worker IDs.
