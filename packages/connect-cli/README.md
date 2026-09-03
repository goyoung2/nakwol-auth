# nakwol-connect

Official agent-first CLI for connecting web projects to NAKWOL AUTH and NAKWOL DATA.

## Fast path

NAKWOL Connect is protected by default. A plain install requires NAKWOL login, and newly created apps use the `member` access policy unless another policy is explicitly requested.

AUTH only, protected by default:

```bash
npx --yes nakwol-connect init
```

Explicitly allow a page to remain visible without login:

```bash
npx --yes nakwol-connect init --auth optional
```

AUTH + shared NAKWOL DATA:

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

The first machine authorization opens a short-lived browser approval once. After that the CLI automatically creates/reuses the AUTH app, configures exact DATA scopes, installs or updates the project marker, writes `.nakwol-connect.json`, and verifies local + AUTH + DATA + OpenAPI state.

No Discord secret, Cloudflare credential, permanent admin key, or CLI token is written into the project.

## Authentication mode vs access policy

These are separate controls:

```text
auth=required   page is locked until authentication succeeds (default)
auth=optional   page is public; login is available for identity/personalization

access-policy=member   authenticated NAKWOL members only (default for new apps)
access-policy=public   any authenticated NAKWOL user
access-policy=admin    NAKWOL admins only
```

Examples:

```bash
# Default private NAKWOL member service
npx --yes nakwol-connect init

# Public page with optional login
npx --yes nakwol-connect init --auth optional --access-policy public
```

At runtime the Universal Embed uses `data-auth="required"` or `data-auth="optional"`. If the attribute is omitted, `required` is assumed.

## DATA discovery and commands

`data describe` reads the live public OpenAPI 3.1 document without a CLI session. Coding agents should use it instead of inventing endpoint paths.

```text
nakwol-connect data describe --json
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

Available DATA scopes:

```text
profile:read profile:write
roster:read roster:write
equipment:read equipment:write
decks:read decks:write
```

## Browser runtime

The installed `connect/v1.js` exposes authentication and DATA automatically. With the default required mode it places a full-page authentication guard over the app immediately, attempts central SSO, and redirects to NAKWOL/Discord login when no reusable NAKWOL session exists. The app is revealed only after the current service receives its own valid access token. Access denial leaves the guard in place.

Prefer the high-level helpers for the current DATA contract:

```js
const { data } = window.NAKWOL_CONNECT;
const openapi = await data.describe();
const accounts = await data.accounts.list();
const generals = await data.roster.generals.list(accountId);
const decks = await data.decks.list(accountId);
const deck = await data.decks.get(accountId, deckId);
```

Available high-level namespaces:

```text
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

Writes use the same server contract:

```js
await data.roster.tactics.upsert(accountId, tacticId, {
  breakthrough: 5,
  favorite: true,
});

await data.decks.replaceComposition(accountId, deckId, composition);
```

All user-owned path IDs are URL-encoded. JSON helpers set `Content-Type: application/json`. The helpers return the existing `{ ok, data }` DATA envelope and preserve `NakwolDataError.code`, `.status`, and `.payload`. Unsupported game-account update/delete methods are intentionally absent because the server does not expose those operations.

Low-level access remains available for current or future operations not yet wrapped:

```js
const custom = await data.request('/v1/game-accounts');
```

Bearer tokens and `X-NAKWOL-CLIENT-ID` are injected by the runtime for protected DATA calls. `data.describe()` / `data.openapi()` are public discovery calls and work before user login. The embedded scope list is informational; `data.hasScope()` is only a UX hint and the DATA Worker remains authoritative.

The browser guard controls page UX, but static HTML/JS files on a public host are still retrievable directly. Sensitive member data must continue to be served by AUTH/DATA-protected APIs rather than embedded as secrets in the static bundle.

## Commands

```text
init                 detect → AUTH app → DATA scopes → install → verify
doctor               validate local, AUTH, DATA and OpenAPI desired state
status               show local/AUTH/DATA state
add-url <URL>        add Redirect URI
sync                 re-apply desired AUTH/DATA/local state
data describe        read live DATA OpenAPI without device authorization
data ...             manage DATA scopes
remove               remove local integration/config; central state preserved
```

Useful options:

```text
--auth <required|optional>       default: required
--access-policy <public|member|admin>  default for new apps: member
```

## Discovery

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
https://nakwol-data.sepsd21.workers.dev/openapi.json
```

Requirements: Node.js 20+, network access to NAKWOL AUTH and DATA. License: MIT.
