# NAKWOL Connect v0.2 Agent CLI Design

## Goal

Make NAKWOL Connect installable and manageable by coding LLMs/agents with one CLI command, without giving the LLM a Cloudflare credential, Discord secret, or reusable operator password.

The intended user interaction is:

> “이 프로젝트에 NAKWOL Connect 붙여줘.”

The coding agent runs the official CLI, the CLI inspects and patches the project, and the central `nakwol-auth` Worker registers/manages the application in D1.

## Existing foundation

v0.1 already provides central Discord/NAKWOL SSO, `applications`, `application_settings.owner_user_id`, `auth_operators`, `/admin/apps`, `/connect/v1.js`, access-policy enforcement, and unattended Cloudflare deployment. v0.2 extends these pieces rather than creating a second control plane.

## Architecture

```text
Coding LLM / agent
      │
      │ npx <NAKWOL CLI package> init
      ▼
NAKWOL Connect CLI
      │
      ├─ inspect local repository
      ├─ device authorization (first use)
      ├─ register/read/update app through HTTPS API
      ├─ patch supported project layouts
      ├─ write .nakwol-connect.json (no secret)
      └─ doctor / verification
      │
      ▼
Cloudflare Worker: nakwol-auth
      │
      ├─ device authorization endpoints
      ├─ CLI bearer-token authentication
      ├─ developer/operator authorization
      ├─ app ownership + redirect URI management
      ├─ agent install contracts
      └─ existing OAuth/SSO
      │
      ▼
D1: nakwol-auth
```

The Worker is the NAKWOL Connect control plane. Cloudflare itself does not automatically register apps; our Worker APIs perform that work and persist it in D1.

## Distribution

v0.2 must work without requiring an npm organization or npm publishing token.

Source package lives in `packages/connect-cli/`. CI builds an npm-compatible tarball and exposes it from the Worker as:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz
```

Immediate agent command:

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

The package name/bin remains compatible with a later public `@nakwol/connect` npm release. Publishing to npm is not required for v0.2 acceptance.

## Identity and roles

Reuse `auth_operators` with three Connect roles:

- `owner`: Connect platform owner; can manage all apps and developer roles.
- `operator`: can manage all apps and developer roles except platform-owner removal.
- `developer`: can create applications and manage only applications they own.

A Discord `membership.role === 'admin'` continues to have operator-equivalent control-plane privileges.

Existing owner/operator rows remain valid. `developer` is a new accepted value; no destructive migration is needed.

`application_settings.owner_user_id` remains the canonical application owner in v0.2. Multi-owner/collaborator support is deliberately deferred.

## Developer management

`/admin/apps` gains a developer-management section. An owner/operator can search existing NAKWOL users, grant `developer`, and revoke `developer`.

The admin UI never exposes CLI bearer tokens.

## Device authorization

The coding LLM must never receive Cloudflare API tokens, Discord client secrets, or an operator password. A browser approval flow authorizes the local CLI instead.

1. CLI calls `POST /connect/api/device/start` with non-secret device/project metadata.
2. Worker creates a high-entropy `device_code`, short `user_code`, verification URL `/connect/device?code=XXXX-XXXX`, and 10-minute expiry.
3. CLI opens the verification URL and polls with `device_code`.
4. Browser page uses existing NAKWOL AUTH (`nakwol-connect-admin`) for login.
5. Browser sends approval with its NAKWOL app access token and `user_code`.
6. Worker permits approval only for `owner`, `operator`, `developer`, or Discord admin.
7. CLI poll exchanges the approved request for a CLI bearer token exactly once.
8. Worker stores only a SHA-256 hash of the CLI token.
9. CLI stores the raw token only in the user home directory, never inside the project repository.

Device request states are `pending`, `approved`, `denied`, `consumed`, and `expired`.

CLI bearer tokens expire after 30 days. A user can re-run device authorization after expiry. Revocation is exposed to the admin API/UI.

## D1 additions

Migration `0004_connect_agent_cli.sql` creates `connect_device_requests` and `connect_cli_tokens`.

`connect_device_requests` fields: `device_code_hash`, `user_code`, `status`, `requested_action`, `project_name`, `framework`, `homepage_url`, `approved_user_id`, `expires_at`, `created_at`, `approved_at`, `consumed_at`.

`connect_cli_tokens` fields: `token_hash`, `user_id`, `expires_at`, `revoked_at`, `created_at`, `last_used_at`, `label`.

No raw device code or CLI token is stored in D1.

The existing `nakwol-connect-admin` application gains `/connect/device` as an allowed redirect URI.

## CLI control API

All CLI endpoints are under `/connect/api/cli/*` and require a valid CLI bearer token except device start/poll.

- `GET /connect/api/cli/me` returns current NAKWOL ID, display name, Connect role, and expiry.
- `POST /connect/api/cli/apps` creates an app. Developers create apps owned by themselves; operators/admins may create any app.
- `GET /connect/api/cli/apps/:clientId` reads an app if the caller owns it or has global management rights.
- `PATCH /connect/api/cli/apps/:clientId` updates name, homepage, framework, access policy, status, and redirect URIs with the same ownership rule.
- `POST /connect/api/cli/apps/:clientId/urls` adds one validated exact redirect URI idempotently.
- `POST /connect/api/cli/apps/:clientId/disable` disables the remote app.

The server normalizes requested client IDs and resolves collisions with a short random suffix. Exact redirect URI validation remains mandatory.

## Agent contract

`GET /connect/agent/:clientId` returns machine-readable JSON containing client ID, redirect URIs, framework, access policy, Universal Embed URL, preferred integration mode, framework file hints, CLI package URL/version, and verification events. No secrets are included.

## CLI commands

```text
nakwol-connect init
nakwol-connect login
nakwol-connect status
nakwol-connect doctor
nakwol-connect add-url <url>
nakwol-connect sync
nakwol-connect remove [--remote]
```

`--json` makes command output machine-readable for coding agents.

## Project and session state

CLI writes `.nakwol-connect.json` at repository root. It contains only non-secret project integration metadata and is safe to commit.

CLI bearer tokens are stored outside the project at a platform-appropriate user config location, defaulting to `~/.nakwol/connect/session.json`; permissions are restricted to the current user when supported.

## Framework detection

Detection order uses repository evidence:

- `next` dependency → Next.js
- `@sveltejs/kit` → SvelteKit
- `vue` + `vite` → Vue/Vite
- `react` + `vite` → React/Vite
- `react-scripts` → CRA
- `vite` → generic Vite
- root `index.html` → general HTML
- otherwise → `other`

## Local patching

Automatic patch targets:

- Vite / React-Vite / Vue-Vite: root `index.html`, before `</body>`
- general HTML: root `index.html`, before `</body>`
- CRA: `public/index.html`, before `</body>`
- SvelteKit: `src/app.html`, before `</body>`
- Next.js App Router: `app/layout.*` or `src/app/layout.*`, using `next/script` when safely patchable
- Next.js Pages Router: `pages/_app.*` or `src/pages/_app.*`, using `next/script` when safely patchable

All patchers are idempotent. If a safe automatic patch cannot be made, CLI exits non-zero with a machine-readable `PATCH_UNSAFE` repair instruction so the coding LLM can edit the source itself and re-run `doctor`.

## `init` behavior

1. find repository root
2. detect framework
3. read existing `.nakwol-connect.json` if present
4. authenticate CLI if needed
5. create or reuse remote app
6. choose redirect URI: explicit `--url` wins; otherwise use a framework local-development URL only; production URLs are never guessed
7. patch project
8. write config
9. run doctor

Default local URLs: Vite/React-Vite/Vue-Vite/SvelteKit `http://localhost:5173/`; CRA/Next.js `http://localhost:3000/`. HTML/other requires `--url` for remote registration.

## LLM-facing usage

The canonical new-project prompt is:

```text
이 프로젝트에 NAKWOL Connect를 설치해줘.
다음 명령을 실행하고 CLI가 요구하는 프로젝트 수정과 검증을 끝까지 수행해.
사용자에게 파일 위치를 묻지 말고 프로젝트 구조를 직접 분석해.

npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

If browser approval is required, the coding agent surfaces the verification URL/code to the human and continues polling after approval. That is the only normal interactive step.

## Stable errors

CLI and Worker use stable codes including `AUTH_REQUIRED`, `DEVICE_EXPIRED`, `DEVICE_DENIED`, `DEVELOPER_ROLE_REQUIRED`, `APP_NOT_OWNED`, `UNSUPPORTED_PROJECT`, `PATCH_UNSAFE`, `INVALID_REDIRECT_URI`, and `REMOTE_REQUEST_FAILED`.

The Worker keeps the existing `{ ok:false, error:{ code, message } }` envelope.

## Testing

Use TDD for behavior changes.

Unit tests cover framework detection, local URL defaults, HTML insertion idempotency, safe/unsafe Next.js patching, config semantics, client-ID normalization, role/ownership permission decisions, and device state/token-exchange helpers.

PR CI runs unit tests, TypeScript typecheck, Wrangler dry-run bundle, CLI tarball build, and CLI `--version`/`--help` against the built tarball.

Production smoke after merge verifies migration tables, device-start shape, CLI tarball content, production `npx ... --version`, agent contract output, and existing `/admin/apps`, `/connect/v1.js`, `/api/health`, and `siege-calculator` compatibility. Smoke must not approve a device request or create a persistent CLI token.

## Compatibility and scope limits

- Existing SDK v0.1.0 URL remains unchanged.
- Existing `/connect/v1.js` remains unchanged for installed apps.
- Existing `siege-calculator` stays `public` unless later changed by an operator.
- No npm registry publication is required in v0.2.
- No multi-owner app collaboration in v0.2.
- No Cloudflare credential is ever given to CLI users or coding LLMs.
- No automatic production URL guessing.
