# Vercel AUTH comparison canary

This separate preview runs `src/sdk-entry.ts` in Node 22 in Vercel region `icn1`. OAuth, PKCE, member policy, manual grants, operator checks, and diagnostics are the existing shared AUTH implementation. It does not forward AUTH HTTP requests to the production Worker. SQL alone crosses an authenticated bridge Worker bound exclusively to the newly created test D1 database. Existing Cloudflare configs, source algorithms, SDK version bytes, users, and production database remain unchanged.

## Build and upload

Install the existing root dependencies and this private standalone package's dependencies locally. From repository root:

```
npm ci --prefix deploy/vercel-auth-test
node scripts/build-vercel-auth-test.mjs
node_modules/.bin/tsc --noEmit -p adapters/vercel/tsconfig.json
node --test tests/vercel/runtime.test.mjs
npm run build --prefix deploy/vercel-auth-test
```

The local build packs the existing Connect CLI and bundles Hono/shared source and text assets with esbuild. Upload **only** `deploy/vercel-auth-test` to the separate Vercel project; its build reads the already uploaded `runtime/auth-runtime.mjs` and creates an empty `public` output directory. No source outside the uploaded directory is needed at Vercel build/runtime. Only `api/index.mjs` is a Function. All requests rewrite there; runtime and bootstrap helpers are not static public files. `.vercelignore` excludes DB deployment files, local credentials, logs, and installed dependencies.

The API adapts streamed Node bodies and Vercel parsed JSON/form bodies to a native Request. Response status, headers, distinct Set-Cookie values and body are preserved; HEAD sends no body. ExecutionContext.waitUntil uses `@vercel/functions`. Node 22 supplies native WebCrypto. No raw errors, SQL, tokens, IPs or bridge secrets are logged by this adaptation.

## Server environment

| Variable | Requirement |
| --- | --- |
| `NAKWOL_VERCEL_CANARY` | Exactly `true` |
| `AUTH_ORIGIN` | Exactly `https://nakwol-auth-vercel-test.vercel.app` |
| `D1_BRIDGE_URL` | HTTPS URL of the separate bridge, exact `/rpc`, no query/hash/credentials |
| `D1_BRIDGE_SECRET` | Generated independent printable secret of at least 32 bytes; 43+ base64url characters recommended |
| `DISCORD_CLIENT_ID` | Actual Discord application ID |
| `DISCORD_CLIENT_SECRET` | Actual application secret; never a placeholder |
| `NAKWOL_GUILD_ID` | Existing configured guild ID for legitimate Discord verification |
| `NAKWOL_MEMBER_ROLE_ID` | Existing season role ID |
| `DISCORD_BOT_TOKEN`, `DISCORD_BOT_TOKEN2` | Optional existing shared AUTH features only; OAuth works with `guilds.members.read` without a bot |

Use Vercel server environment settings and the bridge's Wrangler secret store; never browser variables or tracked files. Register `https://nakwol-auth-vercel-test.vercel.app/auth/discord/callback` in the Discord developer application before testing live login. Install the fixed alias explicitly after the preview deployment. Generated preview hostnames deliberately return 503: the actual Host and native URL origin must equal the fixed test origin. Host/query/forwarded headers never select the AUTH authority.

With missing Discord configuration, `/canary/status` and `/diagnostics/ping` are reachable. With valid bridge configuration, the official `/diagnostics` routes and explicit SDK asset routes also run without Discord secrets. Authentication/OAuth routes return `TEST_CONFIGURATION_MISSING` 503. Status exposes only booleans/platform and reachability, not IDs, URLs, credentials or DB claims. DB failures on actual DB paths return a sanitized 503; an anonymous request rejected before DB access retains its normal 401.

## Separate test DB and bridge

Create a new **empty** D1 database named `nakwol-auth-vercel-test` or a suffixed name beginning `nakwol-auth-vercel-test-`. Record its UUID. Generate local ignored configuration, with no production default:

```
node scripts/prepare-vercel-test-d1.mjs --database-name TEST_NAME --database-id TEST_UUID --auth-origin https://nakwol-auth-vercel-test.vercel.app
npx wrangler d1 migrations apply TEST_NAME --remote --config .wrangler/vercel-test/generated-bridge.wrangler.jsonc
npx wrangler d1 execute TEST_NAME --remote --config .wrangler/vercel-test/generated-bridge.wrangler.jsonc --file .wrangler/vercel-test/bootstrap.sql
npx wrangler secret put D1_BRIDGE_SECRET --config .wrangler/vercel-test/generated-bridge.wrangler.jsonc
npx wrangler deploy --config .wrangler/vercel-test/generated-bridge.wrangler.jsonc
```

Verify the UUID belongs to the newly created test DB before remote commands. These commands belong to the approved deployment operator. Bootstrap replaces every supported internal app's callback/homepage with the test origin, including CLI device verification. Admin remains admin policy, account remains guest policy; comparison client uses member policy. Unsupported DATA/Lab and other seeded apps are inactive. No users, operators, sessions or grants are seeded/copied. An actual new Discord login creates an identity normally. Operator access requires a separately authorized offline grant to that real identity; the canary has no fixture backdoor.

The bridge requires `NAKWOL_D1_TEST_BRIDGE=true` and the independent secret. It accepts only POST `/rpc` without query, performs fixed-size digest constant-time Bearer comparison, requires JSON, and provides no CORS. prepare/bind/first/all/run/raw/batch/exec transport native D1 result metadata and atomic batch rollback. Binary binds use bounded byte arrays. Sessions/bookmarks/dump are unsupported because current AUTH does not use them.

Limits: body 256 KiB, SQL per statement 16 KiB, 100 parameters, 64 batch statements, response 2 MiB, 10-second transport/bridge deadline. Errors contain no SQL/parameters. There is one attempt only. A deadline cannot cancel a D1 statement already executing; a timed-out write has uncertain commit outcome and must not be automatically retried. Late body completion cannot start SQL after the bridge deadline.

## Evidence and comparison limits

`tests/vercel/runtime.test.mjs` runs a real Miniflare Worker/D1 database via a real loopback HTTP bridge. It checks auth/path/content bounds, SQL error redaction, raw/binary/result semantics, atomic rollback, no retry/deadline, origin isolation, no-secret diagnostics, immutable SDK bytes, no-bot mocked Discord OAuth + real DB PKCE/member/manual-grant access, and real Node wrapper bodies/HEAD/private helper paths. Existing tests also run once. Discord is mocked only at its external HTTP boundary; this evidence is not a live Discord or KT-network measurement.

AUTH SQL has an HTTPS round trip per used D1 operation, so this transport is for this canary comparison and does not establish a final migration design. There is no extra readiness SQL on each request. CF ASN/organization/colo/ray are unavailable on Node and returned as null; spoofed CF headers are removed. Production SDK defaults remain byte-identical, so external canary consumers must explicitly set `authOrigin` to the test URL. Legacy `/lab` UI is disabled because its SDK default/hardcoded authority targets production. DATA integration examples still describe the existing production DATA service; unsupported DATA apps are inactive in the test DB.

Deployment operator must verify live status/ping, diagnostic report acknowledgement, helper paths unavailable, secret-missing OAuth 503, preview-host rejection, then actual Discord login after credential/callback setup. Do not label local checks as deployed, KT-tested or live-Discord-tested.

On Node the existing diagnostic network guard receives `unavailable` because CF client IP metadata is absent. This preserves the existing six tickets/hour per network guard, shared by the canary's callers; the global guard remains unchanged. A report rate-limit response is distinct from a network failure. Stable Miniflare 4 is a local test dependency only; the production dependency audit is clean, while the full dev tree currently reports three high advisories in Miniflare/undici/sharp. No dependency force-upgrade was applied.
