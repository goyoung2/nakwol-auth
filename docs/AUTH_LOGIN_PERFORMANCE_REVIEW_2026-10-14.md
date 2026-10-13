# Login performance and correctness review (2026-10-14)

Status: implemented and verified locally. This report does not assert a production deployment or resolution of a particular KT user's incident.

Baseline: `4017413fca92d2c405178ee0d412f14c479e87d2` on `hotfix/auth-login-stalls`.

## Why login accesses the database

Discord identifies the account and supplies guild roles. NAKWOL must independently verify the application's status, registered redirect/origin, account status, role freshness, required roles, explicit service grants, administrator-requested reauthentication, and code/token validity. It must persist the one-time code and central/site credentials. Previously, each step reread these facts with separate database calls. In the Vercel adapter, each call was a network request to the Cloudflare D1 bridge.

## Changes

- One joined, per-request policy snapshot replaces eight independent database reads on the ordinary member path. Strict additional-role parsing and all existing policy precedence remain. No cross-request authorization cache was added.
- `/me` uses three database RPCs instead of ten. Application and token reads run concurrently; a fresh policy snapshot follows. Token/session reauthentication invalidation is part of the credential query.
- Token exchange reuses its validated application read. Existing Discord user updates are batched. Callback denial reuses its original diagnosis.
- Discord token exchange, profile and membership requests now have a five-second deadline including headers and body, a 64 KiB response cap, validated response shapes and sanitized errors. Profile and membership run concurrently after token exchange. No automatic retry consumes the same Discord code again. The Discord dependency chain is bounded to approximately ten seconds plus local scheduling; this is not a ten-second bound on the entire login/database flow.
- Normal `/me` has a 5.5-second whole-response deadline, below the site's existing seven-second AUTH wait budget. Timeout returns 503 with no user payload and no-store. Native D1 reads cannot be cancelled through this API; already started reads can finish in the background. The Vercel RPC's own ten-second limit still applies to those reads. Diagnostic persistence and network transit are outside the normal-handler deadline.
- Login audit writes use the runtime's `waitUntil`. Failed audit writes emit `AUTH_EVENT_WRITE_FAILED` without logging credential/error contents and do not reject an otherwise valid login or suppress its error redirect. Callers without an execution context await the safe logging task. During DB failure, an audit row can be absent while the sanitized server failure remains observable.
- Concurrent redemption of one authorization code previously issued multiple access tokens. Token insertion now requires an unused, unexpired, correctly bound code; insertion and consumption share a D1 transaction. Exactly one insert must succeed. A reauthentication request also invalidates older codes.

The site's AES-GCM session, origin/client binding, required/member policy, five-minute authorization lease, 24-hour stored Discord-role freshness policy, token lifetime and central-session lifetime are unchanged. No database migration or SDK/gate package change is required for these central-server improvements. Once AUTH is deployed, existing clients calling that server benefit; this does not install newer pinned browser SDKs on old sites.

## Reproducible controlled benchmark

Run from the repository root:

```sh
node --import tsx scripts/benchmark-auth-login.mjs 100
```

The benchmark runs the actual Hono handlers, HttpD1Database and real local D1 SQLite with synthetic Discord responses. Every bridge RPC receives 100 ms of controlled delay. It measures an existing active member completing an initial login. No production data is read or written. Browser calls follow the installed login flow but are driven directly, so OAuth consent, SDK download, CORS preflight and real client network transit are excluded.

| Stage | Before RPC | After RPC | Before ms | After ms |
| --- | ---: | ---: | ---: | ---: |
| Initial authorize | 2 | 2 | 246.1 | 241.5 |
| Discord callback | 18 | 10 | 1535.1 | 1118.7 |
| Browser token exchange | 12 | 4 | 765.8 | 490.0 |
| Browser bootstrap /me | 10 | 3 | 772.8 | 259.9 |
| Site session's independent /me | 10 | 3 | 772.5 | 259.4 |
| Total to site session | **52** | **22** | **4092.3** | **2369.5** |
| Existing central SSO authorize | 14 | 6 | 1027.8 | 749.8 |
| Optional page SDK /me | 10 | 3 | 757.4 | 246.0 |

Database RPC count falls 57.7%; the controlled initial login segment falls 42.1%. These are single-run controlled measurements, not a production latency percentile or a KT connection measurement. Batched statements count as one RPC. Cloudflare native D1 has the same logical reads but does not incur the Vercel-to-bridge HTTP hop for each operation.

A valid lease still permits 300 protected image requests with zero central `/me` calls and 300 successes. Static asset implementation and cache policy were not changed; no improvement in image-serving CPU or network throughput is claimed.

Baseline raw evidence is retained under `.wrangler/performance-followup/profile-100.json`; final output is `.wrangler/auth-login-benchmark/profile-100.json`. These local artifacts are ignored by Git. The benchmark script is committed for reproduction.

## Verification

- Full AUTH and Connect/gate suite: 256 tests passed.
- Vercel adapter suite: 26 tests passed.
- Root TypeScript check and Vercel adapter TypeScript check passed.
- Before the code-consumption fix, the new real-D1 regression issued three tokens from three simultaneous exchanges; after the fix, exactly one succeeded and later reuse was rejected.
- Runtime tests cover missing/stale/removed roles, additional roles, guest/public alias, manual grants, disabled accounts/apps, AUTH operator versus Lab privilege, credential revocation, wrong origins/tokens, stalled Discord headers/body, malformed/oversized Discord data, callback recovery when audit persistence fails, and no user payload on `/me` timeout.
- Existing static-gate and verifier tests passed in the full suite. The prior operating `protect verify` results are not represented as a new production check of this local change.

## Operating follow-up

Promote and deploy the central AUTH change through the repository's hotfix release process, then compare real initial-login and expired-lease timings on both AUTH hosts. Keep the known live benchmark and rollback commit. The reported encyclopedia was last observed with gate 0.7.2 and SDK 0.3.1; central improvements apply after AUTH deployment, while its earlier browser-side deadline updates still require its developer to update the installation. Cross-isolate expired-lease requests can still cause one revalidation per isolate. This change reduces the cost of each revalidation and does not claim global single-flight.
