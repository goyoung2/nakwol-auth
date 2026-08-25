# NAKWOL Connect v0.2 Agent-first CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a coding-agent-friendly NAKWOL Connect CLI that can register/reuse an app in the central Worker, install authentication into supported web projects, and verify the result with only one-time browser approval.

**Architecture:** Extend the existing `nakwol-auth` Worker with a `/connect/cli/*` control plane backed by D1 device grants, CLI tokens, developer roles, and app ownership. Add a dependency-free ESM CLI under `packages/connect-cli/`; package it as `@nakwol/connect` and also serve a Worker-hosted `.tgz` so it is executable before npm publication.

**Tech Stack:** Cloudflare Workers, D1, Hono, TypeScript, Node.js 22, Node built-ins, `tsx` only for TypeScript tests, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-nakwol-connect-v0.2-agent-cli-design.md`

## Global Constraints

- Preserve existing Worker URL, D1, Discord OAuth, Web SDK v0.1.0, Connect v0.1 routes, and `siege-calculator` behavior.
- Never expose Discord Client Secret, Cloudflare credentials, raw device codes, or raw CLI tokens in D1/logs/project files.
- CLI-created apps default to `member`; developers may select `public` or `member`; `admin` requires operator rights.
- `.nakwol-connect.json` contains no secret and is safe to commit.
- Re-running `init` must be idempotent; local edits use explicit NAKWOL marker comments.
- Existing `auth_operators` entries are global operators even without a `connect_developers` row.
- Exact `npx @nakwol/connect init` requires npm publication; before that, the Worker-hosted tarball command is the production fallback.

---

### Task 1: Add test harness and Connect CLI domain rules

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Create: `tests/worker/connect-cli-domain.test.ts`
- Create: `src/connect-cli-domain.ts`

**Interfaces:**
- Produces `normalizeClientId(input: string): string`
- Produces `validateConnectRedirectUri(value: string): { ok: true; value: string } | { ok: false; code: string }`
- Produces `resolveDevicePollStatus(status: string, expiresAt: number, now: number): 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'`
- Produces `canDeveloperManageApp(input: { isOperator: boolean; userId: string; ownerUserIds: string[] }): boolean`

- [ ] **Step 1: Add the failing domain tests and test script**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeClientId,
  validateConnectRedirectUri,
  resolveDevicePollStatus,
  canDeveloperManageApp,
} from '../../src/connect-cli-domain';

test('normalizes a project name to a client id', () => {
  assert.equal(normalizeClientId('낙월 Battle Map'), 'battle-map');
});

test('accepts localhost and https redirect URIs only', () => {
  assert.equal(validateConnectRedirectUri('http://localhost:5173/').ok, true);
  assert.equal(validateConnectRedirectUri('https://tool.pages.dev/').ok, true);
  assert.deepEqual(validateConnectRedirectUri('http://example.com/'), { ok: false, code: 'HTTPS_REQUIRED' });
});

test('expires pending device requests by time', () => {
  assert.equal(resolveDevicePollStatus('pending', 1000, 1001), 'expired');
});

test('owners and operators may manage apps', () => {
  assert.equal(canDeveloperManageApp({ isOperator: false, userId: 'u1', ownerUserIds: ['u1'] }), true);
  assert.equal(canDeveloperManageApp({ isOperator: true, userId: 'u2', ownerUserIds: [] }), true);
  assert.equal(canDeveloperManageApp({ isOperator: false, userId: 'u2', ownerUserIds: ['u1'] }), false);
});
```

Add to root `package.json`:

```json
"test": "node --import tsx --test tests/worker/*.test.ts packages/connect-cli/test/*.test.mjs"
```

and dev dependency `"tsx": "^4.20.0"`.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because `src/connect-cli-domain.ts` does not exist.

- [ ] **Step 3: Implement minimal domain helpers**

Implement only the four exported functions above. `normalizeClientId` strips non-ASCII letters/numbers, converts separators to `-`, collapses dashes, trims them, uses `nakwol-app` when empty, and caps at 63 characters. Redirect validation permits `https:` or `http:` only when hostname is `localhost`, `127.0.0.1`, or `[::1]`.

- [ ] **Step 4: Run tests and verification**

Run: `npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir .dry-run`

Expected: all PASS.

- [ ] **Step 5: Commit**

Commit message: `test: establish Connect CLI domain rules`

---

### Task 2: Add D1 model and device authorization control-plane

**Files:**
- Create: `migrations/0004_nakwol_connect_cli.sql`
- Create: `src/connect-cli-store.ts`
- Create: `src/connect-cli-routes.ts`
- Create: `src/assets/nakwol-connect-device.js.txt`
- Modify: `src/sdk-entry.ts`
- Create: `tests/worker/connect-cli-device.test.ts`

**Interfaces:**
- `createDeviceGrant(env, scopes)` returns `{ deviceCode, userCode, verificationUri, expiresIn, interval }`
- `approveDeviceGrant(env, userCode, userId)` approves only operator/active developer users
- `exchangeDeviceGrant(env, deviceCode)` returns one CLI bearer token once, never twice
- `authenticateCliToken(env, rawToken)` returns `{ userId, scopes, isOperator } | null`
- Routes: `/connect/cli/device/start`, `/connect/cli/device/verify`, `/connect/cli/device/approve`, `/connect/cli/device/deny`, `/connect/cli/device/token`, `/connect/cli/me`

- [ ] **Step 1: Write failing device-flow tests**

Tests cover pure exported helpers for token TTL/status transitions and a static migration scan asserting these tables exist:

```text
connect_developers
application_owners
connect_device_requests
connect_cli_tokens
```

Also assert migration registers active internal app `nakwol-connect-cli` with exact redirect `https://nakwol-auth.sepsd21.workers.dev/connect/cli/device/verify`.

- [ ] **Step 2: Run RED**

Run: `npm test`

Expected: FAIL because migration/store/routes are absent.

- [ ] **Step 3: Implement migration and store**

Use `sha256Base64Url` for raw device/token hashing. Device requests live 10 minutes, poll interval 3 seconds, CLI tokens live 30 days. Device statuses are `pending|approved|denied|consumed|expired`.

- [ ] **Step 4: Implement browser approval page and routes**

The verification page loads the existing Web SDK with client id `nakwol-connect-cli`, stores `user_code` in `sessionStorage`, redirects through the normal SSO, and POSTs approval with the app access token. Non-developers receive `DEVELOPER_PERMISSION_REQUIRED`.

- [ ] **Step 5: Run GREEN**

Run: `npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir .dry-run`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: add Connect CLI device authorization`

---

### Task 3: Add developer management and app ownership APIs

**Files:**
- Create: `src/connect-admin-developers.ts`
- Modify: `src/connect-cli-routes.ts`
- Modify: `src/assets/nakwol-connect-admin.js.txt`
- Create: `tests/worker/connect-cli-permissions.test.ts`

**Interfaces:**
- Admin routes: `GET /admin/api/developers`, `POST /admin/api/developers`, `PATCH /admin/api/developers/:userId`, `POST /admin/api/apps/:clientId/owners`
- CLI routes: `POST /connect/cli/apps`, `GET /connect/cli/apps/:clientId`, `PATCH /connect/cli/apps/:clientId`, `POST /connect/cli/apps/:clientId/redirects`, `GET /connect/cli/apps/:clientId/diagnose`
- Developers manage only rows in `application_owners`; operators bypass ownership.

- [ ] **Step 1: Write failing permission tests**

Test that developers may create a `member` or `public` app, may not request `admin`, may mutate owned apps, may not mutate unowned apps, and operators may do all of the above.

- [ ] **Step 2: Run RED**

Run: `npm test`

Expected: FAIL because the management functions/routes are absent.

- [ ] **Step 3: Implement developer/admin management**

List known NAKWOL users with developer status and owned app count. Existing `auth_operators` are emitted as `operator`. Granting developer role inserts/updates `connect_developers`; disabling keeps history and sets `status='disabled'`.

- [ ] **Step 4: Implement CLI app management**

When creating an app, normalize the proposal, append `-2`, `-3`, etc. on collision, insert `applications`, `application_settings`, and `application_owners` in one `DB.batch`. Redirect mutation validates exact URLs and de-duplicates entries.

- [ ] **Step 5: Extend admin UI**

Add a Developers section that lists user display name + NAKWOL ID + role/status + owned-app count, with grant/disable controls and ownership assignment. No new password UI.

- [ ] **Step 6: Run GREEN and bundle**

Run: `npm test && npm run typecheck && npx wrangler deploy --dry-run --outdir .dry-run`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: manage Connect developers and app ownership`

---

### Task 4: Build the local CLI project detector and safe installer

**Files:**
- Create: `packages/connect-cli/package.json`
- Create: `packages/connect-cli/bin/nakwol-connect.mjs`
- Create: `packages/connect-cli/src/project.mjs`
- Create: `packages/connect-cli/src/integration.mjs`
- Create: `packages/connect-cli/src/config.mjs`
- Create: `packages/connect-cli/test/project.test.mjs`
- Create: `packages/connect-cli/test/integration.test.mjs`

**Interfaces:**
- `detectProject(root)` returns `{ framework, targetFile, projectName, defaultRedirectUri }`
- `installIntegration(root, project, clientId)` returns `{ changedFiles, integration }`
- `removeIntegration(root)` removes only marker-owned content
- `readProjectConfig(root)` / `writeProjectConfig(root, config)` manage `.nakwol-connect.json`

Markers:

```text
<!-- NAKWOL-CONNECT:START -->
<!-- NAKWOL-CONNECT:END -->
```

For Next.js TSX/JSX use:

```text
{/* NAKWOL-CONNECT:START */}
{/* NAKWOL-CONNECT:END */}
```

- [ ] **Step 1: Write fixture-based failing tests**

Create temporary fixtures in the tests for React+Vite, generic Vite, static HTML, SvelteKit, Next App Router, already-installed project, and unsupported project. Assert detection and exact target file. Assert running install twice produces one marker block.

- [ ] **Step 2: Run RED**

Run: `npm test`

Expected: FAIL because CLI modules do not exist.

- [ ] **Step 3: Implement detector**

Detection order exactly follows the spec. Vite/HTML installers inject a Universal Embed before `</body>` with only `src` and `data-client-id`, intentionally omitting fixed `data-redirect-uri` so the current environment URL is used.

- [ ] **Step 4: Implement Next.js insertion and rollback-safe edits**

Add `next/script` import only if absent, insert a marked `<Script src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js" data-client-id="..." />` in global layout/app shell, and retain original file contents so a failed multi-file operation can restore them.

- [ ] **Step 5: Implement config and remove**

`.nakwol-connect.json` schema is version 1 and contains `clientId`, `framework`, `redirectUris`, `integration`. `remove` deletes only marker blocks and the config file.

- [ ] **Step 6: Run GREEN**

Run: `npm test`

Expected: all fixture tests PASS.

- [ ] **Step 7: Commit**

Commit message: `feat: add idempotent Connect project installer`

---

### Task 5: Build CLI auth/API commands and LLM-friendly output

**Files:**
- Create: `packages/connect-cli/src/api.mjs`
- Create: `packages/connect-cli/src/session.mjs`
- Create: `packages/connect-cli/src/commands.mjs`
- Modify: `packages/connect-cli/bin/nakwol-connect.mjs`
- Create: `packages/connect-cli/test/commands.test.mjs`

**Interfaces:**
- Commands: `init`, `doctor`, `status`, `add-url <url>`, `sync`, `remove`
- Options: `--json`, `--url`, `--name`, `--client-id`, `--no-open`, `--auth-origin`
- Session path: `~/.nakwol/connect-cli-session.json`, written mode `0600` where supported

- [ ] **Step 1: Write failing command tests with a local fake HTTP server**

Test that `init` calls device start only when no valid session exists, creates/reuses an app before editing files, writes config after successful edit, and `doctor --json` exits non-zero with deterministic failed checks when the marker is missing.

- [ ] **Step 2: Run RED**

Run: `npm test`

Expected: FAIL because command/auth/API modules are absent.

- [ ] **Step 3: Implement device login**

Open browser best-effort via `start`/`open`/`xdg-open`; always print `verification_uri_complete` and user code. Poll at server-provided interval until approved/denied/expired. Never print bearer token.

- [ ] **Step 4: Implement `init`**

Order is: detect -> read session/auth -> create/reuse central app -> install locally -> write config -> local doctor -> optional central diagnose. If central registration fails, make no local edit. If local install fails, rollback local edits.

- [ ] **Step 5: Implement remaining commands**

`status` reports local + central state; `doctor` checks config, marker, central ownership, redirect registration; `add-url` calls the Worker and updates config; `sync` repairs marker/config drift; `remove` is local only.

- [ ] **Step 6: Run GREEN**

Run: `npm test`

Expected: PASS with deterministic JSON snapshots.

- [ ] **Step 7: Commit**

Commit message: `feat: add Connect agent CLI commands`

---

### Task 6: Package, serve, deploy, and production-smoke the CLI

**Files:**
- Create: `scripts/build-connect-cli-package.mjs`
- Create generated: `src/assets/nakwol-connect-cli.tgz.b64.txt`
- Modify: `src/text-modules.d.ts`
- Modify: `src/connect-cli-routes.ts`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/production-smoke.yml`
- Modify: `CONNECT.md`
- Modify: `README.md`
- Create: `llms.txt` route or equivalent Worker response under `/llms.txt`

**Interfaces:**
- `GET /connect/cli/package.tgz` returns `application/gzip`
- `GET /connect/cli/manifest.json` returns package version, npm name, tarball URL, and canonical commands
- Until npm publish, canonical executable command is:

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/package.tgz -- nakwol-connect init
```

- [ ] **Step 1: Add package build script and failing freshness check**

`npm run cli:pack` runs `npm pack` inside `packages/connect-cli`, base64-encodes the resulting tgz, and writes `src/assets/nakwol-connect-cli.tgz.b64.txt`. CI runs the script then `git diff --exit-code -- src/assets/nakwol-connect-cli.tgz.b64.txt`.

- [ ] **Step 2: Run RED**

Run: `npm run cli:pack`

Expected before route/assets are complete: package freshness/route static checks fail.

- [ ] **Step 3: Serve package and manifest**

Decode base64 to bytes at request time and return immutable cache headers for the versioned tarball route. Add `/llms.txt` that tells coding agents to prefer the official CLI and run `doctor` after `init`.

- [ ] **Step 4: Update CI/deploy**

Verification order: `npm test`, `npm run typecheck`, `npm run cli:pack`, generated-asset freshness, Wrangler dry-run. Deployment runs the same preflight before D1 migration/deploy.

- [ ] **Step 5: Merge and let token-based deployment run**

Expected remote migration: `0004_nakwol_connect_cli.sql` applies once; existing migration state remains intact.

- [ ] **Step 6: Production smoke**

Verify D1 tables, internal `nakwol-connect-cli` app, device-start response, verification page HTTP 200, package manifest/tarball HTTP 200, and existing `siege-calculator`/v0.1 routes.

Then in a temporary fixture run the actual pre-publish command:

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/package.tgz -- nakwol-connect status --json
```

and run local fixture `init --json` against a controlled test API or pre-seeded CLI token so the package/bin entrypoint itself is proven executable.

- [ ] **Step 7: Final verification**

Run/confirm:

```text
npm test                     PASS
npm run typecheck            PASS
wrangler deploy --dry-run    PASS
D1 migration                 PASS
/connect/cli/device/start    PASS
/connect/cli/device/verify   PASS
/connect/cli/package.tgz     PASS
/connect/cli/manifest.json   PASS
/admin/apps                  PASS
/connect/v1.js               PASS
siege-calculator app row     unchanged/public
```

- [ ] **Step 8: Commit/finish branch**

Commit message: `feat: ship NAKWOL Connect v0.2 agent CLI`
