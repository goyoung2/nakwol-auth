# Login incident hotfix — 2026-10-13

Status: implemented and locally verified; not yet deployed or published at report creation.
Base: stable dc6d994dd3e9dc677f1a903a2ae343a4b51455f5.
Versions: AUTH 0.2.2, Connect 0.7.4, browser SDK 0.3.3; DATA unchanged.

## Observations without an affected user ID

Read-only operating D1 aggregates at 2026-10-13T13:47:31Z: all 53 access-denied events in the last 24h were MEMBERSHIP_REFRESH_REQUIRED (39 nslg-battle-log, 9 nakwol-guide, 5 nakwol-battle-report). These are events, not unique users. Four invalid_client OAuth events preceded the already completed Discord-secret recovery. Three uploaded detailed reports belong to our benchmark apps, not reported KT users. Health 200 does not exercise D1.

The earlier paired benchmark preserved Vercel /me 5874ms and an expired-lease image burst with 28/300 HTTP503, eight gate/me calls. Those observations do not establish their cause or a KT routing fault.

## Fixes and unchanged security boundary

- Stale membership remains denied. Silent SSO returns login_required rather than actual access_denied and does not delete its central session. Explicit retry goes through Discord; no stale session can mint a code. /me returns401 with no user payload for freshness/reauthentication requirements. Actual missing roles/disabled users/apps/operator policy remain denied.
- /me reuses only its own application/user reads. Member requests with Origin perform10 DB calls, down from14; independent policy reads run concurrently. A denied SSO diagnosis is evaluated once instead of twice. No permission cache or TTL increase.
- New immutable SDK0.3.3 gives auth fetch a15s overall header/body deadline, caller cancellation and64KiB transient body limit, without automatic retries. Historical SDK assets retain their exact bytes. The mutable Embed selects0.3.3, bounds module import at7s and reloads when retry is clicked before a client exists.
- Official Connect login/runtime applies bounded auth fetch even without an opted-in diagnostic ticket. No-ticket requests add no diagnostic headers, report writes or network calls. Gate authorization, encryption, client/origin binding, GET/HEAD/Range protection, five-minute lease and24-hour membership freshness remain unchanged.

## Evidence

- Regression tests run against untouched operating source reproduce stale SSO access_denied, stale /me403, redundant application reads and the unbounded no-ticket fetch seam.
- Local full release suite:22 PASS. AUTH/Connect suite:243 PASS before final standalone Embed-retry test; the added retry test also PASS. Affected Data SDK tests pass after updating only their import substitution seam.
- RealD1 season/access-support/incident tests:26 PASS. SDK deadline tests cover headers/body stalls, cancellation, oversize responses, success and actual denial.
- Packaged managed-gate smoke0.7.4 PASS:pack/install/automate/npm-ci/build/update/live-HTTPS-status/verify.
- AUTH and Vercel typechecks PASS. Vercel adapter tests26 PASS after installing the standalone test project's locked Miniflare4 dependencies. Initial missing dependencies/incorrect reused Miniflare5 failures remain in ignored local logs.
- Cloudflare dry-run bundle PASS.

Ignored local evidence: .wrangler/login-incident/*.log. Aggregate operating evidence is in the original production checkout's ignored .wrangler/login-incident/production-stats-detailed.json. No secrets or affected-user data are included here.

## Rollout and remaining work

Central fixes and mutable Embed updates require deploying AUTH to both existing hosts. Historical pinned SDK modules are not rewritten. Installed generated gates need Connect0.7.4 protect update, build and redeploy; publish npm only after the new central SDK route is available. Keep current Discord secrets and shared D1 data during rollback; restore source dc6d994, never an obsolete secret.

The KT report still lacks a real client-side trace. Lease-expiry503 remains a separate incident requiring multi-isolate/bridge failure evidence and live regression verification. This hotfix is not proof that either issue is resolved.
