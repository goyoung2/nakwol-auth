# NAKWOL DATA v0.8.0 Release Record

Date: 2026-08-27
Service: `nakwol-data`
Service version: `0.8.0`
Schema: `3`
Release branch: `feature/nakwol-data-v0.8-equipment-options`
Pull request: `#16`
Base production golden: DATA `0.7.0`, schema `2`
Base main commit: `9608424b520f1320bcf6b30b143ab86c5f48bc9e`
Release merge commit: `509b74259891a54adf81cef29a0a3d84f2d01b43`
Deploy trigger commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
Production workflow: `33051511909`
Production job: `98447911107`
Production Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
Production golden marker commit: `4af1635b08c0b69c1f952ae58618c506cb747855`

## Design and plan

- design: `docs/superpowers/specs/2026-08-27-nakwol-data-v0.8-equipment-options-design.md`
- implementation plan: `docs/superpowers/plans/2026-08-27-nakwol-data-v0.8-equipment-options.md`
- architecture: evidence-gated hybrid; canonical identity and weapon/mount applicability are independent facts.

## Canonical identity source

Frozen source artifact:

- repository: `goyoung2/nslg-warroom`
- path: `viewer/enemy-decks/gear-catalog.json`
- blob SHA: `c1f94bc603be73c7498aa7258ba5b68cb8c32536`
- generator evidence: `nslg-battle-report-platform/tools/battle_replay_pipeline/product_projection/build_enemy_deck_gear_catalog.js`
- underlying client table: `decompiled_lua/Data/Scenario2001/equipment.lua`
- identities: 106 `equipment_skill` + 74 `equipment_effect` = 180
- unresolved localization: 0
- stable IDs: `ets:<native_id>` / `ete:<native_id>`

The initial supplement deliberately contains zero canonical weapon/mount applicability rows. Runtime `equipData` / `horseData` occurrence evidence is not promoted into a complete possibility rule.

## Schema 3

Migration: `services/data/migrations/0003_equipment_options_v08.sql`

Adds to `game_equipment_traits`:

- `native_id`
- `kind = skill|effect`
- `evidence_state = canonical|observed|unresolved`
- partial unique `(kind,native_id)` index

Adds `game_equipment_trait_applicability` with independent equipment type/evidence state/source metadata.

Existing schema-2 user equipment and `user_equipment_traits` rows are preserved. Legacy trait identities default to `unresolved`, so they cannot accidentally become write-authority.

## API scope

Registry:

- `GET /v1/registry/equipment-traits` — `equipment:read`

Equipment POST/PATCH accept optional `traits`:

```json
{
  "traits": [
    { "slot": 1, "trait_id": "ets:56" },
    { "slot": 2, "trait_id": "ete:54" }
  ]
}
```

Write gate:

- enabled Registry identity required;
- identity evidence must be `canonical`;
- stable identity must agree with kind/native ID;
- matching `weapon`/`mount` applicability evidence must be `canonical`;
- all references validate before D1 batch mutation;
- PATCH omission preserves the current set;
- `traits: []` clears the set;
- duplicate slot is rejected;
- repeated trait ID and skill/effect combination rules are not invented without authoritative evidence.

Generic `stats` remains explicitly unsupported. The 281 generic stat definitions are not treated as an equipment-option catalog.

Equipment reads expose current trait ID/kind/name/description. Deck snapshots freeze the same trait display state at snapshot creation time.

## TDD and verification history

Schema-3 RED — workflow `33046857397`, job `98432781624`:

- 66 tests total
- 64 passed
- 2 failed only because schema 3/table did not exist
- prior feature contracts remained green

Schema-3 GREEN — branch commit `20ff53a65aba4b74a83bcf7cb800b872d2bb9c19`:

- schema-2 data -> schema-3 migration verified
- legacy user trait row preserved
- tests/typecheck/bundle green

Seed artifact RED — workflow `33047101848`, job `98433557589`:

- 67 tests total
- 66 passed
- only failure: v0.8 equipment-option supplement absent

Registry import RED — workflow `33047598550`, job `98435162924`:

- only failure: `game_equipment_traits` remained 0 instead of 180

Seed/import GREEN — workflow `33047834086`:

- deterministic 106 skill / 74 effect expansion
- idempotent UPSERT
- user equipment trait preservation
- typecheck/bundle green

Registry API RED — workflow `33047986356`, job `98436403661`:

- 68 tests total
- 67 passed
- only failure: unimplemented equipment-trait scope mapping/fallback behavior

Registry API GREEN — workflow `33048169320`, job `98436995715`:

- 68/68
- typecheck passed
- Worker bundle passed

Mutation-domain RED — workflow `33048259679`, job `98437278421`:

- 68 total / 66 passed
- only the two new trait input contracts failed

Equipment persistence RED — workflow `33048573438`, job `98438273302`:

- 68 total / 65 passed
- failures were only missing trait read/POST/PATCH persistence

Equipment persistence GREEN — workflow `33048739809`, job `98438813837`:

- 68/68
- canonical identity + canonical target-type gate verified
- missing/disabled/observed/wrong-type rejection verified
- no-partial-replacement behavior verified
- same trait ID in slots 1/2 allowed
- stats still rejected
- typecheck/bundle passed

Snapshot RED — workflow `33048850336`, job `98439161445`:

- 68 total / 66 passed
- only the two new equipment-trait snapshot assertions failed

Snapshot GREEN — workflow `33048942152`, job `98439458137`:

- 68/68
- trait ID/kind/name/description capture passed
- later Registry/live equipment changes do not mutate stored snapshot JSON
- typecheck/bundle passed

Release-contract RED — workflow `33049161672`, job `98440164656`:

- 68 total / 67 passed
- only failure: bootstrap/deploy workflows still asserted DATA `0.7.0 / schema 2`
- all functional v0.8 tests were green

Release-contract GREEN — workflow `33049359159`, job `98440803851`:

- 68/68
- TypeScript typecheck passed
- Worker dry-run bundle passed
- bootstrap/deploy contracts updated to `0.8.0 / schema 3`
- production count gate includes 106 canonical skill identities, 74 canonical effect identities and initial canonical applicability count 0

Review-driven D1 limit RED — workflow `33049932802`, job `98442678791`:

- 70 tests total
- 69 passed
- only failure: an inventory of 101 equipment instances caused one trait-read `IN (...)` query to bind 101 IDs and exceed the guarded D1 100-bound-parameter limit
- functional v0.8 contracts remained green

Review-driven D1 limit GREEN — branch commit `2c66200c5c117cef12c3e7c232e265cfd2ba145e`, workflow `33051086648`, job `98446490878`:

- trait reads are chunked at a maximum of 100 equipment IDs per query
- 70/70 tests passed
- D1 large-inventory regression passed
- TypeScript typecheck passed
- Worker dry-run bundle passed
- no API, evidence, ownership or mutation contract changed by the fix

Final release-candidate verification — HEAD `7536f163496c154870b53b5b835c48d8389b23cc`, workflow `33051385526`, job `98447492127`:

- 70/70 tests passed
- canonical authority regression passed
- D1 100-bound-parameter regression passed
- TypeScript typecheck passed
- Worker dry-run bundle passed

## Production verification

PR #16 merged successfully:

- merge commit: `509b74259891a54adf81cef29a0a3d84f2d01b43`
- deploy trigger commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- production workflow: `33051511909`
- production job: `98447911107`

Exact deploy commit verification:

- 70/70 tests passed
- TypeScript `tsc --noEmit` passed
- Worker dry-run bundle passed
- bundle: 147.19 KiB / gzip 30.48 KiB
- exact D1 resolved: `NAKWOL_DATA_D1_READY`

Production D1 migration:

- remote D1 ID: `80b1d21d-a3d1-47ec-b16a-d4403a1f0cb3`
- migration applied: `0003_equipment_options_v08.sql`
- migration status: success
- 9 migration commands executed

Production Registry seed:

- 2338 queries processed
- 2694 rows read
- 3142 rows written
- `NAKWOL_DATA_REGISTRY_SEEDED:0.2.0:--remote`
- `NAKWOL_DATA_EQUIPMENT_OPTIONS_SEEDED:0.8.0:--remote`

Production Registry count gate:

- generals: 209
- enabled generals: 140
- tactics: 1077
- equipment templates: 134
- stat types: 281
- formations: 8
- warbooks: 442
- canonical skill traits: 106
- canonical effect traits: 74
- canonical applicability: 0
- marker: `NAKWOL_DATA_REGISTRY_COUNTS_OK`

Worker production deploy:

- origin: `https://nakwol-data.sepsd21.workers.dev`
- Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
- startup time: 5 ms

Production smoke:

- attempt 1: health HTTP 200
- attempt 1: schema HTTP 200
- health service/version matched `nakwol-data / 0.8.0`
- schema matched `3`
- marker: `NAKWOL_DATA_DEPLOY_OK`

`DATA.md` was promoted to the v0.8 production golden in commit `4af1635b08c0b69c1f952ae58618c506cb747855` only after all production evidence above was green.

## Current production boundary

v0.8 production includes all prior v0.4–v0.7 DATA capabilities plus schema-3 equipment special-option identity Registry, evidence-gated trait mutation, equipment trait display reads, snapshot trait freezing, and the large-inventory D1 bind-limit fix.

Canonical applicability remains intentionally 0 in this release. Therefore trait mutation is implemented but safely closed in production until authoritative weapon/mount applicability evidence is added. Generic equipment stat options remain unsupported for the same evidence-quality reason.

## Next planned DATA work

1. recover authoritative weapon/mount applicability and promote verified rows to canonical
2. recover authoritative equipment base-stat option subset and numeric ranges
3. promotion-item Registry
4. `deck_settings` formation/warbook model
