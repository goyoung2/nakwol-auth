# NAKWOL AUTH v0.2.0 — Production Evidence / Formal Release Pending

Status: **production deployed; formal `auth-v0.2.0` release pending Auth Lab V1–V12 completion**

AUTH v0.2.0 is deployed to the stable production Worker and has passed automated production smoke. This file is evidence of the deployed candidate, but it is deliberately **not** a formal component release record yet.

## Scope

- Web SDK v0.2.0 as a new immutable pinned asset.
- Existing Web SDK v0.1.0 remains immutable and supported.
- `mountNakwolIdentityMenu` with button/compact/menu variants and inherit/light/dark themes.
- `/account` Account Center with NAKWOL ID, membership and evidence-backed connected services.
- `/lab` Auth Lab with privileged access and safe diagnostics.
- Internal OAuth clients `nakwol-account-center` and `nakwol-auth-lab`.

## Compatibility and security

AUTH v0.2.0 preserves the existing security model:

- Authorization Code + PKCE(S256)
- OAuth state validation
- exact redirect URI allowlists
- app-bound access tokens
- registered-origin CORS restrictions for `/token`, `/me`, `/logout`
- central SSO session isolation

The pinned v0.1 Web SDK remains byte-for-byte unchanged in production. Auth Lab diagnostics never return raw access tokens, token hashes, session cookies, PKCE verifiers or client secrets.

## Verified production deployment

```text
stable SHA: 2ea002dca18cbb064be089167326cd311b315dd5
AUTH deploy workflow ID: 33350989974
Worker Version ID: f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4
combined production smoke workflow ID: 33351486056
```

Deployment workflow `33350989974` completed successfully in this order:

1. stable PR provenance guard;
2. unit tests;
3. typecheck;
4. Worker dry-run bundle;
5. Cloudflare credential validation;
6. existing AUTH D1 resolution;
7. migration 0005 application;
8. required application verification;
9. live DATA 0.9 contract gate;
10. AUTH Worker deployment;
11. production AUTH/Connect verification.

The DATA-first gate completed before Worker mutation.

## Production smoke evidence

A temporary no-merge PR based directly on deployed stable was used to validate the live system from a GitHub runner. The combined smoke definition was then selected as the permanent workflow candidate.

Combined smoke run `33351486056` completed successfully.

D1 verification was read-only and confirmed the platform schema plus these application registrations:

- `nakwol-connect-admin`
- `nakwol-connect-cli`
- `siege-calculator`
- `nakwol-account-center`
- `nakwol-auth-lab`

Live production surface results on the first attempt:

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

Additional assertions passed:

- health reports service `nakwol-auth`, version `0.2.0`;
- SDK manifest reports stable `0.2.0` and module `/sdk/v0.2.0/nakwol-auth-web.js`;
- production v0.1 SDK is byte-equal to the pinned repository v0.1 asset;
- production v0.2 SDK and stable alias are byte-equal to the repository v0.2 asset;
- v0.2 contains `mountNakwolIdentityMenu`;
- Account Center and Auth Lab expected client/page markers exist;
- unauthenticated APIs fail closed with `ACCOUNT_AUTH_REQUIRED` / `LAB_AUTH_REQUIRED`;
- Connect manifest reports `nakwol-connect` version `0.4.0`;
- production Connect package executes and reports `NAKWOL Connect CLI v0.4`;
- DATA OpenAPI remains 3.1.0 / DATA 0.9.0.

Smoke markers:

```text
NAKWOL_PLATFORM_D1_SMOKE_OK
NAKWOL_PLATFORM_PRODUCTION_SURFACES_OK
NAKWOL_CONNECT_V04_PACKAGE_OK
```

## Auth Lab V1–V12 matrix — still required

Do not infer PASS from source tests for scenarios that require a real identity, browser or SSO session.

- **V1 신규 사용자 로그인** — pending live browser/Discord verification.
- **V2 기존 SSO 사용자** — pending live multi-app SSO verification.
- **V3 Local logout** — pending live app-token vs central-session verification.
- **V4 Global logout** — pending live central-session termination verification.
- **V5 Token expiry** — automated fail-closed behavior exists; official live/UI matrix still pending.
- **V6 Invalid redirect URI** — automated fail-closed regression covered; may be additionally live-probed.
- **V7 Invalid state / PKCE** — automated regression covered; official live-session matrix remains to be recorded.
- **V8 Membership/role change** — pending real identity/policy refresh verification.
- **V9 Multi-app SSO isolation** — pending live two-app verification.
- **V10 DATA scope enforcement** — automated DATA scope tests exist; official live user-scope matrix remains to be recorded.
- **V11 UI recovery** — automated UI/error contracts exist; browser experience verification pending.
- **V12 Responsive/accessibility** — pending desktop/mobile/keyboard verification.

Important membership behavior: the system does not persist a Discord bearer token for background polling. `/me` reflects the latest stored verified membership; a new full Discord OAuth callback refreshes membership/role state.

## Formal release condition

Only after all of the following are green:

1. deployed stable SHA verified;
2. AUTH and DATA CI green;
3. production platform smoke green;
4. Auth Lab V1–V12 matrix recorded green;
5. v0.1 pinned asset unchanged;
6. OAuth/CORS security regression guards green;

create `release/auth-v0.2.0` from the exact verified stable production commit, point `ops/release.json.target_sha` at that exact release target, and create the formal `auth-v0.2.0` release through the release-PR provenance guard.
