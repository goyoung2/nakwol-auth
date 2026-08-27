# NAKWOL DATA v0.7.0 Release Record

Date: 2026-08-27
Service: `nakwol-data`
Service version: `0.7.0`
Schema: `2`
Release branch: `feature/nakwol-data-v0.7-decks`
Pull request: `#15`
Base production golden: DATA `0.6.0`
Base main commit: `6820c09d5b798030d6f51076eb63ff1d70ce49bc`
Release merge commit: `bfdfd7e2e4605cf0ed13cd5e67be609ea324e996`
Deploy trigger commit: `771b832d731ed6605d5e6435f5c134e6a2cb4d2d`
Production workflow run: `33043770476`
Production Worker Version ID: `1337d16b-1b72-4ec1-b26f-f0a99c5a5330`

## Design and implementation records

- design: `docs/superpowers/specs/2026-08-27-nakwol-data-v0.7-decks-design.md`
- implementation plan: `docs/superpowers/plans/2026-08-27-nakwol-data-v0.7-decks.md`
- approved architecture: live deck CRUD + atomic composition replacement + immutable owner-only snapshots

## Scope

### Live deck API

- `GET /v1/game-accounts/:accountId/decks`
- `POST /v1/game-accounts/:accountId/decks`
- `GET /v1/game-accounts/:accountId/decks/:deckId`
- `PATCH /v1/game-accounts/:accountId/decks/:deckId`
- `DELETE /v1/game-accounts/:accountId/decks/:deckId`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition`

Reads use `decks:read`; writes use `decks:write`.

Composition rules:

- general positions are 1..3;
- tactic slots are 1..2 per general position;
- enabled Registry generals may be planned even when unowned;
- equip tactics may be planned even when unowned, but must satisfy the existing v0.5 canonical chip-linked tactic predicate and may not be a general unique tactic;
- weapon/mount instance references must belong to the same game account and match the equipment type;
- duplicate-general/tactic/equipment restrictions are not invented without authoritative game-rule evidence;
- all references validate before a single D1 batch replaces the previous composition.

### Immutable snapshot API

- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots`
- `GET /v1/deck-snapshots`
- `GET /v1/deck-snapshots/:snapshotId`

Snapshot JSON format version is `1`. It freezes:

- game-account nickname/server;
- deck metadata;
- Registry general ID/name and owned/breakthrough/promotion state;
- equipment instance/template/name plus nickname/locked/favorite state;
- Registry tactic ID/name and owned/breakthrough state.

Snapshot reads use only stored `snapshot_json`; they never rebuild history by joining current live data. Live-deck deletion leaves the snapshot and sets `source_deck_id` to NULL through the existing FK behavior.

Snapshot `visibility` stores `alliance` or `public` for future sharing policy, but v0.7 collection/detail reads remain owner-only regardless of visibility.

## Schema boundary

v0.7 reuses the existing schema-2 tables:

- `decks`
- `deck_general_slots`
- `deck_tactic_slots`
- `deck_snapshots`

No migration is introduced. `deck_settings`, equipment option/trait writes, cross-user snapshot sharing and snapshot mutation/deletion remain deferred.

## TDD and verification history

Initial v0.7 RED — workflow `33042313603`:

- total tests: 64
- passed: 52
- failed: 12
- all pre-v0.7 tests stayed green
- failures: four domain `NOT_IMPLEMENTED` contracts plus eight unimplemented deck/snapshot routes

Domain GREEN — workflow `33042374199`:

- passed: 56
- failed: 8
- all four new domain normalization tests became green
- remaining failures were only unimplemented HTTP routes

Live-deck CRUD GREEN — workflow `33042578443`:

- passed: 60
- failed: 4
- authentication, scopes, owner isolation, create/list/get/patch/delete were green
- remaining failures: composition route plus three snapshot routes

Composition GREEN — workflow `33042790684` after correcting one SQLite test-row comparison issue:

- passed: 61
- failed: 3
- composition planned assets, canonical tactic validation, account-owned equipment/type validation and no-partial-replacement behavior were green
- remaining failures were only snapshot routes

Feature GREEN — workflow `33042947242`, job `98420425107`:

- tests: 64 passed, 0 failed
- snapshot capture-state test: passed
- snapshot immutability-after-live-change test: passed
- snapshot owner-isolation test: passed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed

Release-contract RED — workflow `33043089726`, job `98420872537`:

- tests: 63 passed, 1 failed
- only failure: deployment contract correctly detected that bootstrap/deploy workflows still asserted DATA `0.6.0`
- service/package/health and all feature tests already asserted `0.7.0`

Release-contract GREEN — workflow `33043165550`, job `98421110403`:

- deployment workflows updated to assert `0.7.0`
- full tests: passed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed

Code-review RED — workflow `33043519789`, job `98422199331`:

- total tests: 65
- passed: 64
- failed: 1
- newly added snapshot-create scope/source-deck-owner isolation test passed
- only failure: explicit `visibility: null` was incorrectly treated as an omitted value and defaulted to `alliance`

Review-fix GREEN — workflow `33043642697`, job `98422584863`, head `ab0c1f46dafdb5810f670fd2f707b446c6da18c5`:

- tests: 65 passed, 0 failed
- explicit null snapshot visibility is rejected
- snapshot-create scope and source-deck ownership isolation passed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed
- final diff review found no additional blocking issue

## Production verification

Production deployment completed successfully on 2026-08-27.

- PR #15 merge commit: `bfdfd7e2e4605cf0ed13cd5e67be609ea324e996`
- deploy-trigger commit: `771b832d731ed6605d5e6435f5c134e6a2cb4d2d`
- deployment workflow: `Deploy NAKWOL DATA`, run `33043770476`, job `98422986831`
- production Worker Version ID: `1337d16b-1b72-4ec1-b26f-f0a99c5a5330`
- deploy-time tests: 65 passed, 0 failed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed
- exact DATA D1 binding: `NAKWOL_DATA_D1_READY`
- D1 migrations: `No migrations to apply!`
- Registry seed: `NAKWOL_DATA_REGISTRY_SEEDED:0.2.0:--remote`
- Registry import: 2,155 queries processed
- Registry counts: generals 209, enabled generals 140, tactics 1,077, equipment templates 134, stat types 281, formations 8, warbooks 442
- Registry count gate: `NAKWOL_DATA_REGISTRY_COUNTS_OK`
- production `/api/health`: HTTP 200
- production `/api/schema`: HTTP 200
- production contract: service `nakwol-data`, version `0.7.0`, schema `2`
- production smoke matched the full v0.7 contract on attempt 1
- production smoke gate: `NAKWOL_DATA_DEPLOY_OK`

This release is the production golden baseline for NAKWOL DATA through permanent player assets, live deck editing and immutable deck snapshots.

## Next planned DATA work

1. authoritative equipment option/trait Registry and option API
2. promotion-item Registry completion
3. `deck_settings` formation/warbook model and API design
