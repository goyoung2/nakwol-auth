# NAKWOL DATA v0.1 Foundation Design

**Date:** 2026-08-26  
**Status:** Approved for implementation  
**Service version:** `0.1.0`

## Goal
Create the first independently deployable NAKWOL DATA service. It stores permanent game-account assets and deck structure under a NAKWOL ID while keeping authentication in NAKWOL AUTH.

## Runtime/repository boundary
AUTH and DATA share one repository for coordinated platform versioning, but DATA is a complete independent package under `services/data/`.

- AUTH Worker/D1: `nakwol-auth`
- DATA Worker/D1: `nakwol-data`
- DATA package/source/migrations/config: `services/data/`

The only cross-service identity key is opaque `user_id` (`usr_...`). DATA never reads AUTH D1 directly.

## Authentication
Callers send `Authorization: Bearer <token>` and `X-NAKWOL-CLIENT-ID`. DATA calls AUTH `GET /me?client_id=...`, forwarding bearer and browser `Origin`. AUTH remains source of truth for token/client binding, app policy, membership and Origin validation. DATA mirrors only user id and first/last seen timestamps.

## DATA scopes
`profile:read/write`, `roster:read/write`, `equipment:read/write`, `decks:read/write`. Grants live in DATA and deny by default. `/v1/me` requires authentication but no DATA scope.

## Schema 1
Accounts: `data_users`, `game_accounts`.
Registry: `game_generals`, `game_tactics`, `game_equipment_templates`, `game_stat_types`, `game_equipment_traits`, `game_promotion_items`, `game_seasons`.
Assets: `user_generals` (breakthrough 0..5, promotion >=0), `user_tactics` (breakthrough 0..5), `user_promotion_items`, `user_equipment`, stat slots 1..2, trait slots 1..2.
Decks: `decks`, general positions 1..3, tactic slots 1..2, extensible settings JSON and immutable snapshots. Derived promotion effects are not duplicated.

## Foundation API
Public: `GET /api/health`, `GET /api/schema`.
Authenticated: `GET /v1/me`.
Accounts: `GET /v1/game-accounts` (`profile:read`), `POST /v1/game-accounts` (`profile:write`).
Registry: generals/tactics (`roster:read`), equipment (`equipment:read`).

Roster/equipment/deck mutation APIs are deferred to the next increment; their tables are created now.

## Deployment safety
`verify-data.yml` handles DATA PR verification. `bootstrap-data.yml` is explicit and may create exact D1 `nakwol-data`; `deploy-data.yml` requires the existing exact D1 and never creates it. D1 UUID is runner-local only.

## Success criteria
Migration executes; DATA bundles independently; health/schema report `0.1.0`/`1`; AUTH-backed `/v1/me` works; Origin validation is delegated; scope default is deny; account creation is owner-bound; Registry scope checks work; existing AUTH runtime/schema are untouched.
