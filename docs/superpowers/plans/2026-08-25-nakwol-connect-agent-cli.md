# NAKWOL Connect v0.2 Agent CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted NAKWOL Connect CLI that coding LLMs can run to authenticate by browser device flow, register/manage owned applications through the central Worker, patch supported projects, and verify the integration.

**Architecture:** Extend the existing `nakwol-auth` Worker as the Connect control plane. Add hashed device/CLI-token state in D1, ownership-aware CLI APIs, a browser approval page, a Node CLI package, and a Worker-served npm tarball generated during CI/deploy.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite, TypeScript 5.7, Node.js 22 ESM, Node built-in test runner for CLI tests, Vitest for Worker pure-function tests only if needed, npm pack-compatible tarball distribution.

**Spec:** `docs/superpowers/specs/2026-08-25-nakwol-connect-agent-cli-design.md`

## Global Constraints

- Existing SDK v0.1.0 and `/connect/v1.js` behavior must remain compatible.
- Existing `siege-calculator` remains `public`.
- Raw CLI tokens and device codes must never be stored in D1.
- Project `.nakwol-connect.json` must contain no secret.
- Production URLs are never guessed.
- Device approval requires owner/operator/developer or Discord admin.
- CLI bearer token lifetime is 30 days; device request lifetime is 10 minutes.
- v0.2 must run without npm registry publication.

---

### Task 1: Add test harness, permission helpers, and v0.2 schema

**Files:**
- Create: `src/connect-permissions.ts`
- Create: `src/connect-permissions.test.ts`
- Create: `migrations/0004_connect_agent_cli.sql`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`

**Interfaces:**
- Produces `ConnectRole = 'owner' | 'operator' | 'developer' | null`.
- Produces `canUseCli(role, discordRole): boolean`.
- Produces `canManageApplication(role, discordRole, userId, ownerUserId): boolean`.
- Migration produces `connect_device_requests` and `connect_cli_tokens`.

- [ ] **Step 1: Write failing permission tests** covering developer CLI eligibility, developer-own-app access, operator global access, unrelated developer rejection, and Discord admin global access.
- [ ] **Step 2: Run `npm test -- src/connect-permissions.test.ts` and confirm RED** because the module/functions do not exist.
- [ ] **Step 3: Implement minimal pure permission helpers** with no D1 access.
- [ ] **Step 4: Run the focused test and full `npm test`; confirm GREEN.**
- [ ] **Step 5: Add migration** with hashed-code/token tables and update `nakwol-connect-admin` redirect URIs to include `/connect/device`.
- [ ] **Step 6: Update PR CI** to run unit tests before typecheck/dry-run.

### Task 2: Implement device authorization state and HTTP flow

**Files:**
- Create: `src/connect-device.ts`
- Create: `src/connect-device.test.ts`
- Create: `src/assets/nakwol-connect-device.js.txt`
- Modify: `src/connect.ts`
- Modify: `src/sdk-entry.ts` only if route registration boundaries require it.

**Interfaces:**
- Produces `createDeviceCode()`, `createUserCode()`, `deviceStatusForRow(row, now)` pure helpers.
- Routes:
  - `POST /connect/api/device/start`
  - `POST /connect/api/device/poll`
  - `POST /connect/api/device/approve`
  - `POST /connect/api/device/deny`
  - `GET /connect/device`
  - `GET /connect/device/app.js`

- [ ] **Step 1: Write failing tests** for user-code format, expiry state, pending/approved/consumed transitions, and one-time consumability decision.
- [ ] **Step 2: Run focused test and verify RED.**
- [ ] **Step 3: Implement pure helpers.**
- [ ] **Step 4: Run focused/full tests and verify GREEN.**
- [ ] **Step 5: Implement D1-backed device routes** using SHA-256 hashes from existing crypto helpers; device-start returns only raw device code to CLI while D1 stores its hash.
- [ ] **Step 6: Implement browser approval page/client** using `nakwol-connect-admin` Web SDK and current user-role checks.
- [ ] **Step 7: Typecheck + Wrangler dry-run.**

### Task 3: Implement CLI bearer auth and ownership-aware control API

**Files:**
- Create: `src/connect-cli-api.ts`
- Create: `src/connect-cli-api.test.ts`
- Modify: `src/connect.ts`

**Interfaces:**
- Produces `normalizeClientId(input): string`.
- Produces ownership decision through Task 1 helpers.
- Routes:
  - `GET /connect/api/cli/me`
  - `POST /connect/api/cli/apps`
  - `GET /connect/api/cli/apps/:clientId`
  - `PATCH /connect/api/cli/apps/:clientId`
  - `POST /connect/api/cli/apps/:clientId/urls`
  - `POST /connect/api/cli/apps/:clientId/disable`

- [ ] **Step 1: Write failing tests** for client-ID normalization, invalid redirect URI rejection helper, collision suffix behavior with deterministic injected suffix, and ownership authorization.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement pure validation/normalization helpers.**
- [ ] **Step 4: Verify GREEN.**
- [ ] **Step 5: Implement token lookup/update and CLI API routes.** Tokens are hashed in D1 and `last_used_at` is updated.
- [ ] **Step 6: Add auth-event logging for device approval, CLI login, app create/update/url/disable.**
- [ ] **Step 7: Typecheck + Wrangler dry-run.**

### Task 4: Build the Node CLI with TDD project detection and patching

**Files:**
- Create: `packages/connect-cli/package.json`
- Create: `packages/connect-cli/bin/nakwol-connect.mjs`
- Create: `packages/connect-cli/lib/project.mjs`
- Create: `packages/connect-cli/lib/patch.mjs`
- Create: `packages/connect-cli/lib/config.mjs`
- Create: `packages/connect-cli/lib/api.mjs`
- Create: `packages/connect-cli/test/project.test.mjs`
- Create: `packages/connect-cli/test/patch.test.mjs`
- Create: `packages/connect-cli/test/config.test.mjs`

**Interfaces:**
- Bin name: `nakwol-connect`.
- CLI origin default: `https://nakwol-auth.sepsd21.workers.dev` and override `NAKWOL_CONNECT_ORIGIN` for tests/dev.
- Project config file: `.nakwol-connect.json`.

- [ ] **Step 1: Write RED framework-detection tests** for Next, SvelteKit, React/Vite, Vue/Vite, CRA, generic Vite, HTML, other.
- [ ] **Step 2: Implement minimal detection; verify GREEN.**
- [ ] **Step 3: Write RED patch tests** for HTML target insertion/idempotency and safe/unsafe Next.js handling.
- [ ] **Step 4: Implement patchers; verify GREEN.**
- [ ] **Step 5: Write RED config tests** ensuring project config contains no session token and preserves exact redirect URIs.
- [ ] **Step 6: Implement config/session storage; verify GREEN.**
- [ ] **Step 7: Implement API client + device-login polling** with browser opening best effort and verification URL always printed.
- [ ] **Step 8: Implement commands** `init`, `login`, `status`, `doctor`, `add-url`, `sync`, `remove`; support `--json`.
- [ ] **Step 9: Run `node --test packages/connect-cli/test/*.test.mjs` and CLI help/version smoke.**

### Task 5: Self-host npm-compatible CLI tarball and agent contract

**Files:**
- Create: `scripts/build-connect-cli.mjs`
- Generated at build time: `src/assets/nakwol-connect-cli.tgz.b64.txt`
- Modify: `src/connect.ts`
- Modify: `src/text-modules.d.ts` only if necessary
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- `GET /connect/cli/v0.2.0/nakwol-connect.tgz`
- `GET /connect/cli/manifest.json`
- `GET /connect/agent/:clientId`

- [ ] **Step 1: Write build-script test/smoke** that runs `npm pack --pack-destination <tmp>` and verifies one `.tgz` plus package `bin` metadata.
- [ ] **Step 2: Implement build script** that packs CLI, base64-encodes tarball into generated Worker text asset, and leaves source package unchanged.
- [ ] **Step 3: Add Worker tarball/manifest routes** with correct content type/cache headers and base64 decoding.
- [ ] **Step 4: Add agent contract endpoint** with no secrets and exact CLI URL/version.
- [ ] **Step 5: Update verify/deploy workflows to run CLI build before Wrangler bundle/deploy.**
- [ ] **Step 6: CI smoke `npx --yes file:<built-tarball> --version` or equivalent npm exec against the local tarball.**

### Task 6: Extend admin UI for developers and LLM-first instructions

**Files:**
- Modify: `src/connect.ts`
- Modify: `src/assets/nakwol-connect-admin.js.txt`

**Interfaces:**
- Admin API adds user-role search/list/grant/revoke operations.
- App detail exposes canonical LLM prompt and CLI command.

- [ ] **Step 1: Add route-level permission tests/pure helper tests where behavior is new.**
- [ ] **Step 2: Add `GET /connect/api/admin/developers?q=` and role mutation endpoints** guarded by owner/operator/admin.
- [ ] **Step 3: Add developer-management UI** with search, current Connect role, grant/revoke developer.
- [ ] **Step 4: Add `LLM에게 맡기기` panel/button** for new/existing apps using the production CLI command and agent contract.
- [ ] **Step 5: Typecheck, tests, Wrangler dry-run.**

### Task 7: Docs, PR verification, merge, and production smoke

**Files:**
- Create: `CLI.md`
- Modify: `CONNECT.md`
- Modify: `README.md`
- Create or modify: `.github/workflows/smoke-connect-v02.yml` as a temporary or reusable production-smoke workflow.

**Interfaces:**
- Canonical LLM command documented exactly.
- Production smoke is read-only except device-start creation, which expires naturally and does not create a CLI token.

- [ ] **Step 1: Document operator developer-grant flow, CLI commands, device approval, local config/session locations, and LLM prompt.**
- [ ] **Step 2: Run full PR verification:** `npm test`, CLI node tests, `npm run typecheck`, CLI pack build, Wrangler dry-run, local tarball npx smoke.
- [ ] **Step 3: Open PR and confirm GitHub Verify workflow success.**
- [ ] **Step 4: Merge only after verification success; unattended main deploy applies `0004` and deploys Worker.**
- [ ] **Step 5: Run production smoke** verifying new D1 tables, device-start response shape, tarball HTTP/gzip, production npx `--version`, agent contract, existing routes and siege registration.
- [ ] **Step 6: Close temporary smoke PR/workflow artifacts if used.**

## Plan self-review

- Spec coverage: every spec area maps to Tasks 1–7; npm registry publication and multi-owner collaboration are intentionally excluded.
- Placeholder scan: no TBD/TODO/“implement later” steps.
- Type consistency: roles are exactly owner/operator/developer; application ownership continues through `application_settings.owner_user_id`; CLI config is `.nakwol-connect.json`; v0.2 CLI URL is fixed to `/connect/cli/v0.2.0/nakwol-connect.tgz`.
