# NAKWOL DATA v0.7.0 Release Record

Date: 2026-08-27
Service: `nakwol-data`
Target service version: `0.7.0`
Schema: `2`
Release branch: `feature/nakwol-data-v0.7-decks`
Pull request: `#15`
Base production golden: DATA `0.6.0`
Base main commit: `6820c09d5b798030d6f51076eb63ff1d70ce49bc`

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
- snapshot capture state test: passed
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

## Production verification

Pending merge and production deployment.

Do not replace the DATA v0.6 production golden until all of the following have fresh production evidence:

- PR #15 merged to `main`;
- `ops/data-deploy.flag` triggers DATA 0.7 deployment;
- deploy-time full tests/typecheck/bundle pass;
- exact existing D1 is resolved;
- D1 reports no new migration to apply;
- Registry UPSERT and count gate pass;
- Worker deploy completes and returns a new Worker Version ID;
- `/api/health` and `/api/schema` return HTTP 200 with service `nakwol-data`, version `0.7.0`, schema `2`;
- `NAKWOL_DATA_DEPLOY_OK` is emitted.

## Next planned DATA work

1. authoritative equipment option/trait Registry and option API
2. promotion-item Registry completion
3. `deck_settings` formation/warbook model and API design
