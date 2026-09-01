# NAKWOL AUTH v0.2.0 — Formal Release Record

Status: **released**

- formal tag / GitHub Release: `auth-v0.2.0`
- published: 2026-08-31
- exact immutable release target: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- final AUTH deploy workflow: `33373705515` — success
- final Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- final production smoke workflow: `33373908231` — success
- formal component-release workflow: `33374685878` — success
- release PR: `#67`
- post-release descriptor disarm PR: `#68`
- post-release stable -> main back-propagation: `#69`
- post-release main -> dev back-propagation: `#70`

This record supersedes the release-readiness status in `docs/handoffs/2026-08-31-nakwol-auth-ux-v1-resume.md` and the pre-release wording previously stored in this file. Those records remain historical implementation context.

## Scope

- Web SDK v0.2.0 as a new immutable pinned asset.
- Existing Web SDK v0.1.0 remains immutable and supported.
- `mountNakwolIdentityMenu` with button/compact/menu variants and inherit/light/dark themes.
- `/account` Account Center with NAKWOL ID, membership and evidence-backed connected services.
- `/lab` Auth Lab with privileged access and safe diagnostics.
- Internal OAuth clients `nakwol-account-center` and `nakwol-auth-lab`.
- Global logout revokes all app-bound access tokens for the central-session user while local logout remains app-local.
- DATA-to-AUTH production verification uses Cloudflare Service Binding `AUTH_SERVICE -> nakwol-auth`.

## Compatibility and security

AUTH v0.2.0 preserves the existing security model:

- Authorization Code + PKCE (S256)
- OAuth state validation
- exact redirect URI allowlists
- app-bound access tokens
- registered-origin CORS restrictions for `/token`, `/me`, `/logout`
- central SSO session isolation
- AUTH D1 and DATA D1 remain separate
- AUTH does not read DATA D1 or invent/mirror DATA scopes

The pinned v0.1 Web SDK remains immutable. Auth Lab diagnostics never return raw access tokens, token hashes, session cookies, PKCE verifiers or client secrets.

## Historical initial AUTH v0.2 production baseline

The first AUTH v0.2 UX candidate deployment remains preserved as historical evidence:

```text
stable SHA: 2ea002dca18cbb064be089167326cd311b315dd5
AUTH deploy workflow: 33350989974
Worker Version ID: f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4
combined production smoke workflow: 33351486056
```

That deployment completed stable promotion provenance, root verification, D1 migration/required-app checks, the DATA-first live DATA 0.9 contract gate, AUTH Worker deployment, and production AUTH/Connect checks. Later verified fixes and final release evidence superseded it as the release target but do not erase the baseline.

## Final release-candidate verification

V8-A was added through PR #61 and merged to `dev` as `7c3d207f9d31b2171e6d8dcf90b10877263c7b8f`.

The final stable promotion/deploy path verified:

- 71/71 AUTH tests
- TypeScript typecheck
- Worker dry-run bundle
- Connect static checks
- Repository Governance quality gate including AUTH/Connect and DATA
- stable promotion provenance
- live DATA 0.9 / schema 3 / OpenAPI 3.1 gate before AUTH Worker mutation
- production AUTH/Connect verification

V8-A exercises the same `refreshDiscordMembership()` orchestration used by the production Discord OAuth callback and proves:

```text
Discord roles: member -> user -> member
persisted membership: active member -> inactive user -> active member
member-policy access: allow -> deny -> allow
```

No AUTH schema/migration, DATA schema/migration, SDK contract, or production data mutation was introduced by the V8-A change.

## Auth Lab V1–V12 release matrix

The release matrix was completed on 2026-08-31. Scenarios that require a real browser/identity were verified manually; server-only negative paths retain automated coverage where noted.

| Check | Result | Release evidence / nuance |
| --- | --- | --- |
| V1 New-user login | PASS | Live browser + Discord OAuth flow verified. |
| V2 Existing SSO user | PASS | Existing central SSO session reused as expected. |
| V3 Local logout | PASS | App-local token/session behavior remains isolated from central SSO. |
| V4 Global logout | PASS | Global logout revokes all app-bound tokens for the user and terminates central-session reuse. |
| V5 Token expiry | PASS* | Client-side expiry/recovery behavior was verified by forcing the Lab session expiry state. This is not a literal one-hour wall-clock wait. |
| V6 Invalid redirect URI | PASS | Fail-closed redirect allowlist regression covered and verified. |
| V7 Invalid state / PKCE | PASS* | Live browser evidence covers callback/state mismatch; PKCE verifier mismatch is covered by automated/server-side regression. |
| V8 Membership/role change | PASS WITH WAIVER | V8-A automated end-to-end refresh/persistence/policy path is green. V8-B live Discord role mutation is deferred because a controlled guild role mutation requires external server-admin/test-account authority. Release waiver approved 2026-08-31. |
| V9 Multi-app SSO isolation | PASS | Live multi-app behavior verified. |
| V10 DATA scope enforcement | PASS | Production browser proof: AUTH `/me` = 200, DATA `/v1/me` = 200, DATA `/v1/registry/generals` = 403 `SCOPE_DENIED` for Lab without `roster:read`. |
| V11 UI recovery | PASS | DevTools Offline induced network failure without white-screen/permanent breakage; returning online allowed normal recovery. |
| V12 Responsive/accessibility | PASS | Desktop/mobile responsive behavior plus keyboard navigation, Escape handling, focus return and Account Center interaction verified. |

### V8-B release waiver

V8-B is not waived because the code path is untested. The fresh Discord membership refresh path is automated and drives the same persisted membership and existing application access policy used by production.

The deferred item is specifically a real Discord guild mutation (`member role removed -> OAuth refresh -> role restored -> OAuth refresh`) requiring controlled role-management authority. It may be executed later when a controlled test account or server-admin assistance is available; its absence did not block AUTH v0.2.0.

## Production integration evidence

The DATA-to-AUTH Service Binding production hotfix is deployed and was verified with an authenticated Lab token:

```text
AUTH /me
200

DATA /v1/me
200

DATA /v1/registry/generals
403 SCOPE_DENIED
```

This is the intended boundary: DATA accepts the valid AUTH principal, `/v1/me` needs no DATA scope, and registry access remains denied when `roster:read` is absent.

## Final production deployment

PR #65 promoted the final verified candidate to stable commit:

```text
154baf448ee45a7b2bcf6e320f09a65866e1f8af
```

Deploy workflow `33373705515` completed successfully. The deployment log confirms:

- stable promotion guard: `NAKWOL_STABLE_PROMOTION_OK:main->stable:#65`
- AUTH tests: 71/71 PASS
- typecheck: PASS
- Wrangler dry-run: PASS
- remote D1 migrations: no migrations to apply
- live DATA gate: `NAKWOL_DATA_V09_READY_FOR_AUTH_DEPLOY`
- Worker deployment: success
- Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- Connect v0.4 deployment verification: `NAKWOL_CONNECT_V04_DEPLOY_OK`

The no-merge production smoke PR #66 then produced workflow `33373908231` — success.

## Formal component release

PR #67 created the formal component release from the exact production-deployed and production-smoked stable target `154baf448ee45a7b2bcf6e320f09a65866e1f8af`.

The first armed descriptor attempt correctly exposed a stale DATA-only governance assertion. After generalizing that regression to the component-neutral descriptor contract, the exact release head passed:

- Verify NAKWOL AUTH `33374520124` — success
- Repository Governance `33374520113` — success, including AUTH/Connect + DATA quality gate

After PR #67 merged, `Create Component Release` workflow `33374685878` completed successfully and published `auth-v0.2.0`.

PR #68 immediately restored `ops/release.json` to the disabled neutral state. The disarm push also ran the component-release workflow in its disabled path without modifying the existing tag/Release or production runtime.

## Post-release repository reconciliation

The release-control maintenance was then back-propagated:

```text
stable -> main  PR #69
main   -> dev   PR #70
```

Current long-lived branch heads after that reconciliation:

- `stable`: `5fa4a0365462519089ddeae1d49ff2de3c5d4452`
- `main`: `598c05f371f328494c565a7f7d463ef09271320f`
- `dev`: `4c4337a2ef8146b34f579d12773bf43c33464401`

All three currently resolve to tree SHA:

```text
444fd9a5ec963d5970d560de90e3782314881fe7
```

Their commit ancestry differs because of squash/promotion history, but their repository contents are synchronized.

## Non-blocking follow-up UX

The next product-level AUTH integration follow-up is intentionally outside v0.2.0:

**Account Center / consumer app -> seamless SSO handoff.**

A newly opened destination tab has no app-specific `sessionStorage` token by design. A consumer integration can detect the missing destination token, automatically begin destination-app PKCE SSO, reuse the existing central AUTH session, and return immediately. The first concrete consumer follow-up is the `siege-calculator` Identity Menu / seamless SSO integration.

## Release state

AUTH v0.2.0 has no remaining formal release blocker.

The following are completed release evidence, not future steps:

- AUTH and DATA verification suites
- repository governance quality gate
- stable promotion provenance
- production AUTH deployment and DATA-first contract gate
- final production smoke
- Auth Lab V1–V12 matrix including approved V8-B waiver
- immutable v0.1 SDK guard
- OAuth/PKCE/state/CORS/logout regression guards
- `auth-v0.2.0` tag and GitHub Release creation
- release descriptor disarm
- stable -> main -> dev post-release back-propagation
