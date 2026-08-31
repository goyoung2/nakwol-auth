# CODEX HANDOFF — NAKWOL AUTH / CONNECT / DATA

Last updated: 2026-08-31
Repository: `goyoung2/nakwol-auth`

## Read this first

새 작업은 다음 순서로 문맥을 복구한다.

1. `CODEX_HANDOFF.md`
2. `BRANCHING.md`
3. 현재 작업의 `docs/handoffs/*`
4. 관련 `docs/superpowers/specs/*` 및 `docs/superpowers/plans/*`
5. 실제 component `package.json`, CI, production evidence
6. `DATA.md`, `CONNECT.md`, `WEB_SDK.md`

개별 문서의 오래된 버전 제목보다 실제 package/CI/production evidence를 우선한다.

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

## Current component state

### AUTH

- current production runtime: **AUTH 0.2.0**
- initial AUTH 0.2 production stable SHA: `2ea002dca18cbb064be089167326cd311b315dd5`
- initial AUTH 0.2 production Worker Version ID: `f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4`
- initial AUTH 0.2 production deploy workflow: `33350989974` — success
- production platform smoke workflow: `33351486056` — success
- formal component release/tag: **pending final stable promotion, production deployment verification, and release-PR provenance gate**
- Auth Lab **V1–V12 release matrix is completed**. V8-B live Discord role mutation has an approved release **waiver** because it requires controlled external guild role-management authority; V8-A automatically verifies the fresh Discord refresh, membership persistence, and member-policy allow/deny/allow path.
- production origin: `https://nakwol-auth.sepsd21.workers.dev`
- deployed scope: immutable Web SDK v0.2.0, Compact Identity Menu, `/account`, privileged `/lab`.
- pinned `src/assets/nakwol-auth-web.js.txt` / SDK v0.1.0 remains the immutable compatibility boundary.
- OAuth security boundary: Authorization Code + PKCE(S256), state validation, exact redirect allowlist, app-bound access token, restricted CORS.

Production smoke evidence on run `33351486056`:

- production AUTH D1 schema and internal apps `nakwol-account-center`, `nakwol-auth-lab` verified read-only;
- AUTH health/SDK manifest/v0.1/v0.2/stable alias/account/lab all returned expected production responses;
- unauthenticated Account/Lab APIs returned 401;
- production v0.1 SDK was byte-equal to the pinned repository v0.1 asset;
- production v0.2 SDK and stable alias were byte-equal to the repository v0.2 asset;
- Connect manifest/package/admin/developer/device-verify/llms surfaces were green as Connect 0.4;
- production Connect package executed and reported `NAKWOL Connect CLI v0.4`;
- DATA OpenAPI remained 3.1.0 / DATA 0.9.0.

The smoke workflow is intentionally read-only against production D1 and must not create test device requests.

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
- AUTH 0.2 production deploy `33350989974` also passed the live DATA 0.9 gate before Worker mutation.
- DATA-to-AUTH Service Binding hotfix was later promoted to stable and production-verified without changing AUTH D1/DATA D1 separation.

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

AUTH D1 and DATA D1 are separate. AUTH must not read DATA D1 or invent/mirror DATA scopes. DATA verifies caller identity through AUTH `/me` rather than AUTH D1 access.

## AUTH UX v1 release history

- recovery/design history: closed draft PR #45
- feature -> dev promotion: PR #46, exact feature head `b959ce2242c9394a7d7cbdd56a396cc637c8d25e`
- dev -> main: PR #47
- main -> stable: PR #48
- initial deployed stable: `2ea002dca18cbb064be089167326cd311b315dd5`
- initial deploy workflow: `33350989974`
- temporary no-merge production smoke probe: PR #49
- combined production smoke evidence: `33351486056`
- V8-A fresh membership refresh regression: PR #61 -> `dev`
- recovery handoff: `docs/handoffs/2026-08-31-nakwol-auth-ux-v1-resume.md` (historical recovery context; its old release-readiness status is superseded)
- release evidence: `docs/releases/2026-08-29-nakwol-auth-v0.2.md`
- formal release execution plan: `docs/superpowers/plans/2026-08-31-auth-v0.2.0-formal-release.md`
- design: `docs/superpowers/specs/2026-08-29-nakwol-auth-ux-v1-design.md`
- implementation plan: `docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1.md`

Implemented boundaries:

- SDK v0.2.0 is a new immutable asset; v0.1.0 remains untouched.
- `mountNakwolIdentityMenu` is the new integration UI; legacy `mountNakwolAuthWidget` remains.
- `/account` uses `nakwol-account-center` app-bound tokens and user-specific successful AUTH evidence for connected services.
- `/lab` uses `nakwol-auth-lab` app-bound tokens and permits diagnostics only for NAKWOL admins or active Connect developer/operator users.
- Lab diagnostics return safe metadata only; never raw token/hash/session cookie/PKCE verifier/client secret.

## Formal AUTH v0.2.0 release gate

Do **not** create the formal `auth-v0.2.0` component release until the final stable promotion and production deployment are freshly verified.

The Auth Lab **V1–V12 matrix is completed**. Evidence nuances are intentionally preserved:

- V5 verifies client-side expiry/recovery and is not represented as a literal one-hour wall-clock wait.
- V7 has live callback/state mismatch evidence; PKCE verifier mismatch remains automated/server-side evidence.
- V8-A is automated PASS for fresh Discord membership refresh and member-policy allow -> deny -> allow behavior.
- V8-B live Discord role mutation has an approved release **waiver** because a controlled guild role mutation requires external server-admin/test-account authority.
- V10 live production proof is AUTH `/me` 200, DATA `/v1/me` 200, and registry 403 `SCOPE_DENIED` without `roster:read`.
- V11 and V12 live browser recovery/responsive/accessibility checks are PASS.

The remaining blocker is lifecycle/provenance rather than functional verification: promote the V8-A/refined release contract through `dev -> main -> stable`, verify the stable-triggered AUTH deployment and DATA-first gate, capture the exact final stable release target, then create the release only through `release/auth-v0.2.0 -> stable` and the guarded component-release workflow.

Because promotions are squash merges, never point `ops/release.json.target_sha` at a `dev` or `main` SHA. It must point at the exact final verified **stable** commit.

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
- do not create formal AUTH v0.2.0 before final stable promotion, production deployment verification, exact target capture, and release-PR provenance validation;
- do not expose raw authentication secrets in `/lab` or docs;
- do not merge AUTH and DATA D1 responsibilities;
- do not delete/truncate Registry or user-owned data during reseed;
- do not invent game rules or canonical equipment applicability;
- do not branch from historical feature/ops refs without fresh comparison against `dev`.

## Next

1. Finish the release-evidence PR to `dev` with the updated V1–V12/V8 waiver contract and fresh full quality gates.
2. Promote `dev -> main -> stable` with exact diff review and pinned PR heads.
3. Verify the stable-triggered AUTH production deployment, DATA-first live contract gate and combined production smoke.
4. Capture the exact final verified stable release target and final deployment evidence.
5. Create `release/auth-v0.2.0` from that exact stable target, change only `ops/release.json`, and let the guarded component-release workflow create `auth-v0.2.0`.
6. After formal release, execute the separate `siege-calculator` Identity Menu/seamless-SSO follow-up plan as appropriate.
