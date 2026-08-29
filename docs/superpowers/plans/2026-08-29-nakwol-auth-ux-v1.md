# NAKWOL AUTH UX v1 Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a service-native Identity Menu, a user-facing `/account` center, and a privileged `/lab` verification surface without changing the existing Discord OAuth/PKCE/SSO security model or the pinned Web SDK v0.1.0 contract.

**Architecture:** Preserve AUTH core and ship a new immutable Web SDK v0.2.0 alongside untouched v0.1.0. Add two internal OAuth clients (`nakwol-account-center`, `nakwol-auth-lab`) and focused Hono modules for Account Center and Auth Lab. Connected-service data is derived only from existing user/app AUTH evidence; AUTH never reads DATA D1 and never fabricates DATA scopes.

**Tech Stack:** TypeScript, Hono 4, Cloudflare Workers, Cloudflare D1, browser ESM, Node 22 + `tsx`, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-29-nakwol-auth-ux-v1-design.md`

## Global Constraints

- Workflow remains `task branch -> dev -> main -> stable`; never direct-push/force-push long-lived branches.
- `/sdk/v0.1.0/nakwol-auth-web.js` remains immutable; do not edit `src/assets/nakwol-auth-web.js.txt`.
- New SDK version is exactly `0.2.0`; stable alias moves only after the pinned v0.2.0 route exists.
- Preserve Authorization Code + PKCE(S256), state validation, exact redirect allowlists, app-bound tokens, `/me`, local/global logout, and CORS boundaries.
- Never render raw access/CLI tokens, session cookies, token hashes, Discord secrets, Cloudflare secrets, or PKCE verifiers.
- AUTH D1 and DATA D1 remain separate. Do not mirror or infer DATA scopes in AUTH.
- Connected services require user-specific successful AUTH evidence; app registration alone is insufficient.
- `/lab` shell is public enough to start login; full diagnostics require admin or active `connect_developers` developer/operator.
- Existing `mountNakwolAuthWidget` stays available for legacy/demo consumers; new integrations use `mountNakwolIdentityMenu`.
- No new runtime dependency is required.

## Locked File Map

**Create**
- `src/assets/nakwol-auth-web-v0.2.0.js.txt` — new immutable browser SDK.
- `src/account-store.ts` — evidence-backed connected-service query + user-facing AUTH permission mapping.
- `src/account.ts` — Account Center page/API.
- `src/platform-access.ts` — Lab privilege helpers only.
- `src/lab.ts` — Auth Lab page/API.
- `migrations/0005_auth_ux_v1.sql` — internal OAuth clients; non-destructive.
- `tests/worker/auth-sdk-v02.test.ts`
- `tests/worker/auth-ux-internal-apps.test.ts`
- `tests/worker/account-center.test.ts`
- `tests/worker/auth-lab.test.ts`
- `tests/worker/auth-ux-regression.test.ts`
- `docs/releases/2026-08-29-nakwol-auth-v0.2.md`

**Modify**
- `src/sdk.ts`, `src/sdk-entry.ts`, `src/store.ts`, `src/index.ts`, `package.json`
- `WEB_SDK.md`, `README.md`, `CODEX_HANDOFF.md`

**Do not modify**
- `src/assets/nakwol-auth-web.js.txt`
- `services/data/**` except running its verification suite.

---

### Task 1: Web SDK v0.2.0 + Compact Identity Menu

**Files:**
- Create: `src/assets/nakwol-auth-web-v0.2.0.js.txt`
- Modify: `src/sdk.ts`
- Test: `tests/worker/auth-sdk-v02.test.ts`

**Interfaces:**
- Produces `NAKWOL_AUTH_SDK_VERSION = '0.2.0'`.
- Produces `mountNakwolIdentityMenu(client, options)`.
- Options: `variant: 'button'|'compact'|'menu'`, `theme: 'inherit'|'light'|'dark'`, `container?`, `accountUrl?`, `showName?`, `showRole?`.
- Return: `{ element, ready, refresh, destroy }`.

- [ ] **Step 1: Write failing SDK contract test**

```ts
// tests/worker/auth-sdk-v02.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = (p:string) => readFile(new URL(`../../${p}`, import.meta.url), 'utf8');

test('v0.1 stays pinned and v0.2 adds Identity Menu', async () => {
  const oldSdk = await root('src/assets/nakwol-auth-web.js.txt');
  const nextSdk = await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');
  const routes = await root('src/sdk.ts');
  assert.match(oldSdk, /'0\.1\.0'/);
  assert.doesNotMatch(oldSdk, /mountNakwolIdentityMenu/);
  assert.match(nextSdk, /NAKWOL_AUTH_SDK_VERSION\s*=\s*'0\.2\.0'/);
  assert.match(nextSdk, /export function mountNakwolIdentityMenu/);
  assert.match(nextSdk, /button.*compact.*menu/s);
  assert.match(nextSdk, /inherit.*light.*dark/s);
  for (const v of ['--nakwol-auth-accent','--nakwol-auth-bg','--nakwol-auth-text','--nakwol-auth-muted','--nakwol-auth-border','--nakwol-auth-radius','--nakwol-auth-shadow']) assert.ok(nextSdk.includes(v));
  assert.match(nextSdk, /내 낙월 계정/);
  assert.match(nextSdk, /이 서비스 권한/);
  assert.match(nextSdk, /Escape/);
  assert.match(routes, /\/sdk\/v0\.1\.0\/nakwol-auth-web\.js/);
  assert.match(routes, /\/sdk\/v0\.2\.0\/nakwol-auth-web\.js/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/auth-sdk-v02.test.ts`

Expected: FAIL because the v0.2.0 asset/route do not exist.

- [ ] **Step 3: Copy v0.1.0 to a new immutable v0.2.0 asset, then extend only the copy**

```bash
cp src/assets/nakwol-auth-web.js.txt src/assets/nakwol-auth-web-v0.2.0.js.txt
```

In the new file set:

```js
export const NAKWOL_AUTH_SDK_VERSION = '0.2.0';
```

Keep `NakwolAuthClient` and `mountNakwolAuthWidget` behavior. Add:

```js
const IDENTITY_VARIANTS = new Set(['button','compact','menu']);
const IDENTITY_THEMES = new Set(['inherit','light','dark']);
const roleLabel = (r) => r === 'admin' ? '낙월 관리자' : r === 'member' ? '낙월 맹원' : '일반 사용자';

export function mountNakwolIdentityMenu(client, options = {}) {
  if (!(client instanceof NakwolAuthClient)) throw new NakwolAuthError('INVALID_CLIENT', 'NakwolAuthClient 인스턴스가 필요합니다.');
  const variant = options.variant || 'compact';
  const theme = options.theme || 'inherit';
  if (!IDENTITY_VARIANTS.has(variant)) throw new NakwolAuthError('INVALID_VARIANT', variant);
  if (!IDENTITY_THEMES.has(theme)) throw new NakwolAuthError('INVALID_THEME', theme);
  const root = options.container || node('div', 'nakwol-identity');
  root.dataset.variant = variant;
  root.dataset.theme = theme;
  if (!options.container) document.body.appendChild(root);
  // Render loading/logged-out/logged-in/error states using DOM APIs + textContent.
  // Logged-out text: 낙월 로그인.
  // Logged-in trigger: avatar + display_name + disclosure.
  // Menu: roleLabel, 내 낙월 계정, 이 서비스 권한, 로그아웃.
  // Account URL: <authOrigin>/account?client_id=<clientId>.
  // Permission URL: same URL + #permissions.
  // Escape/outside click closes; close returns focus to trigger.
  return { element: root, ready: client.bootstrap(), refresh: () => client.getMe(), destroy: () => root.remove() };
}
```

Use semantic button/link elements and `aria-expanded`/`aria-haspopup`. Inject styles with exactly the seven CSS variables in Global Constraints. `inherit` consumes host variables; `light`/`dark` supply readable defaults.

- [ ] **Step 4: Serve both pinned versions**

`src/sdk.ts` imports old + new assets. Keep v0.1 immutable route on old source; add `/sdk/v0.2.0/nakwol-auth-web.js`; point `/sdk/nakwol-auth-web.js` and manifest stable/module to v0.2.0.

```ts
export const NAKWOL_AUTH_WEB_SDK_VERSION = '0.2.0';
```

- [ ] **Step 5: Verify GREEN + syntax**

```bash
npx tsx --test tests/worker/auth-sdk-v02.test.ts
cp src/assets/nakwol-auth-web-v0.2.0.js.txt /tmp/nakwol-auth-web-v0.2.0.mjs
node --check /tmp/nakwol-auth-web-v0.2.0.mjs
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/assets/nakwol-auth-web-v0.2.0.js.txt src/sdk.ts tests/worker/auth-sdk-v02.test.ts
git commit -m "feat(auth): add Web SDK v0.2 identity menu"
```

---

### Task 2: Internal Account/Lab OAuth Clients + Route Registration

**Files:**
- Create: `migrations/0005_auth_ux_v1.sql`, `src/account.ts`, `src/lab.ts`
- Modify: `src/sdk-entry.ts`
- Test: `tests/worker/auth-ux-internal-apps.test.ts`

**Interfaces:**
- `ACCOUNT_CLIENT_ID = 'nakwol-account-center'`
- `LAB_CLIENT_ID = 'nakwol-auth-lab'`
- `registerAccountRoutes(app)`, `registerLabRoutes(app)`.

- [ ] **Step 1: Write failing migration/route contract test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root=(p:string)=>readFile(new URL(`../../${p}`, import.meta.url),'utf8');

test('internal UX clients use exact production callbacks', async()=>{
  const sql=await root('migrations/0005_auth_ux_v1.sql');
  assert.match(sql,/nakwol-account-center/);
  assert.match(sql,/workers\.dev\/account/);
  assert.match(sql,/nakwol-auth-lab/);
  assert.match(sql,/workers\.dev\/lab/);
  assert.match(sql,/'internal'/);
  assert.match(sql,/'public'/);
  assert.doesNotMatch(sql,/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
});

test('production entry registers UX routes', async()=>{
  const entry=await root('src/sdk-entry.ts');
  assert.match(entry,/registerAccountRoutes\(app\)/);
  assert.match(entry,/registerLabRoutes\(app\)/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/auth-ux-internal-apps.test.ts`

Expected: FAIL.

- [ ] **Step 3: Add migration 0005 using UPSERT only**

Register `nakwol-account-center` -> `https://nakwol-auth.sepsd21.workers.dev/account` and `nakwol-auth-lab` -> `/lab` in `applications`; add matching `application_settings` with `framework='internal'`, `access_policy='public'`, `owner_user_id=NULL`. Use the same `ON CONFLICT ... DO UPDATE` style as migration 0004. No destructive statements.

- [ ] **Step 4: Add minimal focused route shells**

```ts
// src/account.ts
export const ACCOUNT_CLIENT_ID='nakwol-account-center';
export function accountPageHtml(){ return '<!doctype html><html lang="ko"><title>NAKWOL 계정</title><main id="account-root">NAKWOL 계정</main></html>'; }
export function registerAccountRoutes(app:Hono<{Bindings:Env}>){ app.get('/account',c=>c.html(accountPageHtml())); }
```

```ts
// src/lab.ts
export const LAB_CLIENT_ID='nakwol-auth-lab';
export function labPageHtml(){ return '<!doctype html><html lang="ko"><title>NAKWOL AUTH LAB</title><main id="lab-root">NAKWOL AUTH LAB</main></html>'; }
export function registerLabRoutes(app:Hono<{Bindings:Env}>){ app.get('/lab',c=>c.html(labPageHtml())); }
```

Import/register both in `src/sdk-entry.ts`.

- [ ] **Step 5: Verify GREEN**

```bash
npx tsx --test tests/worker/auth-ux-internal-apps.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0005_auth_ux_v1.sql src/account.ts src/lab.ts src/sdk-entry.ts tests/worker/auth-ux-internal-apps.test.ts
git commit -m "feat(auth): register account center and auth lab"
```

---

### Task 3: Evidence-Backed Account Summary API

**Files:**
- Create: `src/account-store.ts`
- Modify: `src/account.ts`
- Test: `tests/worker/account-center.test.ts`

**Interfaces:**
- `permissionLabelsForAccessPolicy(policy): string[]`
- `listConnectedServices(env,userId): Promise<ConnectedServiceSummary[]>`
- `GET /account/api/summary`, bearer token must belong to `nakwol-account-center`.

- [ ] **Step 1: Write failing mapping/evidence tests**

```ts
import { permissionLabelsForAccessPolicy, toConnectedServiceSummary } from '../../src/account-store';
assert.deepEqual(permissionLabelsForAccessPolicy('public'),['NAKWOL 기본 프로필 확인']);
assert.deepEqual(permissionLabelsForAccessPolicy('member'),['NAKWOL 기본 프로필 확인','낙월 맹원 여부 확인']);
assert.deepEqual(permissionLabelsForAccessPolicy('admin'),['NAKWOL 기본 프로필 확인','낙월 관리자 여부 확인']);
assert.deepEqual(toConnectedServiceSummary({client_id:'siege-calculator',name:'공성 시간 계산기',homepage_url:'https://siege-calculator.pages.dev/',access_policy:'public',last_authorized_at:123}),{client_id:'siege-calculator',name:'공성 시간 계산기',homepage_url:'https://siege-calculator.pages.dev/',last_authorized_at:123,permissions:['NAKWOL 기본 프로필 확인']});
```

Also source-assert `FROM auth_events`, `e.user_id = ?`, `discord.login.success`, `authorize.sso`, and exclusion of `framework='internal'`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/account-center.test.ts`

- [ ] **Step 3: Implement `src/account-store.ts`**

Use this query contract:

```sql
SELECT a.client_id,a.name,s.homepage_url,COALESCE(s.access_policy,'public') AS access_policy,MAX(e.created_at) AS last_authorized_at
FROM auth_events e
JOIN applications a ON a.client_id=e.client_id
LEFT JOIN application_settings s ON s.client_id=a.client_id
WHERE e.user_id=?
  AND e.client_id IS NOT NULL
  AND e.event_type IN ('discord.login.success','authorize.sso')
  AND a.status='active'
  AND COALESCE(s.framework,'') <> 'internal'
GROUP BY a.client_id,a.name,s.homepage_url,s.access_policy
ORDER BY last_authorized_at DESC
```

Map only AUTH-level permissions. Never read `services/data` or invent roster/deck scopes.

- [ ] **Step 4: Implement `/account/api/summary`**

Parse `Authorization: Bearer ...`; call existing `authenticateAccessToken(env, token, ACCOUNT_CLIENT_ID)`, then `getUserWithMembership`, then `listConnectedServices`. Return:

```json
{"ok":true,"data":{"user":{"id":"usr_...","display_name":"...","membership":{}},"services":[]}}
```

401 for missing/invalid token, 404 for missing user. Same-origin only; do not add wildcard CORS.

- [ ] **Step 5: Verify**

```bash
npx tsx --test tests/worker/account-center.test.ts
npm test
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/account-store.ts src/account.ts tests/worker/account-center.test.ts
git commit -m "feat(auth): add account summary API"
```

---

### Task 4: Complete Account Center UI

**Files:**
- Modify: `src/account.ts`, `tests/worker/account-center.test.ts`

**Interfaces:** consumes SDK v0.2.0 and `/account/api/summary`.

- [ ] **Step 1: Add failing HTML assertions**

Assert `accountPageHtml()` contains `sdk/v0.2.0`, `nakwol-account-center`, `Discord로 낙월 로그인`, `NAKWOL ID`, `연결된 서비스`, `서비스 권한`, `모든 낙월 서비스에서 로그아웃`, and `global: true`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/account-center.test.ts`

- [ ] **Step 3: Build exact page states**

Required IDs:

```html
<div id="account-identity"></div>
<section id="logged-out" hidden><button id="login">Discord로 낙월 로그인</button></section>
<section id="account-content" hidden>
  <section id="profile-card"></section>
  <section id="membership-card"></section>
  <section id="services-card"><div id="services"></div></section>
  <section id="permissions"><div id="permission-detail"></div></section>
  <button id="global-logout">모든 낙월 서비스에서 로그아웃</button>
</section>
<section id="account-error" hidden></section>
```

Module boot:

```js
import { NakwolAuthClient } from '/sdk/v0.2.0/nakwol-auth-web.js';
const auth=new NakwolAuthClient({clientId:'nakwol-account-center',redirectUri:location.origin+'/account'});
const user=await auth.bootstrap();
```

Logged out -> show CTA. Logged in -> fetch summary using `auth.getAccessToken()`. Render all user data with `textContent`. `?client_id=X` selects/highlights that service and fills `#permission-detail`; `#permissions` remains linkable from the service menu. Empty services text: `아직 표시할 연결 서비스 기록이 없습니다.`

Global logout requires `confirm()` then:

```js
await auth.logout({global:true,returnTo:location.origin+'/account'});
```

- [ ] **Step 4: Verify + dry-run bundle**

```bash
npx tsx --test tests/worker/account-center.test.ts
npx wrangler deploy --dry-run --outdir .dry-run
```

- [ ] **Step 5: Commit**

```bash
git add src/account.ts tests/worker/account-center.test.ts
git commit -m "feat(auth): build account center UI"
```

---

### Task 5: Privileged Lab Access + Safe Diagnostics API

**Files:**
- Create: `src/platform-access.ts`
- Modify: `src/store.ts`, `src/lab.ts`
- Test: `tests/worker/auth-lab.test.ts`

**Interfaces:**
- `canUseAuthLab({membershipRole,developerRole})`.
- `getAuthLabPrivilege(env,userId)`.
- `inspectAccessToken(env,rawToken,clientId)` returns only `{userId,clientId,expiresAt}`.
- `GET /lab/api/diagnostics`.

- [ ] **Step 1: Write failing privilege/redaction tests**

```ts
assert.equal(canUseAuthLab({membershipRole:'admin',developerRole:null}),true);
assert.equal(canUseAuthLab({membershipRole:'member',developerRole:'developer'}),true);
assert.equal(canUseAuthLab({membershipRole:'user',developerRole:'operator'}),true);
assert.equal(canUseAuthLab({membershipRole:'member',developerRole:null}),false);
```

Build a `safeLabDiagnosticShape(...)` fixture and assert serialized output does not contain `access_token`, `token_hash`, `session_cookie`, `pkce_verifier`, or `client_secret`.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/auth-lab.test.ts`

- [ ] **Step 3: Implement privilege lookup**

`getAuthLabPrivilege` reads the user's membership role for `env.NAKWOL_GUILD_ID` and `connect_developers(role,status)`. Disabled developers yield `developerRole=null`. Admin OR active developer/operator yields `canUseLab=true`.

- [ ] **Step 4: Add safe token inspection to `src/store.ts`**

```ts
export async function inspectAccessToken(env:Env,rawToken:string,clientId:string):Promise<{userId:string;clientId:string;expiresAt:number}|null>{
  const hash=await sha256Base64Url(rawToken);
  const row=await env.DB.prepare(`SELECT user_id,client_id,expires_at,revoked_at FROM access_tokens WHERE token_hash=?`).bind(hash).first<any>();
  if(!row||row.revoked_at||row.expires_at<=Date.now()||row.client_id!==clientId)return null;
  return {userId:row.user_id,clientId:row.client_id,expiresAt:Number(row.expires_at)};
}
```

Never return token/hash.

- [ ] **Step 5: Implement diagnostics endpoint**

Bearer token must be valid for `nakwol-auth-lab`; 403 if `canUseLab=false`. Check `nakwol_sid` via existing `parseCookies` + `findSessionUser` and return only a same-user boolean. Diagnostic payload keys:

```text
central_session, app_access_token, me_status, nakwol_id,
client_id, redirect_uri, pkce_method, token_expires_at,
membership_role, developer_role
```

Fixed safe values: `pkce_method='S256'`, redirect URI `https://nakwol-auth.sepsd21.workers.dev/lab`.

- [ ] **Step 6: Verify + commit**

```bash
npx tsx --test tests/worker/auth-lab.test.ts
npm run typecheck
git add src/platform-access.ts src/store.ts src/lab.ts tests/worker/auth-lab.test.ts
git commit -m "feat(auth): add safe auth lab diagnostics"
```

---

### Task 6: Complete Auth Lab UI

**Files:** `src/lab.ts`, `tests/worker/auth-lab.test.ts`

- [ ] **Step 1: Add failing page assertions**

Assert Lab HTML contains v0.2.0 SDK, `nakwol-auth-lab`, `테스트 로그인 시작`, `/me 다시 확인`, `앱 로그아웃`, `SSO 재로그인 테스트`, `전체 로그아웃`, `진단 권한 없음`, and contains no raw-secret labels.

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test tests/worker/auth-lab.test.ts`

- [ ] **Step 3: Implement three explicit states**

```html
<section id="lab-login" hidden>...</section>
<section id="lab-forbidden" hidden>진단 권한 없음</section>
<section id="lab-panel" hidden><div id="diagnostics"></div>...</section>
<section id="lab-error" hidden></section>
```

Bootstrap:

```js
const auth=new NakwolAuthClient({clientId:'nakwol-auth-lab',redirectUri:location.origin+'/lab'});
const user=await auth.bootstrap();
```

No user -> login shell. Logged user -> call diagnostics. 403 -> forbidden. 200 -> render PASS/FAIL/INFO plus safe values. Never render `auth.getAccessToken()` itself.

Actions:

```js
refreshMe.onclick=async()=>{await auth.getMe();await loadDiagnostics();};
logoutApp.onclick=async()=>{await auth.logout();location.reload();};
testSso.onclick=()=>auth.login();
logoutGlobal.onclick=()=>auth.logout({global:true,returnTo:location.origin+'/lab'});
```

- [ ] **Step 4: Verify + commit**

```bash
npx tsx --test tests/worker/auth-lab.test.ts
npx wrangler deploy --dry-run --outdir .dry-run
git add src/lab.ts tests/worker/auth-lab.test.ts
git commit -m "feat(auth): build privileged auth lab UI"
```

---

### Task 7: OAuth Regression Guards, Version 0.2.0, Docs

**Files:**
- Create: `tests/worker/auth-ux-regression.test.ts`, `docs/releases/2026-08-29-nakwol-auth-v0.2.md`
- Modify: `src/index.ts`, `package.json`, `WEB_SDK.md`, `README.md`, `CODEX_HANDOFF.md`

- [ ] **Step 1: Add regression guard before version edits**

```ts
const index=await root('src/index.ts');
const sdk=await root('src/assets/nakwol-auth-web-v0.2.0.js.txt');
assert.match(index,/INVALID_REDIRECT_URI/);
assert.match(index,/method !== 'S256'/);
assert.match(index,/CORS_DENIED/);
assert.match(index,/isAllowedOrigin/);
assert.match(sdk,/STATE_OR_PKCE_MISMATCH/);
assert.match(sdk,/sessionStorage/);
```

Also assert `package.json.version==='0.2.0'`, health exposes `0.2.0`, docs mention v0.1 immutable + v0.2 + Identity Menu + `/account` + `/lab`. Run once: security assertions must already PASS; version assertions should RED.

- [ ] **Step 2: Bump private AUTH service + health version**

`package.json`: `"version":"0.2.0"`.

`src/index.ts` health: `version: '0.2.0'`. Add landing links `/account`, `/lab`; do not refactor OAuth handlers.

- [ ] **Step 3: Update docs with exact public contract**

`WEB_SDK.md` documents v0.1 immutable, v0.2 pinned URL, stable alias, `mountNakwolIdentityMenu`, variants/themes/seven CSS variables. `README.md` documents `/account` vs `/lab`. `CODEX_HANDOFF.md` records only verified facts.

- [ ] **Step 4: Create release-candidate notes**

`docs/releases/2026-08-29-nakwol-auth-v0.2.md` status stays `release candidate until stable production smoke succeeds`; scope lists SDK v0.2, Account Center, Lab, v0.1 compatibility. Evidence section instructs recording exact `git rev-parse stable`, deploy workflow ID, Worker version ID, health/manifest responses, and Lab matrix results after deployment.

- [ ] **Step 5: Full verification**

```bash
npx tsx --test tests/worker/auth-sdk-v02.test.ts tests/worker/auth-ux-internal-apps.test.ts tests/worker/account-center.test.ts tests/worker/auth-lab.test.ts tests/worker/auth-ux-regression.test.ts
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
cd services/data && npm install --legacy-peer-deps && npm test && npm run typecheck && npm run bundle && cd ../..
```

Expected: all green. DATA failure is a stop condition even though DATA source is unchanged.

- [ ] **Step 6: Commit**

```bash
git add tests/worker/auth-ux-regression.test.ts src/index.ts package.json WEB_SDK.md README.md CODEX_HANDOFF.md docs/releases/2026-08-29-nakwol-auth-v0.2.md
git commit -m "docs(auth): prepare AUTH v0.2 release contract"
```

---

### Task 8: Review, Promote, Smoke, Release

**Files:** all above; later release-only edit `ops/release.json`.

- [ ] **Step 1: Exact-final-head review**

```bash
git diff --stat dev...HEAD
git diff dev...HEAD -- src/index.ts src/sdk.ts src/sdk-entry.ts src/store.ts src/account.ts src/account-store.ts src/platform-access.ts src/lab.ts migrations/0005_auth_ux_v1.sql
git rev-parse HEAD
```

Confirm no `services/data/**` changes, no v0.1 asset edits, no secrets, no destructive migration, no OAuth/CORS weakening.

- [ ] **Step 2: Final verification on that SHA**

```bash
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
cd services/data && npm test && npm run typecheck && npm run bundle && cd ../..
```

- [ ] **Step 3: PR promotion only**

Open task -> `dev`; wait `governance`, `quality-gate`, Verify AUTH and Verify DATA as applicable. Merge exact head. Then `dev -> main` PR and `main -> stable` PR with the same discipline. Before stable merge verify repository metadata still says default `dev`, `delete_branch_on_merge=false`.

- [ ] **Step 4: Production route smoke after stable deploy**

```bash
curl -fsS https://nakwol-auth.sepsd21.workers.dev/api/health
curl -fsS https://nakwol-auth.sepsd21.workers.dev/sdk/manifest.json
curl -fsSI https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js
curl -fsSI https://nakwol-auth.sepsd21.workers.dev/sdk/v0.2.0/nakwol-auth-web.js
curl -fsSI https://nakwol-auth.sepsd21.workers.dev/sdk/nakwol-auth-web.js
curl -fsSI https://nakwol-auth.sepsd21.workers.dev/account
curl -fsSI https://nakwol-auth.sepsd21.workers.dev/lab
```

Expected: health `0.2.0`, manifest stable/module v0.2.0, both pinned SDKs 200, account/lab 200.

- [ ] **Step 5: Auth Lab matrix**

Record PASS/FAIL for V1–V12 from the spec. V8 does **not** introduce Discord token persistence/live polling: `/me` reflects latest stored verified membership; a new full Discord OAuth callback refreshes stored Discord membership/role.

- [ ] **Step 6: Formal component release only after smoke**

Create `release/auth-v0.2.0` from verified `stable`. Set `ops/release.json` to component `auth`, version `0.2.0`, notes file above, and `target_sha` copied from the exact verified deployed `git rev-parse stable` output. Open `release/auth-v0.2.0 -> stable`; require provenance guard; create `auth-v0.2.0` release. Afterwards reset descriptor to `enabled:false` through normal PR flow.

- [ ] **Step 7: Stop before consumer integration**

Do not modify `goyoung2/siege-calculator` until pinned production SDK v0.2.0 and `/account`/`/lab` are green. Execute the separate Siege Calculator integration plan next.
