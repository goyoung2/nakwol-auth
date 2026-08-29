# NAKWOL Connect v0.4 API Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-describing OpenAPI contract to NAKWOL DATA and make NAKWOL Connect/LLMs automatically discover and verify the current DATA API.

**Architecture:** DATA owns an unauthenticated OpenAPI 3.1 document generated from a focused module. Tests compare the app-facing routes registered in `services/data/src/index.ts` with OpenAPI operations to prevent drift. Connect consumes that public document through runtime and CLI discovery helpers; no auth/storage boundary changes.

**Tech Stack:** Cloudflare Workers, Hono, TypeScript, Node.js CLI, OpenAPI 3.1, node:test/tsx, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-29-nakwol-connect-v0.4-api-discovery-design.md`

## Global Constraints

- DATA service `0.9.0`; DATA schema remains `3` and no migration is created.
- `nakwol-connect` `0.4.0`; config remains version `2`.
- Existing scopes and authorization behavior are unchanged.
- OpenAPI is public and contains only app-facing endpoints; `/connect/cli/` routes stay outside it.
- Every protected OpenAPI operation declares exact `x-nakwol-scope`.
- Existing v0.3 commands/runtime APIs remain backward compatible.
- No new permanent secret.

---

### Task 1: DATA OpenAPI contract and coverage gate

**Files:**
- Create: `services/data/src/openapi.ts`
- Create: `services/data/tests/openapi.test.ts`
- Modify: `services/data/src/index.ts`
- Modify: `services/data/src/http.ts`
- Modify: `services/data/src/domain.ts`

**Interfaces:**
- Produces `buildDataOpenApi(origin?: string)` and `openApiResponse(request: Request)`.
- Adds public `GET /openapi.json`.
- Adds `openapi_path` and `openapi_version` to `/api/schema`.

- [ ] Write tests that require OpenAPI `3.1.0`, service version `0.9.0`, both security headers, representative request schemas and exact `x-nakwol-scope` values.
- [ ] Add a coverage test that extracts app-facing `app.get/post/put/patch/delete` route pairs from `src/index.ts`, excludes `/connect/cli/`, and requires an exact matching OpenAPI method/path operation.
- [ ] Verify RED because `openapi.ts` and `/openapi.json` do not exist.
- [ ] Implement `openapi.ts` with all current app-facing routes and reusable request/error/envelope schemas.
- [ ] Register `/openapi.json` before protected routes and return CORS/cache headers suitable for agent discovery.
- [ ] Bump DATA service to `0.9.0`, keep schema `3`, and add schema discovery hints.
- [ ] Verify OpenAPI and existing DATA tests GREEN.

### Task 2: Connect DATA discovery client and CLI command

**Files:**
- Modify: `packages/connect-cli/src/data-api.mjs`
- Modify: `packages/connect-cli/src/commands.mjs`
- Modify: `packages/connect-cli/bin/nakwol-connect.mjs`
- Create: `packages/connect-cli/test/api-discovery-v04.test.mjs`

**Interfaces:**
- `ConnectDataApi.describe()` -> parsed `/openapi.json` payload.
- `dataDescribeProject(options)` -> `{ok,dataOrigin,openapiUrl,document}` without requiring a CLI session.
- CLI command: `nakwol-connect data describe [--json]`.

- [ ] Write a failing client test that expects `GET /openapi.json` without Authorization and parses a valid document.
- [ ] Write a failing command test proving `data describe` works from project config or default origin without calling device/session authorization.
- [ ] Implement `ConnectDataApi.describe({ publicOnly:true })` using a request path that does not attach the stored CLI token.
- [ ] Implement `dataDescribeProject` and export it from `commands.mjs`.
- [ ] Add `data describe` parsing/help output while preserving status/set/add/remove behavior.
- [ ] Verify CLI discovery tests GREEN.

### Task 3: Runtime discovery and doctor verification

**Files:**
- Modify: `src/assets/nakwol-connect-v1.js.txt`
- Modify: `packages/connect-cli/src/commands.mjs`
- Modify: `tests/worker/connect-data-runtime.test.ts`
- Modify: `packages/connect-cli/test/orchestration-v03.test.mjs` or add a focused v0.4 doctor test.

**Interfaces:**
- Browser: `NAKWOL_CONNECT.data.openapi()` and `.describe()`.
- Doctor check: `data_openapi` validates OpenAPI 3.1 and configured scope discoverability.

- [ ] Write runtime contract tests requiring public OpenAPI helper methods and no-login availability.
- [ ] Write doctor test where invalid/missing OpenAPI makes doctor fail without mutation.
- [ ] Add `openapi/describe` methods to runtime DATA helper using direct public fetch.
- [ ] Extend doctor after DATA scope central-state verification to fetch OpenAPI and verify configured scopes are declared.
- [ ] Verify runtime and doctor tests GREEN.

### Task 4: Agent guidance, version/distribution contract and docs

**Files:**
- Modify: `packages/connect-cli/package.json`
- Modify: `packages/connect-cli/README.md`
- Modify: `src/connect-cli-distribution.ts`
- Modify: `CONNECT_CLI.md`
- Modify: `DATA.md`
- Modify: `services/data/CHANGELOG.md`
- Modify/add focused worker distribution tests.

**Interfaces:**
- CLI/package/distribution version `0.4.0`.
- Manifest exposes `data_openapi` and `npm_describe_command`.
- `/llms.txt` teaches `init -> data describe -> implement -> doctor`.

- [ ] Add failing release-contract tests for package/distribution `0.4.0` and DATA `0.9.0/schema 3`.
- [ ] Bump `nakwol-connect` package and Worker distribution constants to `0.4.0`.
- [ ] Add CLI manifest fields `data_openapi` and `npm_describe_command`.
- [ ] Update `/llms.txt` so agents must consume OpenAPI and never invent endpoint paths or manually build DATA auth headers.
- [ ] Update package/DATA/CLI docs and changelogs.
- [ ] Verify full local/static contracts before opening PR.

### Task 5: Integrated verification and production release

**Files:**
- No feature code unless verification reveals a specific defect.
- Update release record after production evidence is green.

- [ ] Open one PR containing both DATA 0.9 and Connect 0.4 changes.
- [ ] Run only the existing AUTH/CLI and DATA PR verification workflows; require tests, typecheck and Wrangler bundles green.
- [ ] Squash merge after green.
- [ ] Deploy DATA first; require `/api/health`, `/api/schema`, `/openapi.json` smoke and route-count contract.
- [ ] Deploy AUTH/Connect next; require CLI manifest, `/llms.txt`, `/connect/v1.js` discovery contract.
- [ ] Publish `nakwol-connect@0.4.0` through existing npm Trusted Publishing/OIDC workflow.
- [ ] Verify registry-installed `npx --yes nakwol-connect data describe --json` reaches production OpenAPI and `doctor --json` remains compatible.
- [ ] Record exact workflow/run evidence in `docs/releases/2026-08-29-nakwol-connect-v0.4.md`.
