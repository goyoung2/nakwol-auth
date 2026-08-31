# NAKWOL AUTH v0.2.0 — Release Candidate Evidence

Status: **release candidate verified; formal `auth-v0.2.0` tag/Release pending final stable promotion, production deployment verification, and release-PR provenance gate**

This record supersedes the release-readiness status in `docs/handoffs/2026-08-31-nakwol-auth-ux-v1-resume.md`. That handoff remains historical recovery context; the verification and release state below is authoritative for AUTH v0.2.0.

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

## Automated release-candidate verification

V8-A was added through PR #61 and merged to `dev` as `7c3d207f9d31b2171e6d8dcf90b10877263c7b8f`.

The GREEN verification head passed:

- 71/71 AUTH tests
- TypeScript typecheck
- Worker dry-run bundle
- Connect static checks
- Repository Governance quality gate including AUTH/Connect and DATA

V8-A exercises the same `refreshDiscordMembership()` orchestration used by the production Discord OAuth callback and proves:

```text
Discord roles: member -> user -> member
persisted membership: active member -> inactive user -> active member
member-policy access: allow -> deny -> allow
```

No AUTH schema/migration, DATA schema/migration, SDK contract, deployment flag, or production data mutation was introduced by the V8-A change.

## Auth Lab V1–V12 release matrix

The release matrix was completed on 2026-08-31. Scenarios that require a real browser/identity were verified manually; server-only negative paths retain automated coverage where noted.

| Check | Result | Release evidence / nuance |
| --- | --- | --- |
| V1 New-user login | PASS | Live browser + Discord OAuth flow verified. |
| V2 Existing SSO user | PASS | Existing central SSO session reused as expected. |
| V3 Local logout | PASS | App-local token/session behavior remains isolated from central SSO. |
| V4 Global logout | PASS | Global logout revokes all app-bound tokens for the user and terminates central-session reuse. |
| V5 Token expiry | PASS* | Client-side expiry/recovery behavior was verified by forcing the Lab session expiry state. This is not a literal one-hour wall-clock wait and must not be represented as one. |
| V6 Invalid redirect URI | PASS | Fail-closed redirect allowlist regression covered and verified. |
| V7 Invalid state / PKCE | PASS* | Live browser evidence covers callback/state mismatch; PKCE verifier mismatch is covered by automated/server-side regression. |
| V8 Membership/role change | PASS WITH WAIVER | V8-A automated end-to-end refresh/persistence/policy path is green. V8-B live Discord role mutation is deferred because a controlled guild role mutation requires external server-admin/test-account authority. Release waiver approved 2026-08-31. |
| V9 Multi-app SSO isolation | PASS | Live multi-app behavior verified. |
| V10 DATA scope enforcement | PASS | Production browser proof: AUTH `/me` = 200, DATA `/v1/me` = 200, DATA `/v1/registry/generals` = 403 `SCOPE_DENIED` for Lab without `roster:read`. |
| V11 UI recovery | PASS | DevTools Offline induced network failure without white-screen/permanent breakage; returning online allowed normal recovery. |
| V12 Responsive/accessibility | PASS | Desktop/mobile responsive behavior plus keyboard navigation, Escape handling, focus return and Account Center interaction verified. |

### V8-B release waiver

V8-B is not waived because the code path is untested. The fresh Discord membership refresh path is automated and drives the same persisted membership and existing application access policy used by production.

The deferred item is specifically a real Discord guild mutation (`member role removed -> OAuth refresh -> role restored -> OAuth refresh`) requiring controlled role-management authority. The live mutation should be executed later when a test account or server-admin assistance is available; its absence does not block AUTH v0.2.0.

## Production integration evidence before final promotion

The DATA-to-AUTH Service Binding production hotfix is deployed and was verified with a newly authenticated Lab token:

```text
AUTH /me
200

DATA /v1/me
200

DATA /v1/registry/generals
403 SCOPE_DENIED
```

This is the intended boundary: DATA accepts the valid AUTH principal, `/v1/me` needs no DATA scope, and registry access remains denied when `roster:read` is absent.

The production DATA deployment at stable `87199e9adaf8513097a7cac76fb7a1235ea82272` completed with no migrations to apply. The existing idempotent Registry seed workflow ran and registry counts remained validated. The fix itself did not change migration/schema/registry seed code.

## Existing production smoke baseline

The combined production smoke verifies AUTH 0.2, Connect 0.4 and DATA 0.9 surfaces together. Prior successful smoke evidence includes:

```text
/api/health                                      200
/sdk/manifest.json                               200
/sdk/v0.1.0/nakwol-auth-web.js                   200
/sdk/v0.2.0/nakwol-auth-web.js                   200
/sdk/nakwol-auth-web.js                          200
/account                                         200
/lab                                             200
/account/api/summary without auth                401
/lab/api/diagnostics without auth                401
/admin/apps                                      200
/admin/developers                                200
/connect/cli/manifest.json                       200
/connect/cli/package.tgz                         200
/connect/cli/device/verify                       200
/llms.txt                                        200
DATA /openapi.json                               200
```

Assertions include immutable v0.1 SDK parity, v0.2/stable SDK parity, Account/Lab fail-closed unauthenticated APIs, Connect 0.4 package execution, and DATA 0.9 OpenAPI contract.

## Non-blocking follow-up UX

The following is intentionally deferred beyond AUTH v0.2.0:

**Account Center -> service open seamless SSO handoff.**

A newly opened destination tab has no app-specific `sessionStorage` token by design. A future consumer integration can detect the missing destination token, automatically begin destination-app PKCE SSO, reuse the existing central AUTH session, and return immediately. This improves ergonomics without changing the current security boundary and is not a v0.2.0 release blocker.

## Final release procedure

The formal release must follow this order:

1. promote the V8-A helper/test and this release evidence from `dev -> main` with fresh AUTH/DATA/governance checks;
2. promote `main -> stable` with fresh checks and exact diff review;
3. allow the stable `src/**` change to trigger the fail-closed AUTH production deployment;
4. verify deployment success, DATA-first gate, production smoke, and a short authenticated sanity check;
5. record the final deployment evidence if needed without changing AUTH runtime;
6. select the final verified stable commit SHA as the immutable release target;
7. create `release/auth-v0.2.0` from that verified stable state;
8. change only `ops/release.json` to an enabled AUTH 0.2.0 descriptor pointing `target_sha` at the verified stable target and `notes_file` at this file;
9. merge that release PR only after its fresh gates pass;
10. require the component-release workflow to create and verify `auth-v0.2.0`.

`target_sha` must be the final verified **stable** commit, not a `dev` or `main` SHA, because promotion uses squash merges.

## Formal release gate

AUTH v0.2.0 is eligible for formal release when all of the following remain green at the final stable target:

- AUTH and DATA verification suites;
- repository governance quality gate;
- stable promotion provenance;
- production AUTH deployment and DATA-first contract gate;
- combined production smoke;
- Auth Lab V1–V12 matrix above, including the approved V8-B waiver;
- immutable v0.1 SDK guard;
- OAuth/PKCE/state/CORS/logout regression guards;
- no pre-existing `auth-v0.2.0` tag or GitHub Release.
