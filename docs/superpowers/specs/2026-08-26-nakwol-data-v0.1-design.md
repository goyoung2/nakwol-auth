# NAKWOL DATA v0.1 Foundation Design

**Date:** 2026-08-26
**Status:** Approved for implementation
**Service version:** `0.1.0`

## Goal

Create the first independently deployable NAKWOL DATA service. It stores permanent game-account assets and deck structure under a NAKWOL ID while keeping authentication in NAKWOL AUTH.

## Runtime boundary

The repository remains shared for now, but runtime resources are separate:

- AUTH Worker: `nakwol-auth`
- AUTH D1: `nakwol-auth`
- DATA Worker: `nakwol-data`
- DATA D1: `nakwol-data`
- DATA source root: `src/data/`
- DATA migrations: `migrations-data/`
- DATA Wrangler config: `wrangler.data.jsonc`

The only cross-service identity key is the opaque NAKWOL `user_id` (`usr_...`). DATA never reads AUTH D1 directly.

## Authentication contract

DATA API callers send:

- `Authorization: Bearer <NAKWOL AUTH access token>`
- `X-NAKWOL-CLIENT-ID: <application client id>`
- browser callers also send their normal `Origin` header

DATA verifies the request by server-side calling:

`GET {AUTH_ORIGIN}/me?client_id=<client id>`

It forwards the bearer token and, when present, the original `Origin`. This means AUTH remains the source of truth for token validity, client binding, application access policy, membership and browser-origin validation.

After successful verification DATA upserts only a minimal local subject row (`user_id`, first_seen_at, last_seen_at). Discord identity/profile details remain owned by AUTH.

## DATA application scopes

Until OAuth access tokens carry scopes natively, DATA keeps a local application grant registry:

- `data_applications(client_id, status, created_at, updated_at)`
- `data_application_scopes(client_id, scope)`

Supported initial scopes:

- `profile:read`
- `profile:write`
- `roster:read`
- `roster:write`
- `equipment:read`
- `equipment:write`
- `decks:read`
- `decks:write`

AUTH proves which application owns the token; DATA decides which DATA capabilities that application may use. No scope is granted by default.

`GET /v1/me` requires only valid authentication so clients can diagnose identity. All game-data endpoints require explicit scopes.

## Permanent-data model

### Identity/account

- `data_users`
- `game_accounts`

A NAKWOL ID may own multiple game accounts. `game_accounts` holds nickname, server code and primary-account flag.

### Game Registry

Registry rows are shared canonical definitions, not user-owned state:

- `game_generals`
- `game_tactics`
- `game_equipment_templates`
- `game_stat_types`
- `game_equipment_traits`
- `game_promotion_items`
- `game_seasons`

Unknown game-specific properties live in `metadata_json` during v0.1 rather than blocking schema creation.

### User permanent assets

- `user_generals`: owned, breakthrough 0..5, promotion >= 0, favorite, note
- `user_tactics`: owned, breakthrough 0..5, favorite, note
- `user_promotion_items`: quantity >= 0
- `user_equipment`: one owned weapon/mount instance
- `user_equipment_stats`: exactly addressed stat slots 1..2
- `user_equipment_traits`: trait slots 1..2

Promotion effects (attack/defense percent and unique-tactic enhancement) are not duplicated as derived columns. The user row stores the promotion level; game rules calculate derived effects later.

### Decks

- `decks`
- `deck_general_slots`: positions 1..3
- `deck_tactic_slots`: per-general slots 1..2
- `deck_settings`: extensible JSON for formation/troop/book/specialization until exact rules are locked
- `deck_snapshots`: immutable JSON snapshots for sharing/comparison

Deck visibility: `private | alliance | public`.
Deck status: `active | candidate | research | archived`.

## Foundation API

Public:

- `GET /api/health`
- `GET /api/schema`

Authenticated diagnostic:

- `GET /v1/me`

Profile/account foundation:

- `GET /v1/game-accounts` (`profile:read`)
- `POST /v1/game-accounts` (`profile:write`)

Registry read foundation:

- `GET /v1/registry/generals` (`roster:read`)
- `GET /v1/registry/tactics` (`roster:read`)
- `GET /v1/registry/equipment` (`equipment:read`)

The remaining roster/equipment/deck CRUD is intentionally deferred to the next DATA increment; the tables and route boundaries are created now so no database redesign is required.

## IDs

IDs are opaque strings with stable prefixes:

- game account: `gac_...`
- equipment instance: `eqp_...`
- deck: `dek_...`
- snapshot: `dks_...`

Registry IDs are stable imported identifiers chosen by the registry importer, not generated per user.

## Deployment safety

DATA deployment is not coupled to AUTH deployment.

- No DATA files are added to AUTH's current deploy path filters.
- `bootstrap-data.yml` is explicitly triggered by `ops/data-bootstrap.flag` and may create the exact D1 `nakwol-data` only when it does not exist.
- Normal `deploy-data.yml` is explicitly triggered by `ops/data-deploy.flag`, requires the exact existing D1 and never creates/replaces it.
- Both workflows patch only a temporary runner copy of `wrangler.data.jsonc` with the resolved D1 UUID.

## Foundation success criteria

1. Migration creates every v0.1 foundation table and constraints.
2. DATA Worker bundles independently from AUTH.
3. `/api/health` identifies `nakwol-data` version `0.1.0`.
4. `/api/schema` exposes schema version `1` and supported scopes.
5. `/v1/me` accepts a valid AUTH token/client pair and rejects invalid authentication.
6. Browser origin validation remains delegated to AUTH.
7. DATA app grants deny game-data access by default.
8. Game-account creation is owner-bound and requires `profile:write`.
9. Registry list routes require the corresponding read scope.
10. No existing AUTH/Connect behavior or D1 schema is modified.
