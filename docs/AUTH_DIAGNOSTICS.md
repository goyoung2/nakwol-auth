# AUTH diagnostics — source implementation

AUTH 0.2.1 / Connect 0.7.3. This change is local source; no deployment or npm publication was performed. Published Web SDK modules remain immutable.

## User workflow

A login failure screen offers 접속 진단. Official gates expose the self-contained runtime at /__nakwol/diagnostics; it still starts, cancels and exports a local report when AUTH/SDK is unavailable. Central /diagnostics?client_id=REGISTERED_APP uses the same runtime and shows the selected service. Mutable Connect Embed links to that central page.

The user explicitly starts four bounded sequential probes: same-origin official gate ping when installed, central tiny AUTH ping, pinned SDK availability without importing it, and registered application/D1 lookup. Each probe has a five-second timeout; ticket/upload each four seconds and the whole run is bounded to 25 seconds, with no automatic retry. A timeout/CORS observation cannot identify an ISP routing fault. Optional ResourceTiming DNS, TCP, TLS and first-response times apply to owned ping endpoints only; reused or inaccessible metrics are null.

A report is called received only after a successful upload response acknowledges its exact reference and current observations. New observations invalidate the previous receipt until their upload is acknowledged. Local report numbers and acknowledged server numbers are visibly distinct. Exported JSON contains only coarse browser/platform enums, bounded stage/outcome/duration/HTTP/timing fields, a local reference, issued reference, acknowledged server reference and acknowledgement flag. It contains no URLs, OAuth state/code, account, cookie, token, capability, IP, raw exception or response body.

Explicit diagnostic login runs on the site's origin. It creates a normal PKCE transaction in the pinned SDK's existing transaction storage and carries only an opaque diagnostic_ref in authorize navigation. The normal SDK validates state/PKCE and exchanges the code. Its existing fetchImpl hook measures token/me and the official site's session POST, adds bounded diagnostic correlation headers, and keeps credentials out of reports. Page NavigationTiming is recorded separately; time spent interacting at Discord is never reported as AUTH latency.

## Central API

- GET /diagnostics: UI, no-store, no-referrer.
- GET /diagnostics/ping: tiny credential-free connectivity response, no D1 or persistence. CORS and Timing-Allow-Origin are wildcard only here.
- GET /diagnostics/application?client_id=APP: active registered app/D1 lookup only.
- POST /diagnostics/tickets?client_id=APP with JSON {}: returns reference, capability, expires_at (30 minutes).
- POST /diagnostics/reports/:reference?client_id=APP: JSON report and X-Nakwol-Diagnostic-Capability; acknowledgement returns ok/reference, 201.
- GET /admin/api/apps/:clientId/auth-diagnostics?reference=dg_…: AUTH operator only, exact Connect admin token audience and active auth_operators record. Recent 20 reports or exact reference, scoped to selected app, at most 48 server stages each. No public reference-read endpoint exists.

Application/ticket/upload require an active registered app and exact Origin from its registered redirect origins. The explicitly configured AUTH_ORIGIN is additionally allowed only on these diagnostic endpoints so central first-party diagnostics stay bound to the selected real app. Missing Origin is accepted only for GET application lookup when request URL origin equals configured AUTH_ORIGIN and Sec-Fetch-Site is same-origin. Arbitrary query/Host origins never define this exception. These tickets cannot authenticate, change policy, grant access or read reports.

The request body is capped while streaming at 12,288 bytes even without Content-Length. Report schema_version is 1; only observations/browser/platform fields are accepted. At most 16 observations and four acknowledged uploads per ticket. Probe enums: site_ping, auth_ping, sdk, application, token, me, site_session, page_navigation. Outcome enums: ok, http_error, timeout_or_cors, cancelled, unavailable. Durations are integer 0–120000ms, HTTP status is null or integer 100–599. Optional ping timing accepts exactly dns_ms/connect_ms/tls_ms/ttfb_ms, each null or positive integer <=120000; non-ping reports cannot attach timing values. Unknown fields are rejected.

Capabilities are cryptographically random and stored only as SHA-256 hashes in D1, bound to app/origin/expiry. Issuance uses persistent hourly guards: six per requesting network, 300 globally. Only hashed network guard keys are retained. Global guard is checked first to bound address guard rows under random-address abuse. Per-app report history is capped at 200, reports/stages retain seven days, expired hourly guards are removed. Daily configured cron and new ticket/operator reads perform cleanup.

## Server traces

Migration 0015 adds diagnostic_reports, diagnostic_stages, diagnostic_rate_guards and a nullable oauth_requests.diagnostic_ref. It stores no OAuth state or code in diagnostic tables; reference stays in the existing OAuth request row.

Only explicit diagnostic sessions add trace lookups/writes. Stages: authorize, discord_code_exchange, discord_identity, discord_member, membership_db, policy, code_creation, session_creation, token, me. Statuses: ok, denied, error. Measurements originate at AUTH and are labeled trusted; uploaded browser observations are untrusted. Network metadata is limited to source, ASN, asOrganization, colo and CF-Ray, never IP. Sources distinguish browser_auth, oauth_navigation and site_backend; a site's /me backend network is not the end user's ISP.

Tracing uses optional wrappers that preserve return values/errors of core authentication operations. Persistence is asynchronous best effort with a three-second continuation bound and a maximum of 16 stages per request/48 per ticket. Persistence failure does not change success or denial. OAuth code exchange is never retried.

## Official gate and upgrade

Only /__nakwol/diagnostics and /__nakwol/diagnostics/ping are explicit public operational exceptions; they enforce configured origin and never forward to ASSETS. GET/HEAD only, Range rejected. All other HTML/JS/CSS/JSON/images/fonts/downloads stay protected under GET/HEAD/Range. No diagnostic calls/persistence are added to the 300-asset authorization lease path.

Installed gates require normal Connect 0.7.3 protect update, build and deployment. Generated Workers and Pages inline the same runtime into their existing generated login module; custom hosts consume the official package. Central route/admin/Embed updates apply when AUTH is eventually deployed. Migration must precede the updated Worker. Daily cleanup cron is included in Worker configuration. None of these deployment/publication actions were executed here.
