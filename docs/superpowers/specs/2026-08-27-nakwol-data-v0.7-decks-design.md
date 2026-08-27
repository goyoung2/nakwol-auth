# NAKWOL DATA v0.7 Decks & Snapshots Design

Date: 2026-08-27
Target service: `nakwol-data`
Target service version: `0.7.0`
Schema version: `2` (unchanged)
Base production golden: DATA `0.6.0`
Base main commit: `6820c09d5b798030d6f51076eb63ff1d70ce49bc`
Branch: `feature/nakwol-data-v0.7-decks`

## 1. Purpose

v0.7 adds the first complete deck-management API on top of the permanent player assets already shipped in v0.4-v0.6.

The goal is to let an authenticated NAKWOL user:

1. create and manage live deck records;
2. build a planned or actual 3-general composition;
3. assign up to two equipable tactics per general position;
4. attach owned weapon/mount equipment instances;
5. freeze the current deck into an immutable snapshot that remains stable even if the live deck or owned assets later change.

The DATA layer stores factual structure and ownership boundaries. It does not invent unsourced combat/game legality rules.

## 2. Existing schema reused

No v0.7 migration is required. Schema 2 already contains:

- `decks`
- `deck_general_slots`
- `deck_tactic_slots`
- `deck_settings`
- `deck_snapshots`

Existing permanent-asset tables are reused for validation and snapshot enrichment:

- `user_generals`
- `user_tactics`
- `user_equipment`
- `game_generals`
- `game_tactics`
- `game_equipment_templates`
- `game_seasons`

`decks:read` and `decks:write` already exist in the DATA scope vocabulary.

## 3. API surface

### 3.1 Live decks

- `GET /v1/game-accounts/:accountId/decks` — `decks:read`
- `POST /v1/game-accounts/:accountId/decks` — `decks:write`
- `GET /v1/game-accounts/:accountId/decks/:deckId` — `decks:read`
- `PATCH /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `DELETE /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition` — `decks:write`

### 3.2 Snapshots

- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots` — `decks:write`
- `GET /v1/deck-snapshots` — `decks:read`
- `GET /v1/deck-snapshots/:snapshotId` — `decks:read`

Snapshot collection reads are intentionally user-scoped rather than account-scoped. The existing schema stores `owner_user_id` and permits `source_deck_id` to become NULL after the source deck is deleted. A user-scoped collection therefore preserves access to historical snapshots after live-deck deletion without relying on JSON filtering or inventing an account column that does not exist.

v0.7 snapshot reads remain owner-only. `visibility` is persisted as future sharing-policy metadata, but public/alliance cross-user read endpoints are not opened in this release.

## 4. Live deck model

### 4.1 Create payload

```json
{
  "name": "조조 사마의 순욱 연구덱",
  "season_id": null,
  "status": "research",
  "visibility": "private",
  "note": "S시즌 후보",
  "is_primary": false
}
```

Rules:

- `name`: required non-empty trimmed string.
- `season_id`: optional/null. If non-null, it must reference an enabled `game_seasons` row. Clients may omit it while no authoritative season Registry is populated.
- `status`: optional; one of `active`, `candidate`, `research`, `archived`; default `active`.
- `visibility`: optional; one of `private`, `alliance`, `public`; default `private`.
- `note`: optional string; trim and store empty as null.
- `is_primary`: optional boolean; default false.

The service does not invent a uniqueness rule for `is_primary` because schema 2 does not define one and the game meaning is not authoritative yet.

POST creates an empty live deck. Composition is written separately and atomically through the composition endpoint.

### 4.2 PATCH payload

PATCH can mutate:

- `name`
- `season_id`
- `status`
- `visibility`
- `note`
- `is_primary`

The deck ID and account ID are immutable. An empty PATCH is rejected.

### 4.3 List/read responses

List responses return deck metadata plus structural counts suitable for cards/index views:

- `general_count`
- `tactic_count`
- `equipment_count`

Single-deck GET returns metadata plus the full ordered composition.

No other user's `account_id`, user ID, or private ownership metadata is exposed.

## 5. Composition contract

### 5.1 PUT payload

`PUT /v1/game-accounts/:accountId/decks/:deckId/composition` replaces the entire composition in one operation.

```json
{
  "generals": [
    {
      "position": 1,
      "general_id": "g:10001",
      "weapon_instance_id": "eqp_abc123",
      "mount_instance_id": null,
      "tactics": [
        { "slot": 1, "tactic_id": "t:20010" },
        { "slot": 2, "tactic_id": "t:20350" }
      ]
    }
  ]
}
```

`generals: []` is valid and clears the composition.

### 5.2 Structural validation

- general `position` must be integer 1..3 and unique within the request;
- each general position may contain zero, one, or two tactic slots;
- tactic `slot` must be integer 1..2 and unique within that general position;
- every `general_id` must be an enabled `game_generals` Registry row;
- every tactic in an equip slot must satisfy the already-established v0.5 canonical equipable-tactic predicate and must not be a general unique tactic;
- a general or tactic does **not** need to be present in `user_generals` / `user_tactics`; this deliberately supports candidate/research deck planning;
- `weapon_instance_id`, when non-null, must be a `user_equipment` row owned by the same game account and its Registry template type must be `weapon`;
- `mount_instance_id`, when non-null, must be owned by the same game account and have template type `mount`.

### 5.3 Rules deliberately not invented

v0.7 does not reject a composition merely because:

- the same general appears in multiple positions;
- the same canonical tactic appears in more than one slot;
- the same equipment instance is referenced in more than one position;
- a specific general/tactic combination may be undesirable or illegal in some game context.

Those are game-rule decisions and require authoritative evidence before DATA enforces them.

### 5.4 Atomic replacement

The endpoint validates the complete requested composition before mutation. After all validation succeeds, DATA replaces `deck_general_slots` and `deck_tactic_slots` together and updates the deck timestamp using a D1 batch/transactional write pattern.

If any validation fails, the previous composition remains unchanged.

## 6. Snapshot model

### 6.1 Creation

`POST /v1/game-accounts/:accountId/decks/:deckId/snapshots`

Body:

```json
{
  "visibility": "alliance"
}
```

Allowed snapshot visibility values follow the existing schema: `alliance` or `public`. Default is `alliance`.

The snapshot gets a DATA-generated `dks_...` ID.

### 6.2 Immutable snapshot JSON

`snapshot_json` uses an explicit format version:

```json
{
  "format_version": 1,
  "captured_at": 0,
  "account": {
    "id": "gac_...",
    "nickname": "...",
    "server_code": "5"
  },
  "deck": {
    "id": "dek_...",
    "name": "...",
    "season_id": null,
    "status": "research",
    "visibility": "private",
    "note": null,
    "is_primary": false,
    "created_at": 0,
    "updated_at": 0
  },
  "generals": []
}
```

Each snapshot general freezes:

- position;
- Registry general ID and name;
- ownership state at capture time (`owned`);
- owned breakthrough/promotion values when available, otherwise null;
- weapon/mount instance identity, Registry template ID/name/type, and instance nickname/locked/favorite state when attached;
- ordered tactic slots;
- each tactic's Registry ID/name plus ownership and breakthrough state at capture time.

A planned unowned general/tactic remains valid in a snapshot with `owned: false` and null permanent-state values.

The snapshot is a historical value object. Later changes to:

- deck composition;
- deck name/status/note;
- general/tactic ownership;
- breakthrough/promotion;
- equipment nickname/locked/favorite state;
- Registry display names

do not rewrite existing `snapshot_json`.

### 6.3 Deleting source decks

Deleting a live deck cascades live slots/settings through the existing schema. Existing snapshots survive; their `source_deck_id` becomes NULL via the existing foreign-key behavior and their JSON payload remains intact.

No snapshot delete/mutation endpoint is introduced in v0.7. Immutable history is the release boundary.

## 7. Authorization and isolation

All live-deck routes first verify that the NAKWOL AUTH principal owns the referenced game account.

For a deck-specific route, the deck must simultaneously match:

- requested `deckId`;
- requested `accountId`;
- an account owned by the verified principal.

Cross-account/cross-user requests return not-found semantics rather than leaking existence.

Snapshot list/detail routes filter by `owner_user_id = principal.userId` regardless of stored visibility. Cross-user snapshot reads are not implemented in v0.7.

## 8. Error contract

Expected stable error codes include:

- `INVALID_JSON`
- `INVALID_DECK_NAME`
- `INVALID_DECK_STATUS`
- `INVALID_DECK_VISIBILITY`
- `INVALID_SEASON`
- `INVALID_NOTE`
- `INVALID_IS_PRIMARY`
- `EMPTY_DECK_PATCH`
- `GAME_ACCOUNT_NOT_FOUND`
- `DECK_NOT_FOUND`
- `INVALID_COMPOSITION`
- `INVALID_GENERAL_POSITION`
- `DUPLICATE_GENERAL_POSITION`
- `GENERAL_NOT_FOUND`
- `INVALID_TACTIC_SLOT`
- `DUPLICATE_TACTIC_SLOT`
- `TACTIC_NOT_FOUND`
- `EQUIPMENT_NOT_FOUND`
- `EQUIPMENT_TYPE_MISMATCH`
- `INVALID_SNAPSHOT_VISIBILITY`
- `SNAPSHOT_NOT_FOUND`

Validation errors are 400. Missing/inaccessible owned resources are 404. Missing scopes remain 403 through the existing DATA auth layer.

## 9. TDD verification plan

Implementation begins with contract tests that are expected to fail only because v0.7 routes/handlers do not exist.

Required regression coverage:

1. deck endpoints are authenticated and scope-protected;
2. create/list/get are account-owner isolated;
3. metadata PATCH validates fields and cannot cross accounts;
4. composition PUT supports unowned planned generals/tactics but only enabled generals and canonical equipable tactics;
5. composition equipment references must belong to the same account and match weapon/mount type;
6. invalid replacement leaves the previous composition unchanged;
7. delete removes the live deck while existing snapshot history survives;
8. snapshot freezes names, composition, equipment identity/state, and ownership/breakthrough/promotion state at capture time;
9. later live/ownership/equipment changes do not mutate snapshot output;
10. snapshot collection/detail are owner-isolated;
11. package/service/deployment contract moves to `0.7.0` while schema remains `2`;
12. all existing v0.6 tests remain green.

Final release gate remains the existing sequence:

- full tests;
- TypeScript typecheck;
- Worker dry-run bundle;
- PR diff review;
- merge to `main`;
- `ops/data-deploy.flag` production trigger;
- existing D1 verification;
- no new migrations expected;
- Registry UPSERT/count gate;
- production Worker deploy;
- health/schema smoke verifying DATA `0.7.0`, schema `2`;
- release record and new production golden marker.

## 10. Explicitly deferred

The following are out of v0.7 scope:

- `deck_settings` public API, including formation/warbook modeling;
- equipment stat/trait writes;
- public or alliance cross-user snapshot read/share endpoints;
- snapshot editing/deletion;
- combat legality/counter validation;
- inferred duplicate-general/tactic/equipment restrictions;
- season Registry population.

These remain separate future work so v0.7 can ship a stable, factual deck storage boundary without importing unsourced game rules.
