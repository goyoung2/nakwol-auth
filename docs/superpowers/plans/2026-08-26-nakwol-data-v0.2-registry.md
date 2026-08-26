# NAKWOL DATA v0.2 Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the confirmed catalogs from `nslg-s-season-raw-research-kit-v1` into NAKWOL DATA as reproducible Registry seeds and expose the confirmed Registry through DATA APIs without inventing missing game rules.

**Architecture:** The source research ZIP stays outside runtime. Confirmed catalog fields are normalized, gzip-compressed, Base64-split into repository-owned seed parts, then applied to D1 with idempotent UPSERTs. Provenance and source visibility are retained so later game-knowledge corrections do not require destructive rewrites. User roster/equipment/deck mutation APIs remain outside this release.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Hono, TypeScript, Node.js scripts/tests, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-26-nakwol-data-v0.1-design.md` plus the approved v0.2 Registry increment in chat.

## Global Constraints

- DATA service version `0.2.0`; schema version `2`.
- Imported source domains: heroes, skills, equipment, horses, attributes, formations, warbooks.
- Do not create promotion-item or equipment-trait rows without source evidence.
- Preserve native ID and domain-level source hash/locator/evidence metadata.
- Stable Registry IDs: `g:<native_id>`, `t:<native_id>`, `w:<native_id>`, `m:<native_id>`, `s:<native_id>`, `f:<native_id>`, `b:<native_id>`.
- `game_generals.enabled=1` means source `is_show=1`; hidden rows stay preserved with `enabled=0`.
- All source skills remain Registry rows but use `ownership_status=unclassified`; v0.2 does not claim all 1,077 skills are user-ownable tactics.
- Hidden heroes whose source unique skill is absent from the supplied skill catalog keep the native skill ID in metadata and have `unique_tactic_id=NULL`.
- Registry seeding uses UPSERT only and never deletes user data.
- D1 import SQL contains no explicit `BEGIN`/`COMMIT` because `wrangler d1 execute --file` manages import transactions.

---

### Task 1: Normalize Research Catalogs

**Files:**
- Create: `services/data/seeds/registry-v0.2.parts/part-*.b64`
- Create: `services/data/scripts/registry-seed-file.mjs`
- Create: `services/data/scripts/build-registry-seed.mjs`
- Create: `services/data/tests/registry-seed-file.test.mjs`
- Create: `services/data/tests/registry-seed.test.mjs`

- [x] Write a failing test asserting source counts and known joins such as 조조 `1000 -> 100001`.
- [x] Verify RED because normalized seed does not exist.
- [x] Implement deterministic normalization from research catalogs.
- [x] Generate committed compressed/Base64-split seed parts.
- [x] Verify 209 generals / 140 visible / 1,077 skills / 97 weapons / 37 mounts / 281 attributes / 8 formations / 442 warbooks and provenance hashes.

### Task 2: Idempotent D1 Registry Seeder + Schema 2

**Files:**
- Create: `services/data/migrations/0002_registry_v02.sql`
- Create: `services/data/scripts/seed-registry.mjs`
- Modify: `services/data/package.json`
- Create: `services/data/tests/registry-import.test.mjs`

- [x] Write a failing real-SQLite test for two consecutive imports producing identical counts.
- [x] Verify RED because the seeder is absent.
- [x] Add `data_registry_meta`, `game_formations`, `game_warbooks` and schema version 2 migration.
- [x] Implement tactic-first UPSERT seeding without DELETE/TRUNCATE or explicit transaction statements.
- [x] Verify user `user_generals` rows survive a repeat Registry seed.
- [x] Add local/remote seed commands.

### Task 3: Registry API v0.2

**Files:**
- Modify: `services/data/src/domain.ts`
- Modify: `services/data/src/store.ts`
- Modify: `services/data/src/routes/registry.ts`
- Modify: `services/data/src/index.ts`
- Modify: `services/data/tests/http.test.ts`
- Create: `services/data/tests/registry-api.test.mjs`

- [x] Write failing tests for hidden generals, native IDs, unique tactic metadata and Registry summary.
- [x] Verify RED.
- [x] Add Registry summary and generals/tactics/equipment/stats/formations/warbooks storage/API contracts.
- [x] Default generals to 140 visible rows; `include_hidden=1` exposes preserved 209-row static Registry under `roster:read`.
- [x] Verify local SQLite API/storage contracts GREEN.

### Task 4: Deployment/Documentation

**Files:**
- Modify: `.github/workflows/deploy-data.yml`
- Modify: `.github/workflows/bootstrap-data.yml`
- Modify: `services/data/tests/deployment.test.ts`
- Modify: `services/data/CHANGELOG.md`
- Modify: `DATA.md`

- [x] Put remote Registry seeding after migrations and before Worker deploy.
- [x] Add production D1 count verification for all imported domains.
- [x] Update service version 0.2.0 / schema 2 and document unresolved domains.
- [ ] Run one DATA Verify PR workflow with npm/tsx/TypeScript/Wrangler.
- [ ] Squash merge after green.
- [ ] Run one normal DATA deploy and verify migration, seed counts and production health/schema.
