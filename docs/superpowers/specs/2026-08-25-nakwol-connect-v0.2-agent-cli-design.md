# NAKWOL Connect v0.2 — Agent-first CLI design

Date: 2026-08-25

## Goal

Make NAKWOL Connect installable and manageable by coding agents/LLMs with one command, so a human can say only:

> 이 프로젝트에 NAKWOL Connect 붙여줘.

The coding agent should run the official CLI, let the CLI register or reuse the app in the central NAKWOL Connect control plane, modify the local project, and verify the integration without asking the user which file to edit.

## Existing foundation

NAKWOL AUTH already provides:

- Cloudflare Worker: `nakwol-auth`
- D1-backed applications and membership data
- Discord OAuth + NAKWOL ID + SSO
- NAKWOL Connect v0.1 admin UI at `/admin/apps`
- `application_settings` and `auth_operators`
- public/member/admin app access policy enforcement
- Universal Embed at `/connect/v1.js`
- existing Web SDK v0.1.0

v0.2 must extend this rather than replace it.

## Architecture

```text
Human
  ↓ natural-language request
Coding agent / LLM
  ↓
`npx @nakwol/connect init`
  ↓ HTTPS
NAKWOL AUTH Worker / Connect Control Plane
  ↓
D1
  ├─ developers/operators
  ├─ applications
  ├─ application ownership
  ├─ device authorization grants
  └─ CLI tokens
```

The CLI never receives Discord Client Secret or Cloudflare credentials. It authenticates only to the NAKWOL Connect API.

## Roles

### operator

Existing Connect operator/owner. Can manage all apps and developer permissions.

### developer

Can create applications and manage only applications they own or are explicitly assigned to.

### member

Can use applications but cannot create or manage Connect applications.

Discord guild membership remains separate from Connect developer authorization.

## D1 additions

### `connect_developers`

- `user_id` primary key
- `role`: `developer` or `operator`
- `status`: `active` or `disabled`
- `created_at`
- `updated_at`
- `created_by`

Existing `auth_operators` remains supported. Operators are treated as implicit active developers with global app management rights.

### `application_owners`

- `client_id`
- `user_id`
- `role`: initially `owner`
- `created_at`
- composite primary key `(client_id, user_id)`

Existing applications may have no owner. Operators can assign owners later.

### `connect_device_requests`

For short-lived browser approval of CLI sessions.

- `device_code_hash` primary key
- `user_code` unique human-readable code
- `status`: `pending`, `approved`, `denied`, `consumed`, `expired`
- requested scopes
- approved user id
- expires_at
- interval_seconds
- created_at
- approved_at

Raw device codes are never stored.

### `connect_cli_tokens`

Longer-lived local CLI session tokens.

- `token_hash` primary key
- `user_id`
- `scopes`
- `expires_at`
- `revoked_at`
- `created_at`
- `last_used_at`

Raw tokens are never stored in D1.

## Device authorization flow

1. CLI calls `POST /connect/cli/device/start`.
2. Worker returns:
   - opaque `device_code`
   - short `user_code`
   - verification URL
   - expiry
   - poll interval
3. CLI opens or prints the verification URL.
4. Browser page uses normal NAKWOL AUTH Web SDK/SSO.
5. Logged-in user approves the CLI request.
6. Worker checks that the user is an operator or active Connect developer.
7. CLI polls `POST /connect/cli/device/token`.
8. On approval the Worker returns a CLI bearer token and atomically consumes the device request.

The browser approval is required only when the CLI has no valid local token. The token is stored locally in the user profile, never inside the project repository.

## CLI package

Package name:

```text
@nakwol/connect
```

Primary usage:

```bash
npx @nakwol/connect init
```

Commands:

### `init`

- inspect current directory
- detect framework
- inspect package metadata and existing integration
- authenticate through device authorization if necessary
- determine app name/client id proposal
- create app if unregistered or reuse owned app if already configured
- register a localhost redirect when appropriate
- install Universal Embed or framework-specific integration
- create/update `.nakwol-connect.json`
- run local structural verification
- call central diagnose API when a public URL is available

The command must be non-destructive and idempotent. Re-running `init` must not duplicate the embed.

### `doctor`

Read `.nakwol-connect.json`, inspect project files and central registration, and report actionable pass/fail checks. Exit non-zero on integration failure so coding agents can self-correct.

### `status`

Print machine-readable and human-readable current project connection state.

### `add-url <url>`

Add an exact redirect URI to the current app after ownership/permission checks.

### `sync`

Reconcile local configuration with central app registration and repair missing integration markers when safe.

### `remove`

Remove the local integration and local project config. Deleting the central application is intentionally separate and not part of v0.2.

## Local project state

The CLI creates:

```text
.nakwol-connect.json
```

Example:

```json
{
  "version": 1,
  "clientId": "battle-map",
  "framework": "vite",
  "redirectUris": [
    "http://localhost:5173/",
    "https://battle-map.pages.dev/"
  ],
  "integration": "universal-embed"
}
```

No secrets are stored in this file. It should be safe to commit.

## Framework detection

Detection order:

1. Next.js (`next` dependency + `app/` or `pages/`)
2. SvelteKit (`@sveltejs/kit`)
3. Vue/Vite
4. React/Vite
5. generic Vite
6. Create React App
7. static HTML
8. unsupported/unknown

For known frameworks, the CLI chooses the integration location itself. It must not ask the human which file to edit unless detection is genuinely ambiguous and no safe automatic target exists.

## Integration strategies

### HTML / Vite / React / Vue / CRA / SvelteKit

Prefer Universal Embed using the existing `/connect/v1.js`.

### Next.js

Use `next/script` in the nearest global layout (`app/layout.*`) or Pages Router application shell (`pages/_app.*`).

The CLI uses explicit marker comments so it can detect, update and remove its own edits safely.

## Control-plane API

All CLI management endpoints are under `/connect/cli/*`.

Required endpoints:

- `POST /connect/cli/device/start`
- `GET /connect/cli/device/verify` browser page
- `POST /connect/cli/device/approve`
- `POST /connect/cli/device/deny`
- `POST /connect/cli/device/token`
- `GET /connect/cli/me`
- `POST /connect/cli/apps`
- `GET /connect/cli/apps/:clientId`
- `PATCH /connect/cli/apps/:clientId`
- `POST /connect/cli/apps/:clientId/redirects`
- `GET /connect/cli/apps/:clientId/diagnose`

Every management endpoint validates the CLI bearer token and app ownership. Operators bypass owner restrictions.

## App registration behavior

On `init`, the CLI sends a proposed app name, framework, access policy and local redirect URI.

The Worker:

1. verifies developer/operator permission
2. creates a unique normalized client id if needed
3. inserts `applications`
4. inserts `application_settings`
5. inserts `application_owners`
6. returns the canonical app record

Default access policy for CLI-created apps is `member`, because Connect is primarily for alliance services. The CLI may request another policy only when the authenticated developer is allowed to do so; v0.2 allows `public` and `member` for developers, while `admin` requires an operator.

## Developer management UI

Extend `/admin/apps` with a Developers section:

- list operators/developers
- grant developer role to an existing NAKWOL user
- disable developer role
- show applications owned by each developer
- assign/unassign app ownership

No separate passwords are introduced.

## LLM-facing UX

The intended prompt is:

```text
이 프로젝트에 NAKWOL Connect 붙여줘.
공식 CLI `npx @nakwol/connect init`을 사용하고,
설치 후 `npx @nakwol/connect doctor`가 통과할 때까지 수정해.
```

The CLI must print concise, deterministic messages suitable for coding agents and provide `--json` for `status`, `doctor`, and init result summaries.

## Error handling

- expired device request: CLI restarts authorization
- unauthorized member: browser page explains that developer permission is required
- app name/client id collision: Worker generates a deterministic unique suffix or returns an owned existing app when safe
- unsupported framework: CLI makes no code edits and exits with a clear machine-readable error
- partial edit failure: CLI rolls back files it changed in the current operation
- central API unavailable: no destructive local change occurs before registration is confirmed
- invalid public redirect URI: reject before saving

## Security

- no Discord secret or Cloudflare secret in CLI/project
- device codes and CLI tokens stored only as hashes server-side
- short-lived device flow
- CLI token scoped to Connect management APIs
- ownership enforcement server-side
- exact redirect URI validation retained
- operators retain global control
- CLI logs never print bearer tokens
- local token storage uses OS user profile with restrictive file permissions where supported

## Testing

### Worker tests / CI checks

- device request lifecycle
- approval permission enforcement
- token consumption/replay prevention
- developer role checks
- app ownership checks
- redirect mutation validation
- operator override
- existing v0.1 app compatibility

### CLI tests

Use fixture projects for:

- Vite React
- generic Vite
- static HTML
- Next.js App Router
- SvelteKit
- already-installed project
- unsupported project

Test idempotent init, remove/re-init, doctor failure codes, and JSON output.

### Production smoke

After deployment:

- verify new D1 tables
- verify device start endpoint
- verify browser verification page
- grant a test developer/operator path using the existing owner account
- create a temporary app through the CLI API
- add a redirect
- run diagnose
- delete/revoke temporary credentials and clean temporary app data
- verify existing `siege-calculator` and v0.1 routes still work

## Deployment

Worker/D1 changes remain in `goyoung2/nakwol-auth` and use the existing token-based GitHub Actions deployment.

The CLI source will live in the same repository under `packages/connect-cli/` for v0.2, so Worker API and CLI contracts version together. Publishing to npm is a separate release step; CI must also support executing the CLI directly from the repository before npm publication.

## Non-goals for v0.2

- MCP server
- automatic GitHub PR creation
- deleting central apps from CLI
- organization-wide OAuth developer portal
- arbitrary third-party identity providers
- storing application secrets in developer projects

## Success criteria

v0.2 is complete when an authorized developer can open an arbitrary supported web project and a coding agent can successfully perform:

```bash
npx @nakwol/connect init
npx @nakwol/connect doctor
```

with the only human interaction being the one-time browser approval when the CLI user has no valid local Connect session. Subsequent projects on the same machine should register and install without another browser approval until the CLI token expires or is revoked.
