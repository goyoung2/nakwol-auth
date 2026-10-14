# AUTH 0.2.7: fewer database round trips and operator recovery

Status: validated locally; production rollout pending.

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
