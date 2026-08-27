# NAKWOL DATA v0.8.0 Release Record

Date: 2026-08-27
Service: `nakwol-data`
Target service version: `0.8.0`
Target schema: `3`
Release branch: `feature/nakwol-data-v0.8-equipment-options`
Pull request: `#16`
Base production golden: DATA `0.7.0`, schema `2`
Base main commit: `9608424b520f1320bcf6b30b143ab86c5f48bc9e`

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

Equipment POST/PATCH now accept optional `traits`:

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

## Production verification

Pending merge and production deployment.

Do not replace the DATA v0.7 production golden until all of the following have fresh production evidence:

- PR #16 merged to `main`;
- `ops/data-deploy.flag` triggers DATA 0.8 deployment;
- full tests/typecheck/bundle pass on the exact deploy commit;
- existing exact D1 resolves;
- migration `0003_equipment_options_v08.sql` applies successfully;
- v0.2 Registry plus v0.8 special-option supplement seed successfully;
- original Registry count gate remains unchanged;
- canonical special identity counts are 106 skill / 74 effect;
- initial canonical applicability count is 0;
- Worker deploy completes and returns a new Worker Version ID;
- `/api/health` and `/api/schema` return HTTP 200 with `0.8.0` / schema `3`;
- `NAKWOL_DATA_DEPLOY_OK` is emitted.

## Next planned DATA work

1. recover authoritative weapon/mount applicability and promote verified rows to canonical
2. recover authoritative equipment base-stat option subset and numeric ranges
3. promotion-item Registry
4. `deck_settings` formation/warbook model
