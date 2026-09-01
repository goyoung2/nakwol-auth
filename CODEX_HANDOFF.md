# CODEX HANDOFF — NAKWOL AUTH / CONNECT / DATA

Last updated: 2026-09-01
Repository: `goyoung2/nakwol-auth`

## Read this first

새 작업은 다음 순서로 문맥을 복구한다.

1. `CODEX_HANDOFF.md`
2. `BRANCHING.md`
3. 현재 작업의 `docs/handoffs/*`
4. 관련 `docs/superpowers/specs/*` 및 `docs/superpowers/plans/*`
5. 실제 component `package.json`, CI, production evidence
6. `DATA.md`, `CONNECT.md`, `WEB_SDK.md`

개별 문서의 오래된 상태 문구보다 실제 package/CI/production evidence를 우선한다.

## Authoritative branch model

정상 흐름은 다음 하나다.

```text
feature/fix/chore/docs -> dev -> main -> stable -> component release
```

- Repository default branch: `dev`
- `dev`, `main`, `stable` are preserved long-lived branches.
- delete merged head branches: disabled
- GitHub Free private repository이므로 native Branch Protection은 unavailable / not active.
- 따라서 long-lived branch에 direct push/force-push하지 않고 PR promotion만 사용한다.

Hotfix는 예외적으로 `stable -> hotfix/* -> stable -> main -> dev` 흐름을 사용한다.

## Current repository state

AUTH v0.2.0 formal release, release-control cleanup, and back-propagation are all completed.

Current long-lived branch heads:

- `dev`: `4c4337a2ef8146b34f579d12773bf43c33464401`
- `main`: `598c05f371f328494c565a7f7d463ef09271320f`
- `stable`: `5fa4a0365462519089ddeae1d49ff2de3c5d4452`

All three currently resolve to the same tree:

```text
444fd9a5ec963d5970d560de90e3782314881fe7
```

The commit SHAs differ because of squash/promotion ancestry. Treat the current content as synchronized. Do not interpret GitHub compare `diverged` by itself as a content mismatch; inspect tree/blob/content differences.

Current open PR count at this handoff point: **0**.

`ops/release.json` is **disabled** after the AUTH release descriptor was disarmed.

## Current component state

### AUTH

- current production runtime: **AUTH 0.2.0**
- formal component tag / GitHub Release: **`auth-v0.2.0` — released**
- exact formal release target: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- final production deploy workflow: `33373705515` — success
- final production Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- final production smoke workflow: `33373908231` — success
- component-release workflow: `33374685878` — success
- release PR: `#67`
- descriptor disarm PR: `#68`
- stable -> main post-release back-propagation: `#69`
- main -> dev post-release back-propagation: `#70`
- production origin: `https://nakwol-auth.sepsd21.workers.dev`
- deployed scope: immutable Web SDK v0.2.0, Compact Identity Menu, `/account`, privileged `/lab`.
- pinned `src/assets/nakwol-auth-web.js.txt` / SDK v0.1.0 remains the immutable compatibility boundary.
- OAuth security boundary: Authorization Code + PKCE(S256), state validation, exact redirect allowlist, app-bound access token, restricted CORS.

Initial AUTH 0.2 production baseline remains historical evidence:

- stable SHA: `2ea002dca18cbb064be089167326cd311b315dd5`
- deploy workflow: `33350989974`
- Worker Version ID: `f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4`
- combined production smoke workflow: `33351486056`

Do not confuse this historical first deployment with the formal release target. The formal release target is `154baf448ee45a7b2bcf6e320f09a65866e1f8af`.

### Auth Lab release matrix

Auth Lab **V1–V12 release matrix is completed**.

Evidence nuances:

- V5 verifies client-side expiry/recovery and is not represented as a literal one-hour wall-clock wait.
- V7 has live callback/state mismatch evidence; PKCE verifier mismatch remains automated/server-side evidence.
- V8-A is automated PASS for fresh Discord membership refresh and member-policy allow -> deny -> allow behavior.
- V8-B live Discord role mutation has an approved release **waiver** because a controlled guild role mutation requires external server-admin/test-account authority.
- V10 live production proof is AUTH `/me` 200, DATA `/v1/me` 200, and registry 403 `SCOPE_DENIED` without `roster:read`.
- V11 and V12 live browser recovery/responsive/accessibility checks are PASS.

The V8-B waiver did not block `auth-v0.2.0` formal release.

### Final AUTH v0.2 deployment evidence

Stable candidate `154baf448ee45a7b2bcf6e320f09a65866e1f8af` was deployed by workflow `33373705515`.

Verified in the deployment job:

- stable provenance: `NAKWOL_STABLE_PROMOTION_OK:main->stable:#65`
- AUTH tests: 71/71 PASS
- typecheck: PASS
- Wrangler dry-run: PASS
- remote D1 migrations: no migrations to apply
- required applications: verified
- live DATA gate: `NAKWOL_DATA_V09_READY_FOR_AUTH_DEPLOY`
- Worker deployment: success
- Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- Connect v0.4 verification: `NAKWOL_CONNECT_V04_DEPLOY_OK`

No-merge final production smoke PR #66 produced workflow `33373908231` — success.

### Formal AUTH v0.2 release evidence

PR #67 created the release descriptor against exact target:

```text
154baf448ee45a7b2bcf6e320f09a65866e1f8af
```

Release-head verification:

- Verify NAKWOL AUTH `33374520124` — success
- Repository Governance `33374520113` — success, including AUTH/Connect and DATA quality gate

`Create Component Release` workflow `33374685878` completed successfully and published `auth-v0.2.0`.

PR #68 then disarmed the descriptor. `ops/release.json` must remain disabled unless a future audited component release is intentionally being created.

### Connect

- **Connect 0.4.0**
- npm `nakwol-connect@0.4.0` publish succeeded after stable PR #44.
- publish workflow evidence: `33255544407`.
- Connect v0.4 includes DATA OpenAPI discovery and `data describe --json`.

### DATA

- current production runtime: **DATA 0.9.0**
- schema 3
- production origin: `https://nakwol-data.sepsd21.workers.dev`
- OpenAPI 3.1 discovery: `/openapi.json`
- stable PR #43 release path deployed DATA first, then allowed AUTH deployment only after live DATA v0.9 contract verification.
- DATA deploy workflow evidence: `33255315017`.
- earlier AUTH deploy workflow evidence with DATA-first wait: `33255315038`.
- final AUTH v0.2 deploy `33373705515` also passed the live DATA 0.9 gate before Worker mutation.
- DATA-to-AUTH Service Binding hotfix is deployed and production-verified without changing AUTH D1/DATA D1 separation.

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

AUTH D1 and DATA D1 are separate. AUTH must not read DATA D1 or invent/mirror DATA scopes. DATA verifies caller identity through AUTH `/me` rather than AUTH D1 access.

## AUTH UX v1 implementation history

Historical implementation path:

- recovery/design history: closed draft PR #45
- feature -> dev promotion: PR #46
- dev -> main: PR #47
- main -> stable: PR #48
- initial AUTH 0.2 deployed stable: `2ea002dca18cbb064be089167326cd311b315dd5`
- initial deploy workflow: `33350989974`
- initial temporary no-merge production smoke probe: PR #49
- initial combined production smoke: `33351486056`
- V4 global logout fix: PR #53 -> #54 -> #55
- DATA-to-AUTH Service Binding fix: PR #57 -> #58 -> #59
- V8-A fresh membership refresh regression: PR #61
- final release evidence: PR #62
- ancestry reconciliation: PR #64
- final main -> stable promotion: PR #65
- final no-merge smoke: PR #66
- formal release: PR #67
- release descriptor disarm: PR #68
- post-release stable -> main: PR #69
- post-release main -> dev: PR #70

Relevant historical docs:

- `docs/handoffs/2026-08-31-nakwol-auth-ux-v1-resume.md` — historical recovery context; old release-readiness status is superseded
- `docs/releases/2026-08-29-nakwol-auth-v0.2.md` — authoritative formal release record
- `docs/superpowers/plans/2026-08-31-auth-v0.2.0-formal-release.md` — historical execution plan; tasks were executed even if old unchecked boxes remain
- `docs/superpowers/specs/2026-08-29-nakwol-auth-ux-v1-design.md`
- `docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1.md`

Implemented boundaries:

- SDK v0.2.0 is a new immutable asset; v0.1.0 remains untouched.
- `mountNakwolIdentityMenu` is the new integration UI; legacy `mountNakwolAuthWidget` remains.
- `/account` uses `nakwol-account-center` app-bound tokens and user-specific successful AUTH evidence for connected services.
- `/lab` uses `nakwol-auth-lab` app-bound tokens and permits diagnostics only for NAKWOL admins or active Connect developer/operator users.
- Lab diagnostics return safe metadata only; never raw token/hash/session cookie/PKCE verifier/client secret.

## Current next product task

AUTH v0.2.0 itself has **no remaining formal release blocker**.

The next product-level follow-up is separate from the completed release:

**`siege-calculator` Identity Menu / seamless SSO integration.**

Current UX boundary:

- a newly opened destination tab does not have another app's `sessionStorage` token by design;
- the consumer app may detect its missing app token;
- it can automatically begin its own PKCE authorization flow;
- the existing central AUTH session can be reused so the user does not need to re-enter Discord credentials;
- the flow must preserve app-bound token isolation and exact redirect allowlists.

Do not reopen AUTH v0.2 release work merely because historical plan/handoff files contain old unchecked release steps.

## DATA safety boundary

User-owned generals, tactics, equipment and decks are permanent account assets. Registry reseeding is UPSERT-only; never DELETE/TRUNCATE user-owned data.

`canonical applicability` is intentionally 0 until authoritative applicability evidence is supplied. Do not infer weapon/mount applicability from names, descriptions, ID ranges or observed combinations. Generic `game_stat_types` are not automatically an equipment option catalog.

## Historical formal DATA v0.8 release baseline

This section is historical release evidence, not the current DATA runtime.

- DATA 0.8.0
- schema 3
- formal tag/name: `data-v0.8.0`
- historical Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
- exact verified deployment target: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- formal release workflow: `33157010443`
- notes: `docs/releases/2026-08-27-nakwol-data-v0.8.md`
- canonical applicability remains 0 until authoritative data arrives.

The existence of this formal v0.8 release does not downgrade the current production runtime, which is DATA 0.9.0.

## Verification commands

Repository root:

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
```

DATA:

```bash
cd services/data
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run bundle
```

Before a completion/release claim, verify the exact final SHA. A DATA verification failure is a stop condition for AUTH stable promotion even when DATA source is unchanged.

## Release / production rules

- Production-capable deployment/publish automation belongs to `stable` only.
- Normal promotion is `dev -> main -> stable` by PR.
- Component tags: `data-vX.Y.Z`, `connect-vX.Y.Z`, `auth-vX.Y.Z`.
- Formal component release is created only after the release-specific production smoke/manual verification contract is satisfied.
- `ops/release.json` is the audited release descriptor and must not be left armed accidentally.
- production workflows must pass `scripts/verify-stable-promotion.mjs`.
- DATA-first production ordering must remain fail-closed.

## Do not do these

- do not edit the pinned v0.1 Web SDK asset;
- do not develop/direct-push on `main` or `stable`;
- do not direct-push or force-push `dev`;
- do not bypass stable promotion or DATA-first gates;
- do not recreate or move the existing `auth-v0.2.0` tag/Release;
- do not leave `ops/release.json` armed after a component release;
- do not expose raw authentication secrets in `/lab` or docs;
- do not merge AUTH and DATA D1 responsibilities;
- do not delete/truncate Registry or user-owned data during reseed;
- do not invent game rules or canonical equipment applicability;
- do not branch from historical feature/ops refs without fresh comparison against `dev`.

## Next

1. Treat `auth-v0.2.0` as formally released and production-verified.
2. Keep release descriptor disabled and preserve the synchronized `dev/main/stable` content baseline.
3. For new work, branch from current `dev` using an allowed source prefix.
4. Proceed with the separate `siege-calculator` Identity Menu / seamless SSO integration when working on the next product task.
5. Preserve AUTH/DATA D1 separation, DATA-first release ordering, immutable SDK boundaries, and app-bound token isolation.
