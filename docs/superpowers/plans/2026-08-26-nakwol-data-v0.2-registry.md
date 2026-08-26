# NAKWOL DATA v0.2 Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the confirmed catalogs from `nslg-s-season-raw-research-kit-v1` into NAKWOL DATA as reproducible registry seeds and expose the confirmed registry through DATA APIs without inventing missing game rules.

**Architecture:** Keep the source research ZIP outside runtime. Convert only confirmed catalog fields into repository-owned normalized seed JSON. Apply an idempotent registry seed command against D1. Preserve all source provenance and visibility flags so playable filtering can evolve without deleting source rows. User roster/equipment/deck mutations remain out of scope for this release.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Hono, TypeScript, Node.js scripts/tests, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-26-nakwol-data-v0.1-design.md` plus the approved v0.2 Registry increment in chat.

## Global Constraints

- DATA service version becomes `0.2.0`; schema version remains `1` because registry rows fit existing tables.
- Imported source domains: heroes, skills, equipment, horses, attributes, formations, warbooks.
- Do not create promotion item or equipment trait rows from missing evidence.
- Preserve native ID, source locator/hash, evidence level and source visibility/status in metadata.
- General IDs use `general:<native_id>` and tactic IDs use `tactic:<native_id>`; equipment templates use `weapon:<native_id>` / `mount:<native_id>`.
- `game_generals.enabled` means user-facing candidate. Initial rule: source `is_show == 1`; hidden rows stay in DB with `enabled=0`.
- All imported skills remain in Registry with `enabled=1`; do not claim every skill is user-ownable. Store source classification flags in metadata for later filtering.
- Registry seeding must be idempotent and must never delete user data.

---

### Task 1: Normalize Research Catalogs

**Files:**
- Create: `services/data/seeds/registry-v0.2.json`
- Create: `services/data/scripts/build-registry-seed.mjs`
- Create: `services/data/tests/registry-seed.test.ts`

**Interfaces:**
- Consumes: extracted research catalog JSON files supplied by the operator.
- Produces: deterministic normalized seed JSON with `generals`, `tactics`, `equipment`, `stat_types`, `formations`, `warbooks`, and provenance summary.

- [ ] Write a failing test asserting exact source counts and known joins such as 조조 `1000 -> 100001`.
- [ ] Verify RED because normalized seed does not exist.
- [ ] Implement deterministic normalization from research catalogs.
- [ ] Generate committed `registry-v0.2.json`.
- [ ] Verify counts, IDs, Korean names, provenance and hidden-general policy.

### Task 2: Idempotent D1 Registry Seeder

**Files:**
- Create: `services/data/scripts/seed-registry.mjs`
- Modify: `services/data/package.json`
- Create: `services/data/tests/registry-import.test.ts`

**Interfaces:**
- Consumes: `registry-v0.2.json`.
- Produces: UPSERT writes into existing `game_tactics`, `game_generals`, `game_equipment_templates`, and `game_stat_types`; formation/warbook source rows remain preserved inside seed metadata for later schema expansion.

- [ ] Write a failing real-SQLite test for two consecutive imports producing identical counts.
- [ ] Verify RED because the seeder is absent.
- [ ] Implement UPSERT-based seed application without DELETE/TRUNCATE.
- [ ] Verify tactic rows are written before generals to satisfy FK relationships.
- [ ] Add `registry:seed:local` and `registry:seed:remote` scripts.
- [ ] Verify GREEN on empty and pre-seeded databases.

### Task 3: Registry API v0.2

**Files:**
- Modify: `services/data/src/domain.ts`
- Modify: `services/data/src/store.ts`
- Modify: `services/data/src/routes/registry.ts`
- Modify: `services/data/src/index.ts`
- Modify: `services/data/tests/http.test.ts`

**Interfaces:**
- Produces authenticated list endpoints for generals, tactics, equipment and registry summary.

- [ ] Write failing tests for `include_hidden=1`, native IDs, unique tactic metadata, weapon/mount type and registry summary.
- [ ] Verify RED.
- [ ] Add `/v1/registry/summary`, `/generals`, `/tactics`, `/equipment`; default generals exclude hidden rows, `include_hidden=1` returns preserved hidden rows under the same read scope.
- [ ] Return provenance/metadata without exposing raw source file contents.
- [ ] Verify GREEN.

### Task 4: Deployment/Documentation

**Files:**
- Modify: `.github/workflows/deploy-data.yml`
- Modify: `.github/workflows/bootstrap-data.yml`
- Modify: `services/data/package.json`
- Modify: `services/data/CHANGELOG.md`
- Modify: `DATA.md`

**Interfaces:**
- Deployment runs migrations, then idempotent remote Registry seed, then Worker deploy/smoke.

- [ ] Write deployment contract assertions that remote deploy contains `registry:seed:remote` after migrations and before Worker verification.
- [ ] Update service version to `0.2.0` while schema remains `1`.
- [ ] Document imported vs unresolved domains and exact row counts.
- [ ] Run full DATA test/typecheck/bundle verification.
- [ ] Open one PR and use one DATA Verify workflow before merge.
