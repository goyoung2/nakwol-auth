# NAKWOL Connect v0.3 DATA Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NAKWOL Connect configure DATA scopes and install a browser DATA client automatically so a coding agent can integrate AUTH + DATA with one CLI command and verify it with one doctor command.

**Architecture:** The existing Connect CLI device token remains the only control-plane credential. DATA validates app-management permission by forwarding that token to AUTH's existing `/connect/cli/apps/:clientId` endpoint, then owns its own app scope rows. The existing `/connect/v1.js` embed gains a backward-compatible DATA client that injects the current app access token and client ID into DATA requests.

**Tech Stack:** Cloudflare Workers/D1, Hono, TypeScript, Node.js 22, npm package `nakwol-connect`, browser ES modules/runtime JS, GitHub Actions, npm Trusted Publishing.

**Spec:** `docs/superpowers/specs/2026-08-26-nakwol-connect-v0.3-data-automation-design.md`

## Global Constraints

- `nakwol-connect` becomes `0.3.0`.
- NAKWOL DATA service becomes `0.3.0`; DATA schema remains `2`.
- No new permanent secret, Cloudflare token, Discord secret or browser-visible CLI token.
- DATA never reads AUTH D1; AUTH never reads DATA D1.
- DATA scope management must prove AUTH app ownership/operator permission on every control request.
- Existing Connect v0.2 projects and config version 1 remain functional.
- Existing runtime AUTH behavior must not regress.
- `doctor --json` must be machine-readable and fail if local, AUTH or DATA desired state diverges.
- GitHub Actions runs should be batched; do not create micro-CI loops.

---

### Task 1: DATA CLI Control Plane

**Files:**
- Create: `services/data/src/connect-cli.ts`
- Modify: `services/data/src/index.ts`
- Modify: `services/data/src/store.ts`
- Modify: `services/data/src/domain.ts`
- Modify: `services/data/tests/http.test.ts`
- Create: `services/data/tests/connect-cli.test.ts`

**Interfaces:**
- Consumes: existing Connect CLI Bearer token, `AUTH_ORIGIN`, existing `data_applications` and `data_application_scopes` tables.
- Produces: `GET` and `PUT /connect/cli/apps/:clientId/scopes`.

- [ ] **Step 1: Write failing control-plane tests**

Tests must prove:

```text
missing token -> 401
AUTH 401/403 -> same status family and no DB mutation
AUTH-owned app + GET before registration -> registered=false, scopes=[]
PUT valid scopes -> exact canonical set stored
PUT same scopes twice -> identical result
PUT [] -> application preserved, scope rows cleared
invalid scope -> 400 and previous rows unchanged
```

- [ ] **Step 2: Run the new tests and confirm RED** because the control module/routes do not exist.
- [ ] **Step 3: Implement `verifyManagedAuthApp()`** that forwards the raw CLI Bearer token to `GET {AUTH_ORIGIN}/connect/cli/apps/:clientId` and accepts only `ok:true`, matching `client_id` responses.
- [ ] **Step 4: Implement exact scope replace** using the server-side `DATA_SCOPES` list and D1 batch operations; never touch user asset tables.
- [ ] **Step 5: Wire Hono routes** in DATA `src/index.ts`.
- [ ] **Step 6: Run DATA tests and typecheck; confirm GREEN**.

### Task 2: CLI DATA API and Config v2

**Files:**
- Create: `packages/connect-cli/src/data-api.mjs`
- Create: `packages/connect-cli/src/scopes.mjs`
- Modify: `packages/connect-cli/src/config.mjs`
- Modify: `packages/connect-cli/src/commands.mjs`
- Modify: `packages/connect-cli/test/*.test.mjs`

**Interfaces:**
- Produces: `ConnectDataApi.getScopes(clientId)`, `ConnectDataApi.setScopes(clientId, scopes)`, canonical DATA scope parser, config version 2.

- [ ] **Step 1: Write failing tests** for v1 config upgrade, canonical scope parsing, duplicate removal, invalid scope rejection and DATA API request shape.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement `ConnectDataApi`** using the CLI token against DATA control routes.
- [ ] **Step 4: Implement config v2** with `dataOrigin` and sorted `dataScopes`; continue reading version 1 as empty DATA state.
- [ ] **Step 5: Update `initProject()`** so AUTH app creation/reuse occurs first, DATA exact scopes second, local integration third. A DATA failure must occur before local file edits.
- [ ] **Step 6: Run CLI tests; confirm GREEN**.

### Task 3: Universal Embed DATA Runtime

**Files:**
- Modify: `src/assets/nakwol-connect-v1.js.txt`
- Modify: `packages/connect-cli/src/integration.mjs`
- Modify: Connect/embed tests under `tests/worker/` and `packages/connect-cli/test/`.

**Interfaces:**
- Consumes: existing `NakwolAuthClient.getAccessToken()`.
- Produces: `window.NAKWOL_CONNECT.data`, `window.NAKWOL_DATA`, embed attributes `data-data-origin` and `data-data-scopes`.

- [ ] **Step 1: Write failing integration tests** asserting HTML/Next blocks contain exact DATA origin/scope attributes and remain idempotent.
- [ ] **Step 2: Write failing runtime contract tests** for DATA request header injection, missing-token rejection and registry endpoint mapping.
- [ ] **Step 3: Verify RED**.
- [ ] **Step 4: Extend the embed** with `data.fetch`, `data.request`, `data.hasScope`, and `data.registry.{summary,generals,tactics,equipment,stats,formations,warbooks}`.
- [ ] **Step 5: Keep old auth-only pages valid** when no DATA attributes exist; use production DATA origin and an empty scope set by default.
- [ ] **Step 6: Run embed/CLI tests; confirm GREEN**.

### Task 4: `data` Commands, Sync, Status and Doctor

**Files:**
- Modify: `packages/connect-cli/bin/nakwol-connect.mjs`
- Modify: `packages/connect-cli/src/commands.mjs`
- Modify: `packages/connect-cli/src/integration.mjs`
- Modify: `packages/connect-cli/test/*.test.mjs`

**Interfaces:**
- Produces commands:

```text
init --scopes a,b
sync --scopes a,b
data status
data set a,b
data add a,b
data remove a,b
doctor --json
```

- [ ] **Step 1: Write failing command tests** for init ordering, data add/remove/set/status and online doctor comparisons.
- [ ] **Step 2: Verify RED**.
- [ ] **Step 3: Implement CLI parsing** for `--scopes` and `--data-origin` plus `data` subcommands.
- [ ] **Step 4: Implement exact desired-state sync** so central DATA, config and embed stay aligned.
- [ ] **Step 5: Extend doctor** with local DATA marker checks and online DATA registration/scope checks.
- [ ] **Step 6: Update status/remove return shapes without breaking existing fields**.
- [ ] **Step 7: Run full CLI tests; confirm GREEN**.

### Task 5: Version, Distribution, Documentation and Deployment Contracts

**Files:**
- Modify: `packages/connect-cli/package.json`
- Modify: `packages/connect-cli/README.md`
- Modify: `src/connect-cli-distribution.ts`
- Modify: `src/assets/nakwol-connect-v1.js.txt`
- Modify: `CONNECT_CLI.md`
- Modify: `CONNECT.md`
- Modify: `DATA.md`
- Modify: `services/data/package.json`
- Modify: `services/data/CHANGELOG.md`
- Modify: `.github/workflows/deploy-data.yml`
- Modify relevant root Worker tests and publish workflow tests.

**Interfaces:**
- Public package and Worker fallback report `0.3.0`.
- `/llms.txt` teaches `init --scopes ...` and `doctor --json`.

- [ ] **Step 1: Add failing version/distribution tests** requiring package, Worker fallback and CLI help to agree on `0.3.0`.
- [ ] **Step 2: Add failing docs/manifest tests** requiring DATA origin, available scope examples and agent instructions.
- [ ] **Step 3: Bump versions and update docs**.
- [ ] **Step 4: Update DATA deploy smoke** to expect service `0.3.0`, schema `2`; no new migration is created.
- [ ] **Step 5: Run root tests/typecheck/bundle and DATA tests/typecheck/bundle**.

### Task 6: Integration, Release and Production Verification

**Files:**
- PR from `feature/nakwol-connect-v0.3-data-auto` to `main`.
- Trigger files only after verified merge.

**Interfaces:**
- Production DATA control endpoint.
- Production AUTH/Connect embed and fallback CLI `0.3.0`.
- Public npm `nakwol-connect@0.3.0`.

- [ ] **Step 1: Open one PR** after local/static verification is complete.
- [ ] **Step 2: Confirm all required PR verification workflows are green**; do not merge on partial success.
- [ ] **Step 3: Squash merge**.
- [ ] **Step 4: Deploy DATA v0.3** and verify scope management endpoint behavior with a controlled app/token path where feasible.
- [ ] **Step 5: Verify AUTH/Connect production deploy** including `/connect/v1.js`, CLI manifest and `/llms.txt`.
- [ ] **Step 6: Publish `nakwol-connect@0.3.0` through npm Trusted Publishing**; require the token-based first-publish steps to remain skipped and OIDC publish to succeed.
- [ ] **Step 7: Execute the registry-installed npm CLI** and confirm v0.3 help output.
- [ ] **Step 8: Run a disposable-project smoke** demonstrating `init --scopes ...` desired-state creation where interactive device approval is available; otherwise verify the exact server/CLI contracts and record the one manual browser approval boundary explicitly.
- [ ] **Step 9: Update changelog/plan completion state without triggering unnecessary deploy workflows**.
