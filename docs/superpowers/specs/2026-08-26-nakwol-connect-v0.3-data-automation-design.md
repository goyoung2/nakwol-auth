# NAKWOL Connect v0.3 DATA Automation Design

## Status

Approved architectural increment for NAKWOL Connect. This document defines the control-plane and browser-runtime integration needed so coding agents can attach NAKWOL AUTH and NAKWOL DATA to a project without manual database edits or secret sharing.

## Goal

A developer or coding agent should be able to run:

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect doctor --json
```

and finish with all of the following true:

1. The project has a NAKWOL AUTH application.
2. The authenticated CLI developer owns or may manage that application.
3. The same application is registered in NAKWOL DATA.
4. The requested DATA scopes exactly match central DATA configuration.
5. The local project contains an idempotent NAKWOL Connect embed carrying client ID, DATA origin and expected DATA scopes.
6. Browser code can call `window.NAKWOL_CONNECT.data` without manually constructing Bearer or `X-NAKWOL-CLIENT-ID` headers.
7. `doctor --json` verifies local integration, AUTH application state and DATA scope state.

## Non-goals

- No new Cloudflare token, Discord secret, permanent admin token or app client secret is distributed to developers.
- No direct access from AUTH Worker to the DATA D1 or from DATA Worker to the AUTH D1.
- No user-level OAuth consent screen is introduced in v0.3. DATA scopes are application capabilities controlled by authorized NAKWOL developers/operators; DATA requests still require a valid per-user AUTH access token.
- No roster/deck mutation API is added here. This release automates access to the DATA APIs that already exist and prepares later user-data APIs.

## Trust model

### Existing identities

NAKWOL Connect CLI already obtains a revocable CLI token through device authorization. That token has `connect:apps` scope and resolves to a Connect principal with a NAKWOL user ID plus operator/developer ownership rules.

### DATA control-plane authorization

NAKWOL DATA adds CLI-only management endpoints under:

```text
/connect/cli/apps/:clientId/scopes
```

The DATA Worker does not validate Connect CLI tokens itself. Instead it forwards the same Bearer token to the existing AUTH endpoint:

```text
GET {AUTH_ORIGIN}/connect/cli/apps/:clientId
Authorization: Bearer <connect-cli-token>
```

AUTH returns the application only when the CLI token is valid, has `connect:apps`, and the principal is an operator or owns the application. DATA treats HTTP 200 plus a matching `client_id` as proof that the caller may manage DATA settings for that application.

This reuses the existing control-plane authorization and adds no new secret.

## DATA management API

### GET `/connect/cli/apps/:clientId/scopes`

After AUTH ownership verification, return:

```json
{
  "ok": true,
  "data": {
    "client_id": "deck-lab",
    "registered": true,
    "status": "active",
    "scopes": ["decks:read", "roster:read"],
    "available_scopes": [
      "profile:read", "profile:write",
      "roster:read", "roster:write",
      "equipment:read", "equipment:write",
      "decks:read", "decks:write"
    ]
  }
}
```

If AUTH authorizes the caller but the application has not yet been configured in DATA, return `registered: false`, `scopes: []` rather than 404.

### PUT `/connect/cli/apps/:clientId/scopes`

Input:

```json
{
  "scopes": ["roster:read", "decks:read"]
}
```

Rules:

- Every scope must exist in the server-side `DATA_SCOPES` list.
- Duplicates are removed and ordering is canonicalized.
- DATA upserts `data_applications` for the AUTH application.
- Existing scope rows for that app are replaced exactly by the requested set.
- `PUT` with an empty scope array intentionally clears all DATA capabilities while preserving application registration.
- The operation never touches user-owned roster/equipment/deck rows.
- The response is the same shape as GET.

DATA mirrors the AUTH application's current `active`/`disabled` status when scope configuration is written. Runtime requests still independently call AUTH `/me`, so a disabled AUTH app cannot bypass AUTH policy even if stale DATA scope rows exist.

## CLI v0.3

### Version

Public npm package becomes:

```text
nakwol-connect@0.3.0
```

Worker fallback distribution must expose the same version.

### New option

```text
--scopes <comma-separated DATA scopes>
--data-origin <URL>
```

Default DATA origin:

```text
https://nakwol-data.sepsd21.workers.dev
```

`init --scopes roster:read,decks:read` performs, in order:

1. Detect project.
2. Acquire/reuse Connect CLI session.
3. Create or reuse AUTH app.
4. Resolve redirects.
5. PUT exact DATA scopes to DATA Worker using the same CLI token.
6. Install/update local embed with client ID, DATA origin and scopes.
7. Write project config version 2.
8. Run online doctor checks against AUTH and DATA.
9. Fail the command if any required check fails.

If `--scopes` is omitted:

- Existing project config scopes are preserved.
- A new project defaults to `[]` and is still registered in DATA so later scope changes are deterministic.

### New `data` command

Supported operations:

```bash
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

All commands update central DATA configuration and local `.nakwol-connect.json`. `set/add/remove` also refresh the local embed so config, source marker and central state stay aligned.

### `sync`

`sync` treats `.nakwol-connect.json` as the desired project state and re-applies:

- AUTH redirect configuration already supported by current behavior.
- DATA scopes.
- local embed attributes.

An explicit `--scopes` on `sync` replaces the configured desired scopes before synchronization.

### `doctor`

Local checks:

- config exists
- supported framework detected
- Connect marker exists
- marker client ID matches config
- marker DATA origin matches config
- marker DATA scopes match config

Online checks when a CLI session is present:

- AUTH app exists and caller may manage it
- redirects are registered
- DATA app is registered
- DATA scopes exactly match config
- requested scopes are valid according to DATA's returned `available_scopes`

`doctor --json` remains machine-readable and returns `ok: false` when any required check fails.

### Project config v2

`.nakwol-connect.json` becomes:

```json
{
  "version": 2,
  "clientId": "deck-lab",
  "framework": "vite",
  "redirectUris": ["https://deck-lab.pages.dev/"],
  "integration": "universal-embed",
  "dataOrigin": "https://nakwol-data.sepsd21.workers.dev",
  "dataScopes": ["decks:read", "roster:read"]
}
```

Reading version 1 config remains supported. It is interpreted as `dataScopes: []` and upgraded to version 2 on the next write.

## Browser runtime

The existing `connect/v1.js` remains the one script installed into applications. This is a backward-compatible v1 extension rather than a new required script.

CLI-generated embed example:

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="deck-lab"
  data-data-origin="https://nakwol-data.sepsd21.workers.dev"
  data-data-scopes="decks:read,roster:read">
</script>
```

The embed continues creating `window.NAKWOL_CONNECT` and `window.NAKWOL_AUTH`, and additionally exposes:

```text
window.NAKWOL_CONNECT.data
window.NAKWOL_DATA
```

### DATA client contract

```js
const data = window.NAKWOL_CONNECT.data;

data.origin;
data.scopes;
data.hasScope('roster:read');

await data.registry.summary();
await data.registry.generals();
await data.registry.generals({ includeHidden: true });
await data.registry.tactics();
await data.registry.equipment();
await data.registry.stats();
await data.registry.formations();
await data.registry.warbooks();
```

The client also exposes:

```js
await data.request('/v1/...', options);
await data.fetch('/v1/...', options);
```

For every request, it obtains the current app access token from the existing `NakwolAuthClient` and injects:

```text
Authorization: Bearer <app access token>
X-NAKWOL-CLIENT-ID: <client id>
```

If no valid app access token exists, the DATA client throws a structured `NAKWOL_DATA_UNAUTHENTICATED` error before making a request.

For a non-2xx JSON response, `request()` throws an error carrying `code`, `status` and the parsed payload. `fetch()` returns the raw Response for advanced consumers.

The scope list embedded in the page is informational and used for developer ergonomics only. It is not a security boundary. The DATA Worker remains authoritative.

## LLM/agent experience

`/llms.txt`, the CLI manifest and package README explicitly teach coding agents:

```text
For AUTH only:
  npx --yes nakwol-connect init

For NAKWOL DATA:
  npx --yes nakwol-connect init --scopes roster:read,decks:read

Always verify:
  npx --yes nakwol-connect doctor --json
```

Agents are instructed not to hand-code OAuth, Bearer header plumbing, DATA scope database writes, or secrets.

## Compatibility

- Existing v0.2.x projects continue to load `connect/v1.js` and authenticate normally.
- Existing `.nakwol-connect.json` version 1 files remain readable.
- Existing applications without DATA registration receive no DATA capabilities; existing auth behavior is unchanged.
- Adding `window.NAKWOL_CONNECT.data` is backward compatible.
- Existing DATA application scopes remain valid and can be adopted by v0.3 `doctor`/`sync` once the project config declares them.

## Versioning and deployment

- `nakwol-connect`: `0.3.0`
- NAKWOL DATA service: `0.3.0`
- DATA schema remains `2`; no new D1 tables are required.
- AUTH schema remains unchanged unless implementation discovers a verified need; the approved design does not require a migration.

Deployment order after verified merge:

1. Deploy NAKWOL DATA v0.3 control-plane endpoint.
2. Deploy AUTH/Connect v0.3 embed and CLI fallback package.
3. Publish `nakwol-connect@0.3.0` through existing npm Trusted Publishing OIDC workflow.
4. Run an actual CLI integration smoke against an isolated test project using DATA scopes.
5. Verify `doctor --json` reports local, AUTH and DATA checks green.

## Security invariants

- No permanent new secret is introduced.
- Browser apps never receive Connect CLI tokens.
- CLI tokens remain stored only in the existing CLI session path.
- DATA management endpoints always prove AUTH app-management permission before reading or changing app DATA scopes.
- Runtime DATA reads/writes still require an app-bound, unexpired user access token validated through AUTH `/me`.
- DATA scope configuration never grants access to a different app's token or another user's token.
- No control-plane endpoint exposes raw CLI tokens or AUTH secrets in logs or responses.

## Test requirements

### DATA Worker

- rejects missing/invalid CLI token control requests
- preserves AUTH rejection status
- permits operator/owner-authorized app scope reads/writes
- validates exact DATA scopes
- PUT is idempotent
- empty PUT clears scopes only
- user-owned rows are untouched

### Connect CLI

- v1 config upgrade
- scope parsing/canonicalization
- init configures AUTH then DATA before local edits
- init failure in DATA leaves local integration unmodified
- sync re-applies desired DATA scopes
- data set/add/remove/status behavior
- doctor compares local marker, AUTH and DATA states
- framework integrations remain idempotent

### Browser embed

- old auth-only initialization still works
- DATA client injects app access token and client ID
- DATA methods map to exact v0.2/v0.3 endpoints
- missing auth token fails before fetch
- API errors preserve code/status

### Distribution

- package version, Worker fallback version and npm version stay aligned
- `llms.txt` includes DATA-first agent instructions
- public npm post-publish execution still works
