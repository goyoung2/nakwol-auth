# nakwol-connect

Official agent-first CLI for connecting web projects to NAKWOL AUTH and NAKWOL DATA.

## Fast path

AUTH only:

```bash
npx --yes nakwol-connect init
```

AUTH + shared NAKWOL DATA:

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

The first machine authorization opens a short-lived browser approval once. After that the CLI automatically creates/reuses the AUTH app, configures exact DATA scopes, installs or updates the project marker, writes `.nakwol-connect.json`, and verifies local + AUTH + DATA + OpenAPI state.

No Discord secret, Cloudflare credential, permanent admin key, or CLI token is written into the project.

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

The installed `connect/v1.js` exposes authentication and DATA automatically. Prefer the high-level helpers for the current DATA contract:

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

## Discovery

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
https://nakwol-data.sepsd21.workers.dev/openapi.json
```

Requirements: Node.js 20+, network access to NAKWOL AUTH and DATA. License: MIT.
