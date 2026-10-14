# AUTH 0.2.7: fewer database round trips and operator recovery

Status: deployed to Cloudflare and Vercel as AUTH0.2.7.

## Evidence and bottleneck

The actual Hono handlers, HTTP D1 adapter and local D1 were executed before/after with 150ms added to each database RPC and fixture Discord responses. This isolates database waiting; it is not an end-user connection measurement. Baseline source cd92db5; benchmark migration parsing was repaired to support existing SQL triggers before baseline execution. One full sequence per revision; no statistical latency claim.

| Stage | DB RPC before → after | Elapsed ms before → after |
|---|---:|---:|
| authorize-no-session | 2 → 2 | 352.7 → 340.1 |
| discord-callback | 10 → 7 | 1532.6 → 1028.2 |
| browser-token | 4 → 4 | 682.5 → 700.5 |
| browser-me | 3 → 1 | 345 → 164.9 |
| gate-session-me | 3 → 1 | 347 → 168.8 |
| protected-html | 0 → 0 | 0.9 → 1 |
| post-page-browser-me | 3 → 1 | 334.9 → 166 |
| 300-protected-images | 0 → 0 | 66 → 81.4 |
| authorize-existing-central-session | 6 → 6 | 1015.4 → 1006.3 |

Production baseline from the Cloudflare test site's diagnostic login: authorize313ms, policy41ms, code creation78ms, token223ms, me102/88ms. Another retained diagnostic had me2670ms (one observation), so this is variation, not proof of an ISP cause. Actual browser protected300 images: all300 and JSON succeeded, me0 calls, image total1200.7ms, medianTTFB125.5ms, p95TTFB227.7ms. Gate0.7.5 on that existing test site.

## Implementation

- Callback request and registered app fetched in one joined query. Redirect validation unchanged.
- Successful callback code, central session and request deletion committed in one D1 transaction. Neither credential can survive a failed batch. Code/session trace stages now overlap over that same transaction; do not sum them.
- /me combines app, token and member-policy snapshot in one database request. Expiry, revocation, client binding, user/app status, reauthentication cutoff, roles and manual grants remain checked. Admin/lab policies may require an additional privilege read. No policy cache added.
- Token redemption still checks current policy and PKCE; gate still validates the access token independently. Those checks belong to separate security boundaries and were retained.
- No timeout, lease, session lifetime, static cache or fail-closed change. Connect0.7.7 and SDK0.3.4 unchanged; no npm release or consumer reinstall needed for this central change.
- Includes denied-user support list, row grant, optional memo with automatic audit (cd92db5).

## Verification

New real-D1 tests cover expired/revoked/cross-app tokens, wrong origin, disabled identity/app, reauthentication, and transactional rollback. Existing /me database budget strengthened from at most3 to exactly1. Existing auth/gate tests preserve no-cookie/wrong-cookie/member, replay, role and generated protection contracts. Runtime version test updated to0.2.7.

Rollback: deploy previous stable source5bdf799ecb07bef418ce3cd7a0d1cebb873ba709 (AUTH0.2.6) to both hosts. No migration, secret, or SDK changes.

## Production verification

- Source bda5667420e73ee05c0ef5631a68b8c023cd1b10; implementation902eb89, operatorUIcd92db5; PR264–266.
- CI38496550244:299 auth/gate tests,26 Vercel tests,22 release tests passed; typecheck/bundles/managed smoke passed.
- Cloudflare deployment38496943758 succeeded. Vercel production eat956oo9 deployed, public alias returns0.2.7. Anonymous me and issues API401 on both.
- Browser diagnostic SSO sequence, actual server stage ms (two me calls per sequence): CF me102/88 →46/68, token223→222, authorize313→445; Vercel me63/54→25/23, token132→133, authorize225→213. Samples are observations, not percentile estimates; unmodified stages vary and CF authorize did not improve.
- Both test sites: authenticated300/300 images and JSON, centralme0. CF after image total644.9ms and medianTTFB59ms; VC after650.6ms and57ms. Browser cache/connection state differs; do not attribute image-time variation to this central change.
- protect verify custom:12/12 checks per host (root and2 observed image URLs, GET/HEAD/Range/invalid-cookie), all passed. Initial default invocation lacked a consumer manifest; custom invocation avoids confusing the AUTH checkout with an installed consumer.
- CF real operator UI loaded25 denied identities for the affected encyclopedia with18 eligible direct-grant buttons and no query error. No real user grant was changed.
- Vercel baseline first ping had2039ms TLS setup and2822ms total; later ping382ms. This illustrates a separate transport contribution, not an ISP attribution or a measured effect of the DB optimization.
