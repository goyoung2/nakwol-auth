# NAKWOL Connect v0.4 API Discovery Design

Date: 2026-08-29

## Context

NAKWOL Connect v0.3 is already a production golden release: CLI device authorization, AUTH app registration/reuse, exact DATA scope synchronization, project integration, browser DATA fetch plumbing and three-way doctor verification are complete. NAKWOL DATA subsequently advanced to service 0.8.0/schema 3 with roster, equipment, deck and snapshot APIs, while Connect's convenience layer still primarily names Registry endpoints.

The remaining automation gap is API discovery. A coding agent can call `NAKWOL_CONNECT.data.request()` against any DATA endpoint, but it has no authoritative machine-readable contract for learning the current endpoint set and request shapes. Hard-coding every future DATA endpoint into Connect would recreate version drift.

## Goal

Make NAKWOL DATA self-describing so an LLM or developer can discover the current API contract without manual documentation lookup, while keeping the existing authentication, authorization, storage and runtime boundaries unchanged.

## Release contract

- NAKWOL DATA service: `0.9.0`
- DATA schema: remains `3`; no D1 migration
- `nakwol-connect`: `0.4.0`
- Existing v0.3 project config version remains `2`
- Existing DATA scopes remain unchanged
- Existing runtime and CLI commands remain backward compatible

## Architecture

### 1. Public OpenAPI document

NAKWOL DATA exposes `GET /openapi.json` as an unauthenticated, CORS-readable OpenAPI 3.1 document. It describes app-facing DATA endpoints only. Internal Connect control endpoints under `/connect/cli/` are deliberately omitted.

The document is built from a focused `services/data/src/openapi.ts` module and uses the runtime DATA service version. Each protected operation carries an `x-nakwol-scope` extension with the exact required DATA scope.

Security schemes describe the existing runtime contract:

- Bearer access token in `Authorization`
- app ID in `X-NAKWOL-CLIENT-ID`

No new token, secret or authorization mechanism is introduced.

### 2. Route coverage gate

A DATA test extracts HTTP method/path pairs from `services/data/src/index.ts` and compares all app-facing routes against the OpenAPI document. `/connect/cli/` routes are excluded from this public contract.

If a future DATA route is added without an OpenAPI operation, CI fails. This makes API discovery part of the release contract rather than best-effort documentation.

### 3. Schema discovery hint

`GET /api/schema` remains backward compatible and adds discovery metadata:

- `openapi_path: /openapi.json`
- `openapi_version: 3.1.0`

Existing `service`, `version`, `schema_version` and `scopes` fields remain unchanged.

### 4. Connect runtime discovery

`window.NAKWOL_CONNECT.data` keeps the existing authenticated `fetch` and `request` methods and gains:

- `openapi()`
- `describe()` alias

These methods fetch `${dataOrigin}/openapi.json` without requiring a user login. The existing Registry convenience helpers remain unchanged.

### 5. Agent-first CLI discovery

`nakwol-connect data describe --json` fetches the OpenAPI document and returns it with the resolved DATA origin and OpenAPI URL. It does not require a CLI device session because the discovery document is public. It can use the project's configured `dataOrigin`, `--data-origin`, or the production default.

`doctor` additionally verifies that the configured DATA origin exposes a valid OpenAPI 3.1 document and that every locally configured DATA scope appears in at least one operation's `x-nakwol-scope` or the document's declared scope list.

### 6. Agent guidance

AUTH `/llms.txt`, CLI manifest and package README point coding agents to:

1. `npx --yes nakwol-connect init --scopes ...`
2. `npx --yes nakwol-connect data describe --json`
3. implement against the returned OpenAPI contract
4. `npx --yes nakwol-connect doctor --json`

Agents are explicitly told not to invent endpoint paths or manually construct AUTH/DATA headers.

## OpenAPI scope

The first document covers the currently shipped app-facing API:

- public health/schema/OpenAPI
- current user
- game accounts
- owned generals
- owned tactics
- equipment instances and evidence-gated traits
- decks and composition
- deck snapshots
- Registry summary/generals/tactics/equipment/equipment traits/stats/formations/warbooks

Request schemas mirror the actual current normalizers. Response envelopes are represented without inventing fields that stores do not guarantee.

## Failure behavior

- OpenAPI generation has no D1 dependency, so Registry/database failures cannot break discovery.
- `data describe` reports DATA HTTP/JSON errors as ConnectDataApiError.
- A failed discovery check makes `doctor` fail but does not mutate project files or central state.
- Existing AUTH-only and DATA-enabled projects continue to function if discovery is unavailable; only the new describe/doctor discovery check is affected.

## Security

- OpenAPI contains API shapes, not credentials or user data.
- No CLI token is embedded in project files or browser runtime.
- Existing DATA operations still require the same Bearer token, client ID and DATA scope.
- DATA D1 and AUTH D1 remain separate.
- `/connect/cli/` management endpoints are not advertised in public OpenAPI.

## Verification

Required gates:

- OpenAPI object/version/security/scope tests
- app-facing route coverage test
- schema discovery hint test
- ConnectDataApi describe test
- CLI `data describe` no-session test
- runtime `data.openapi()` contract test
- version/distribution/llms tests
- full AUTH/CLI test + typecheck + Worker bundle
- full DATA test + typecheck + Worker bundle
- production DATA deploy before AUTH/Connect deploy
- npm Trusted Publishing of `nakwol-connect@0.4.0` only after both production services pass smoke verification
