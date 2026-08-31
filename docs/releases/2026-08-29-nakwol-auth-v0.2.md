# NAKWOL AUTH v0.2.0 — Release Candidate Notes

Status: **release candidate until stable production smoke succeeds**

This file describes the AUTH v0.2.0 candidate contract. It is not proof that production has been upgraded and it is not permission to create the `auth-v0.2.0` tag early.

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

The pinned v0.1 Web SDK must remain byte-for-byte unchanged. Auth Lab diagnostics never return raw access tokens, token hashes, session cookies, PKCE verifiers or client secrets.

## Promotion boundary

Candidate source flows only through:

```text
feature -> dev -> main -> stable
```

Do not create the formal component release until the stable deployment and production smoke are complete. DATA-first deployment ordering is a stop condition: AUTH production mutation must not proceed unless the required live DATA v0.9 contract is green.

## Evidence to record after stable deployment

After `main -> stable` has merged and production workflows complete, record the real values below. Do not pre-fill them from guesses or earlier candidates.

```text
git rev-parse stable: <record exact deployed SHA>
AUTH deploy workflow ID: <record>
Worker Version ID: <record>
/api/health response: <record version 0.2.0>
/sdk/manifest.json response: <record stable/module v0.2.0>
/sdk/v0.1.0/nakwol-auth-web.js: <record HTTP result>
/sdk/v0.2.0/nakwol-auth-web.js: <record HTTP result>
/sdk/nakwol-auth-web.js: <record HTTP result>
/account: <record HTTP result>
/lab: <record HTTP result>
```

## Auth Lab verification matrix

Run and record the design-spec scenarios **V1–V12** against the deployed stable Worker. Record each result as PASS/FAIL with the tested identity/role boundary and no raw secret capture.

Important membership behavior: the system does not persist a Discord bearer token for background polling. `/me` reflects the latest stored verified membership; a new full Discord OAuth callback refreshes membership/role state.

## Formal release condition

Only after all of the following are green:

1. exact stable SHA verification;
2. AUTH and DATA CI on the promoted commit;
3. production health/SDK/account/lab smoke;
4. Auth Lab V1–V12 matrix;
5. no v0.1 pinned asset change;
6. no OAuth/CORS security regression;

create `release/auth-v0.2.0` from the verified `stable` commit, point `ops/release.json.target_sha` at the exact deployed SHA, and create the formal `auth-v0.2.0` release through the release-PR provenance guard.
