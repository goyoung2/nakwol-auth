# Commercial AUTH foundation: T01/T02 local implementation

Date: 2026-09-30. Plan baseline: `4ec0d08d2f3a61551e0b51275391b806c8dfccdb`.
Status: local implementation and tests; no production deployment or npm release.

## T01 guide boundary

Consumer: `nakwol-portal-guidelines-main`, base `c6118ef7f8b4ee4efe2c76323b1b0f96b57c8ba0`, branch `fix/protect-all-guide-assets`.

- Vercel matcher now covers every path. Removed public/immutable static cache overrides.
- Cloudflare `/version.json` no longer bypasses the common gate.
- Version comparison requires per-origin authenticated cookies via environment variables; never logs cookies.
- Regression RED: `/version.json` returned200 instead of401.
- Final local build inventory:816 distinct paths including HTML aliases; four request forms (GET/HEAD/Range/conditional GET) across two entrypoints =6,528 denied requests, all401 and no protected bytes.
- Valid member fixture obtains one session per origin, then serves an asset using the local lease:2 initial AUTH checks total,0 asset rechecks.
- `validate`, clean `check` (0 errors,0 warnings,75 existing hints), `build` (47 pages) and `test:gate` passed. Initial overlapping shell timeout left a check/build race; clean sequential check rerun passed. No unrelated preview process stopped.
- This is actual adapter function execution with a controlled asset handler, not a live CDN or Discord-browser test.

Read-only production sample during this work (still old deployment):

| Path | Cloudflare | Vercel |
|---|---|---|
| /version.json |200 public; max-age=0|200 public; max-age=0|
| /images/generals/bu-lianshi.webp |401 no-store|200 public; max-age=86400|

The cache entries above use `public; max-age=...` notation. This small sample reconfirms exposure, not an exhaustive fresh production audit. Prior Sept29 inventory counts are historical and differ from this build. Deployment, authenticated real-browser acceptance, previous deployment/origin closure and live cache checks remain release work.

## T02 central isolation and atomic OAuth

- RED real D1:20 simultaneous exchanges all succeeded. New conditional INSERT SELECT + consume UPDATE use one D1 batch; only the exchange's own token hash authorizes the consume update. GREEN:1 success,1 persisted token.
- Injected SQL trigger failure rolls back both issuance and code consumption; retry after removing the trigger succeeds.
- Wrong PKCE/client does not consume the valid code.
- B extra-role denial no longer clears A central SSO. Disabled identity still invalidates its central session. Denied Discord callback issues no new credentials and preserves an existing valid identity.
- Browser-bound OAuth transaction: host-only HttpOnly/Secure/Lax cookie, state carries the verifier hash,600-second expiry, cookie mismatch rejected before DB consumption, atomic DELETE RETURNING before Discord exchange.
- Same callback20 times:1 redirect,19 rejects. Separate tabs work independently; expired transaction rejected; sixth sequential start rejected.
- Limit5 is based on cookies already received by the browser, not a global strict concurrency limit. Concurrent initial starts can exceed5; this is not an authorization bypass. Server-side distributed initiation rate limits remain subsequent hardening.
- Additive protocol rollout: callbacks started before this change lack the binding cookie and must restart login. Existing SSO/app tokens remain compatible. No DB migration is required for this milestone.
- Final whole AUTH suite:211/211 passed, including separate tabs and sequential cap tests. Typecheck passed.

## Review and remaining work

Fresh-context read-only reviewer approved T01/T02 source changes with no blocking finding; requested tab/cap test coverage was added. Review did not validate deployed routing, CDN behavior or live OAuth consent.

T01/T02 are locally implemented; their production acceptance is pending. T03~T12 and D01~D04 are not implemented by this milestone. No claim of the entire commercial plan being completed is made.
