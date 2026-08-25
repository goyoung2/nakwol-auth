# NAKWOL DATA v0.1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the independently deployable `nakwol-data` Worker/D1 foundation with permanent-data schema, AUTH-backed identity verification, DATA app scopes, game-account CRUD foundation and registry read routes.

**Architecture:** Keep AUTH and DATA in one repository for coordinated versioning, but place DATA source, D1 migrations, Wrangler configuration and deployment workflows in separate paths. DATA validates opaque AUTH access tokens through AUTH `/me`; it never queries AUTH D1. DATA authorization is an explicit local app-scope registry keyed by the AUTH-verified `client_id`.

**Tech Stack:** Cloudflare Workers, D1/SQLite, Hono, TypeScript, Node `node:test` via `tsx`, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-26-nakwol-data-v0.1-design.md`

## Global Constraints

- DATA service version is `0.1.0`; schema version is `1`.
- Worker name and D1 name are exactly `nakwol-data`.
- DATA never reads or writes AUTH D1.
- All browser origin validation is delegated to AUTH `/me` by forwarding `Origin`.
- No DATA application receives game-data scopes by default.
- User general/tactic breakthrough is `0..5`; promotion is `>=0`.
- Equipment stat/trait slots are `1..2`; deck general positions `1..3`; deck tactic slots `1..2`.
- Existing AUTH migrations, Worker entry point and production resources remain unchanged.
- Deployment workflows must never silently recreate an absent DATA D1 after bootstrap.

---

### Task 1: DATA schema and domain constraints

**Files:**
- Create: `migrations-data/0001_initial.sql`
- Create: `src/data/domain.ts`
- Create: `src/data/types.ts`
- Create: `tests/data/schema.test.ts`
- Create: `tests/data/domain.test.ts`

**Interfaces:**
- Produces `DATA_SERVICE_VERSION`, `DATA_SCHEMA_VERSION`, `DATA_SCOPES`, `isDataScope()`, `normalizeGameAccountInput()`, `newDataId(prefix)`.
- Migration produces the complete Foundation schema described by the spec.

- [ ] **Step 1: Write failing schema/domain tests** that require every Foundation table, enum/check constraint, version constant and scope set.
- [ ] **Step 2: Run DATA tests and verify RED** because `src/data/domain.ts` and the migration do not exist.
- [ ] **Step 3: Implement the migration and domain constants/helpers** with no game-rule fields beyond the approved Foundation.
- [ ] **Step 4: Run DATA tests and verify GREEN.**

### Task 2: AUTH-backed principal verification and DATA grants

**Files:**
- Create: `src/data/auth.ts`
- Create: `src/data/store.ts`
- Create: `tests/data/auth.test.ts`
- Create: `tests/data/scopes.test.ts`

**Interfaces:**
- `verifyPrincipal(request, env, fetcher?) -> Promise<DataPrincipal>`
- `DataPrincipal = { userId, clientId, displayName, avatarUrl, membershipRole }`
- `upsertDataUser(env, principal)`
- `hasDataScope(env, clientId, scope)`

- [ ] **Step 1: Write failing tests** for missing bearer/client ID, AUTH `/me` forwarding, `Origin` forwarding, malformed AUTH response, local subject upsert and deny-by-default scopes.
- [ ] **Step 2: Run DATA tests and verify RED.**
- [ ] **Step 3: Implement minimal AUTH verification/store behavior.**
- [ ] **Step 4: Run DATA tests and verify GREEN.**

### Task 3: DATA Worker HTTP skeleton

**Files:**
- Create: `src/data/index.ts`
- Create: `src/data/http.ts`
- Create: `src/data/routes/accounts.ts`
- Create: `src/data/routes/registry.ts`
- Create: `tests/data/http.test.ts`

**Interfaces:**
- Public `GET /api/health`, `GET /api/schema`
- Authenticated `GET /v1/me`
- `GET /v1/game-accounts`, `POST /v1/game-accounts`
- Registry list endpoints for generals/tactics/equipment

- [ ] **Step 1: Write failing route tests** against the Hono app using fake bindings/fetcher, asserting status codes, version payloads, auth failure, scope failure and account ownership.
- [ ] **Step 2: Run route tests and verify RED.**
- [ ] **Step 3: Implement the minimal route/middleware/store calls.**
- [ ] **Step 4: Run DATA tests and verify GREEN.**

### Task 4: Independent Wrangler and safe D1 resolution

**Files:**
- Create: `wrangler.data.jsonc`
- Create: `scripts/ensure-data-d1.mjs`
- Create: `.github/workflows/bootstrap-data.yml`
- Create: `.github/workflows/deploy-data.yml`
- Create: `tests/data/deployment.test.ts`
- Modify: `package.json`

**Interfaces:**
- npm scripts: `test:data`, `typecheck:data`, `data:bundle`, `data:migrate:local`
- `ensure-data-d1.mjs` resolves exact D1 name and patches only runner-local `wrangler.data.jsonc`; create mode is explicit `--create-if-missing`.
- Bootstrap workflow may create; normal deploy workflow may not.

- [ ] **Step 1: Write failing deployment-contract tests** for exact names, bindings, migration dir, workflow triggers and create-vs-require behavior.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement config/scripts/workflows and root npm scripts.**
- [ ] **Step 4: Run DATA tests, DATA typecheck and Wrangler dry-run; verify GREEN.**

### Task 5: Documentation and integrated verification

**Files:**
- Create: `DATA.md`
- Modify: `README.md`

**Interfaces:**
- Documents service boundary, API headers, scope model, D1 tables, local commands and deployment lifecycle.

- [ ] **Step 1: Update docs with exact current Foundation behavior and non-goals.**
- [ ] **Step 2: Run `npm run test:data`.** Expected: all DATA tests pass.
- [ ] **Step 3: Run root `npm test`.** Expected: existing AUTH/Connect tests remain green.
- [ ] **Step 4: Run `npm run typecheck` and `npm run data:bundle`.** Expected: both Workers typecheck/bundle without sharing runtime bindings.
- [ ] **Step 5: Open one PR from `feature/nakwol-data-v0.1-foundation` to `main`; use one PR verification run rather than per-file CI.**

## Self-review

- Spec coverage: schema, runtime boundary, auth verification, local app scopes, initial API, deployment safety and versioning are covered.
- Deferred by design: user roster/equipment/deck mutation APIs, registry import data, exact game-rule validation, DATA scope selection UI in Connect.
- No placeholder production behavior: deferred APIs are not exposed as fake/501 routes; only implemented Foundation routes are documented.
- Version consistency: Worker constant `0.1.0`, schema `1`, migration `0001_initial.sql`, Wrangler D1 `nakwol-data`.
