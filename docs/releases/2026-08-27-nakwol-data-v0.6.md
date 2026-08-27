# NAKWOL DATA v0.6.0 Release Record

Date: 2026-08-27
Service: `nakwol-data`
Schema: `2`
Release branch: `feature/nakwol-data-v0.6-equipment-instances`
Pull request: `#14`

## Context carried forward

This release continues the permanent-player-data sequence completed earlier on the same day:

- v0.4.0: owned generals API (`user_generals`)
- v0.5.0: owned tactics API (`user_tactics`) with canonical 146 tactic classification based on authoritative chip linkage
- v0.6.0: owned weapon/mount equipment instances (`user_equipment`)

The Registry remains seeded from `nslg-s-season-raw-research-kit-v1` with 209 generals (140 enabled), 1,077 tactics, 97 weapons, 37 mounts, 281 stat definitions, 8 formations and 442 warbooks.

## v0.6 scope

Endpoints:

- `GET /v1/game-accounts/:accountId/equipment`
- `POST /v1/game-accounts/:accountId/equipment`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId`

Authorization:

- read: `equipment:read`
- create/update/delete: `equipment:write`
- every operation is restricted to the game account owned by the verified NAKWOL AUTH principal

Stored instance state:

- Registry `template_id`
- DATA-generated `eqp_...` instance id
- optional nickname
- locked flag
- favorite flag
- created/updated timestamps

Constraints:

- only enabled weapon/mount Registry templates can create instances
- `template_id` is immutable after creation
- cross-account and cross-user instance access returns not found
- `stats` and `traits` writes are rejected with `EQUIPMENT_OPTIONS_UNSUPPORTED`

## Deliberately deferred domains

The database already contains `user_equipment_stats` and `user_equipment_traits`, but v0.6 does not expose writes to them. The authoritative source currently confirms the equipment template catalog and the global stat catalog, but not the complete equipment-specific allowed-stat/trait mapping or equipment trait Registry. NAKWOL DATA therefore does not infer that all 281 stat definitions are valid equipment options.

`locked` is stored as player/game state. The DATA layer does not invent an unsourced rule that a locked item cannot be deleted through the API.

## Verification history

TDD RED:

- existing DATA tests: 45 passed
- new equipment contract tests: 5 failed only because routes did not yet exist (404)

Implementation GREEN:

- total tests at first implementation gate: 50 passed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed

Release-contract RED:

- after the service/package/test expectations were moved to 0.6.0, CI correctly failed because bootstrap/deploy workflows still asserted 0.5.0
- workflows were then updated to assert 0.6.0

Final release-candidate verification:

- total tests: 52 passed, 0 failed
- TypeScript typecheck: passed
- Worker dry-run bundle: passed
- package/service/deployment contract: `0.6.0`
- schema contract: `2`

## Production verification

Pending final merge and deployment. After production deployment, record the deployed Worker version id, production health/schema result, Registry count verification and final golden-baseline commit here.

## Next planned DATA work

1. Deck edit/snapshot API
2. Equipment option/trait API only after authoritative Registry/mapping is available
3. Promotion-item Registry completion
