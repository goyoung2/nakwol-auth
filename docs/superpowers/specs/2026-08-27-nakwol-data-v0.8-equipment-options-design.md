# NAKWOL DATA v0.8 Equipment Options Design

Date: 2026-08-27
Target service: `nakwol-data`
Target service version: `0.8.0`
Target schema: `3`
Base production golden: DATA `0.7.0`, schema `2`
Base main commit: `9608424b520f1320bcf6b30b143ab86c5f48bc9e`

## Goal

Open the first authoritative equipment special-option path without reinterpreting the existing 281 generic game stat definitions as equipment options. v0.8 promotes client-backed equipment `skill`/`effect` identities into Registry, exposes their evidence status, and implements mutation support behind an explicit applicability write gate.

A production trait is writable only when both its identity and its applicability to the target equipment type have canonical evidence. The first v0.8 seed is allowed to contain zero canonically writable applicability rows rather than fabricate a rule. This means Registry/read support and the mutation contract can ship before every applicability rule is known.

## Evidence boundary

The previously imported `nslg-s-season-raw-research-kit-v1` contains equipment templates and generic stat definitions, but it does not provide a complete authoritative equipment option/trait mapping. Therefore v0.6 correctly rejected both `stats` and `traits` writes.

Newly identified project evidence changes the special-option boundary:

- `nslg-battle-report-platform/tools/battle_replay_pipeline/product_projection/build_enemy_deck_gear_catalog.js` reads the Korean client `decompiled_lua/Data/Scenario2001/equipment.lua` and parses `equipment_skill[...]` and `equipment_effect[...]` records with Korean localization. This is canonical client evidence for special-option identity, native ID, name, and description.
- The committed derived artifact `goyoung2/nslg-warroom/viewer/enemy-decks/gear-catalog.json`, blob `c1f94bc603be73c7498aa7258ba5b68cb8c32536`, contains 106 `skills`, 74 `effects`, and zero unresolved localization rows. These 180 rows form the v0.8 canonical identity source snapshot.
- `nslg-battle-report-platform/tools/battle_replay_pipeline/product_projection/combatant_detail_projection.js` projects runtime `equipData` and `horseData` as slot/key/value observations. Runtime option keys are structurally distinct: `might`, `intelligence`, `defence`, `speed`, `skill`, and `effect`.
- Runtime observations prove that a combination occurred, but absence from observations never proves a combination is impossible.
- The DATA schema already has `game_equipment_traits`, `user_equipment_traits`, and two trait slots per equipment instance.

v0.8 preserves the distinction between canonical identity and observed applicability.

## Chosen architecture: evidence-gated hybrid

Registry identities are canonical when backed by client `equipment_skill` / `equipment_effect` records. Applicability to `weapon` or `mount` is a separate relation with an evidence state. User writes are allowed only when both identity and applicability pass the write gate.

Evidence states:

- `canonical`: directly backed by the authoritative client source for the claimed fact.
- `observed`: seen in runtime/report evidence but not sufficient to claim a complete rule.
- `unresolved`: preserved data whose meaning/applicability is not yet safe for mutation validation.

`observed` records are readable but never become write authority automatically.

## Schema 3

The existing `game_equipment_traits` table remains the canonical identity table. Schema 3 adds explicit typed identity/evidence columns and a separate applicability table.

`game_equipment_traits` additions:

- `native_id INTEGER`
- `kind TEXT CHECK(kind IN ('skill','effect'))`
- `evidence_state TEXT NOT NULL DEFAULT 'unresolved' CHECK(evidence_state IN ('canonical','observed','unresolved'))`

A partial unique index enforces `(kind, native_id)` uniqueness when both are present.

New table `game_equipment_trait_applicability`:

- `trait_id TEXT NOT NULL`
- `equipment_type TEXT NOT NULL CHECK(equipment_type IN ('weapon','mount'))`
- `evidence_state TEXT NOT NULL CHECK(evidence_state IN ('canonical','observed','unresolved'))`
- `source_locator TEXT`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- primary key `(trait_id, equipment_type)`
- FK to `game_equipment_traits(id)` with `ON DELETE CASCADE`

The existing `game_equipment_traits.equipment_type` column is retained for compatibility but is not mutation authority. New code uses the applicability table. Unknown type is represented by no canonical applicability row, not by pretending `equipment_type='any'`.

Schema version becomes `3` through migration `0003_equipment_options_v08.sql`.

## Stable IDs

Canonical Registry IDs use distinct namespaces so equal source-native numbers from the two client tables cannot collide:

- `ets:<native_id>` for `equipment_skill`
- `ete:<native_id>` for `equipment_effect`

The source-native ID and kind are also stored in columns and provenance metadata.

## Registry ingestion

v0.8 adds a deterministic supplement seed for equipment special options instead of changing the meaning of the existing v0.2 Registry seed.

The initial committed supplement is generated from the frozen `gear-catalog.json` source snapshot and contains:

- 106 canonical `skill` identities;
- 74 canonical `effect` identities;
- zero unresolved identity rows;
- zero or more applicability rows, but only when applicability has separate explicit evidence;
- source repository/path/blob SHA and original source paths as provenance;
- counts used by tests and deployment gates.

The builder/importer never infers applicability from missing observations, text keywords, numeric ID ranges, generic stat IDs, or duplicate names. Production seeding remains UPSERT-only and never deletes user-owned rows.

## Registry API

Add authenticated Registry endpoint:

`GET /v1/registry/equipment-traits`

It requires `equipment:read` and returns enabled identities with:

- `id`
- `native_id`
- `kind`
- `name`
- `description`
- `evidence_state`
- `applicability[]` containing equipment type and evidence state
- provenance metadata safe for Registry responses

Observed/unresolved applicability remains visible so clients can explain why an identity is not currently writable.

Existing `GET /v1/registry/equipment` remains unchanged.

## User equipment API

v0.8 keeps the existing equipment routes:

- `GET /v1/game-accounts/:accountId/equipment`
- `POST /v1/game-accounts/:accountId/equipment`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId`

`traits` becomes a supported field on POST/PATCH.

Canonical request shape:

```json
{
  "traits": [
    { "slot": 1, "trait_id": "ets:123" },
    { "slot": 2, "trait_id": "ete:456" }
  ]
}
```

Rules:

- maximum two rows;
- slots are integer 1 or 2 and unique;
- `trait_id` must exist and be enabled;
- trait identity must have `evidence_state='canonical'`;
- the target equipment template type must have a matching applicability row with `evidence_state='canonical'`;
- all trait references validate before replacement;
- POST inserts the equipment instance and trait rows atomically;
- PATCH replaces the entire trait set only when `traits` is present; omission leaves traits unchanged; `traits: []` clears both slots;
- cross-account mutation remains impossible through existing owner isolation;
- the same `trait_id` in both slots is not rejected unless later authoritative game evidence establishes that restriction; v0.8 does not invent it.

`stats` remains unsupported in v0.8 and continues to return `EQUIPMENT_OPTIONS_UNSUPPORTED` because the generic 281 stat Registry is not an authoritative equipment-stat option domain.

## Read representation

Equipment list/create/patch responses include `traits` joined with Registry display data:

```json
{
  "slot": 1,
  "trait_id": "ets:123",
  "kind": "skill",
  "name": "...",
  "description": "..."
}
```

Deck snapshot behavior is extended so a snapshot freezes the equipment traits attached at snapshot creation time, including Registry ID/kind/name/description. Later Registry renames or equipment edits do not mutate existing snapshot JSON.

## Errors

New stable errors:

- `INVALID_EQUIPMENT_TRAITS`
- `DUPLICATE_EQUIPMENT_TRAIT_SLOT`
- `EQUIPMENT_TRAIT_NOT_FOUND`
- `EQUIPMENT_TRAIT_UNVERIFIED`
- `EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE`

Invalid trait mutation must not partially replace previous trait rows.

## Security and ownership

No new DATA scope is introduced. Registry reading uses `equipment:read`; equipment mutation uses `equipment:write`. AUTH verification, client binding, browser Origin forwarding, deny-by-default scopes, game-account ownership checks, and cross-account not-found behavior remain unchanged.

## Explicitly deferred

v0.8 does not:

- treat all 281 `game_stat_types` as equipment options;
- open `user_equipment_stats` writes;
- infer min/max numeric stat-option values;
- infer weapon/mount applicability from names, text, ID ranges, or missing observations;
- add public/cross-user equipment sharing;
- change equipment template identity or v0.7 deck composition rules;
- invent a rule requiring one `skill` plus one `effect`, forbidding two of the same kind, or forbidding the same ID in both slots.

## Testing contract

TDD must cover:

- schema 2 -> 3 migration;
- deterministic 106+74 identity supplement and provenance;
- idempotent UPSERT preservation of user-owned rows;
- Registry endpoint scope/evidence output;
- POST/PATCH trait success only with canonical identity + canonical type applicability;
- observed/unresolved/missing/wrong-type rejection;
- owner isolation;
- unique slot validation;
- all-reference validation before mutation and no partial replacement;
- `stats` still rejected;
- equipment reads include traits;
- v0.7 deck snapshots freeze attached trait display state;
- all existing 65 v0.7 tests remain green;
- service `0.8.0`, schema `3`, typecheck, Worker bundle, deploy workflow migration/seed/count/smoke gates.

## Release boundary

Do not replace the v0.7 production golden until the exact merged main commit has passed full tests/typecheck/bundle, schema-3 migration on the existing D1, special-option seed/count validation, Worker deployment, and production `/api/health` + `/api/schema` smoke for `0.8.0` / schema `3`.
