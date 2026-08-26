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
npx --yes nakwol-connect doctor --json
```

The first machine authorization opens a short-lived browser approval once. After that the CLI automatically creates/reuses the AUTH app, configures exact DATA scopes, installs or updates the project marker, writes `.nakwol-connect.json`, and verifies local + AUTH + DATA state.

No Discord secret, Cloudflare credential, permanent admin key, or CLI token is written into the project.

## DATA commands

```text
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

The installed `connect/v1.js` exposes authentication and DATA automatically:

```js
const { data } = window.NAKWOL_CONNECT;
const generals = await data.registry.generals();
const tactics = await data.registry.tactics();
```

Bearer tokens and `X-NAKWOL-CLIENT-ID` are injected by the runtime. The embedded scope list is informational; the DATA Worker remains authoritative.

## Commands

```text
init                 detect → AUTH app → DATA scopes → install → verify
doctor               validate local, AUTH and DATA desired state
status               show local/AUTH/DATA state
add-url <URL>        add Redirect URI
sync                 re-apply desired AUTH/DATA/local state
data ...             manage DATA scopes
remove               remove local integration/config; central state preserved
```

## Discovery

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
```

Requirements: Node.js 20+, network access to NAKWOL AUTH and DATA. License: MIT.
