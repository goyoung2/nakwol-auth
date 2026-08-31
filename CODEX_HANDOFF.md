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

- source candidate: **AUTH 0.2.0 release candidate**
- status: production 아님. `dev -> main -> stable` 승격과 stable production smoke 전까지 release candidate이다.
- production origin: `https://nakwol-auth.sepsd21.workers.dev`
- candidate scope: immutable Web SDK v0.2.0, Compact Identity Menu, `/account`, privileged `/lab`.
- pinned `src/assets/nakwol-auth-web.js.txt` / SDK v0.1.0은 immutable compatibility boundary다.
- OAuth security boundary: Authorization Code + PKCE(S256), state validation, exact redirect allowlist, app-bound access token, restricted CORS.

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
- AUTH deploy workflow evidence with DATA-first wait: `33255315038`.

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

AUTH D1 and DATA D1 are separate. AUTH must not read DATA D1 or invent/mirror DATA scopes. DATA verifies caller identity through AUTH `/me` rather than AUTH D1 access.

## AUTH UX v1 work surface

- branch: `feature/nakwol-auth-ux-v1`
- draft PR: #45
- recovery handoff: `docs/handoffs/2026-08-31-nakwol-auth-ux-v1-resume.md`
- design: `docs/superpowers/specs/2026-08-29-nakwol-auth-ux-v1-design.md`
- plan: `docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1.md`

Implemented candidate boundaries:

- SDK v0.2.0 is a new immutable asset; v0.1.0 remains untouched.
- `mountNakwolIdentityMenu` is the new integration UI; legacy `mountNakwolAuthWidget` remains.
- `/account` uses `nakwol-account-center` app-bound tokens and user-specific successful AUTH evidence for connected services.
- `/lab` uses `nakwol-auth-lab` app-bound tokens and permits diagnostics only for NAKWOL admins or active Connect developer/operator users.
- Lab diagnostics return safe metadata only; never raw token/hash/session cookie/PKCE verifier/client secret.

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
- Formal component release is created only after production smoke succeeds.
- `ops/release.json` is the audited release descriptor and must not be left armed accidentally.
- production workflows must pass `scripts/verify-stable-promotion.mjs`.
- DATA-first production ordering must remain fail-closed.

## Do not do these

- do not edit the pinned v0.1 Web SDK asset;
- do not develop/direct-push on `main` or `stable`;
- do not direct-push or force-push `dev`;
- do not bypass stable promotion or DATA-first gates;
- do not call AUTH 0.2.0 production before stable smoke evidence exists;
- do not expose raw authentication secrets in `/lab` or docs;
- do not merge AUTH and DATA D1 responsibilities;
- do not delete/truncate Registry or user-owned data during reseed;
- do not invent game rules or canonical equipment applicability;
- do not branch from historical feature/ops refs without fresh comparison against `dev`.

## Next after AUTH v0.2 candidate verification

1. Exact-final-head Task 8 review and full CI.
2. PR #45 -> `dev` only after exact head verification.
3. `dev -> main` promotion PR.
4. `main -> stable` promotion PR and production deploy.
5. Production route smoke + Auth Lab V1–V12 matrix.
6. Only then create formal `auth-v0.2.0` release.
7. After production v0.2 is green, execute the separate `siege-calculator` integration plan.
