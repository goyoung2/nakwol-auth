# Changelog

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
