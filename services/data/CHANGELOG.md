# Changelog

## 0.4.0 - 2026-08-27

- Add authenticated owned-general list/upsert/delete APIs on existing `user_generals` schema.
- Enforce `roster:read` for reads and `roster:write` for mutations.
- Isolate roster access to game accounts owned by the verified AUTH principal.
- Accept only enabled Registry generals for new owned-general records.
- Validate breakthrough as 0..5 and promotion as a non-negative integer.
- Keep DATA schema at version 2; no migration is required.

## 0.3.0 - 2026-08-27

- Add Connect CLI control endpoints for exact DATA scope get/replace.
- Reuse existing Connect CLI device token and AUTH app ownership/operator checks; no new permanent secret.
- Keep DATA schema at version 2.
- Support automated `nakwol-connect init --scopes ...` and online doctor reconciliation.
- Expose browser DATA client through the existing Connect v1 embed.

## 0.2.0 - 2026-08-26

- Import the authoritative S-season research-kit Registry as a reproducible compressed seed.
- Seed 209 generals (140 user-facing), 1,077 tactics, 97 weapons, 37 mounts, 281 stat definitions, 8 formations and 442 warbooks.
- Preserve hidden generals and unresolved unique-tactic native IDs instead of inventing missing links.
- Add schema version 2 with `data_registry_meta`, `game_formations` and `game_warbooks`.
- Add idempotent Registry UPSERT seeding that preserves user-owned roster data.
- Add Registry summary, stats, formations and warbooks endpoints plus optional hidden-general listing.
- Keep promotion items and the complete equipment-trait catalog empty until authoritative source data is supplied.

## 0.1.0 - 2026-08-26

- Create independent `nakwol-data` Worker/D1 foundation.
- Add schema version 1 for game accounts, Registry, permanent roster assets, equipment instances and decks.
- Add AUTH `/me` principal verification and deny-by-default DATA application scopes.
- Add game-account create/list and Registry list foundation routes.
- Add separate bootstrap, deploy and PR verification workflows.
