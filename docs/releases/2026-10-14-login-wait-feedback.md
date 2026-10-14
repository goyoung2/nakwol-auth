# Slow authentication feedback and coordinated deadlines

Status: implementation and local validation; production promotion is recorded separately.

## Changes

- AUTH 0.2.6: a self-contained waiting screen is rendered before Discord callback processing. It shows indeterminate progress, elapsed time and a delay explanation after 3 seconds. The original validation handler supplies the result. Success preserves HttpOnly cookies and redirects to the registered application; failure provides recovery without replaying a one-use OAuth code.
- AUTH to Discord request budget: 5s → 20s, including body reading. Token exchange followed by parallel identity/member requests can take up to 40s; Vercel remains configured for 60s. These are product budgets, not an asserted industry standard.
- Central `/me`: 5.5s → 25s. Common gate upstream wait: 7s → 30s. Web SDK / browser session exchange / diagnostic login wrapper: 15s → 45s. SDK module import: 7s → 45s. Diagnostic measurement probes keep their independent short sample limits.
- Web SDK 0.3.4 preserves every published immutable SDK file; Connect CLI/common gate 0.7.7 uses the new SDK. Embed and official gate show delayed feedback while waiting, and stop progress on a terminal result.
- Callback browser transport has a 75s outer bound (including the client connection); it never retries the Discord code automatically. This is not a longer session or authorization lease.

## Security and compatibility

No role, session lifetime, one-hour authorization lease, fail-closed gate, binding, protected path or cache policy is relaxed. No polling or per-image AUTH traffic is introduced. The callback waiting page adds one same-origin request for an actual Discord callback, not for each asset. CSP nonce, no-store, no-referrer, and history cleanup protect callback parameters. Only the existing server handler may create sessions or supply registered return destinations.

Central callback changes apply to existing services without reinstalling. Updated `/connect/v1.js` picks up the new SDK on reload subject to its cache. Packaged/custom gates and sites pinned to an immutable SDK need their normal SDK update and redeployment; central deployment cannot rewrite their installed files. Connect: run `npx nakwol-connect@0.7.7 protect update`, review generated changes, then redeploy and `protect verify`.

## Local evidence

- Real workerd Discord transport regression preserved.
- Twelve-second token response succeeds with one exchange; stalled headers/body still time out and malformed roles fail closed.
- Browser callback: loading → delay feedback after 3s → navigation after a 9s response. Error: progress stops and recovery controls remain usable. 390px viewport had no horizontal overflow.
- Official gate browser harness: 9s bootstrap stays waiting with progress and delayed text, then displays login only after the anonymous result.
- Fixtures use delayed responses; this does not measure an affected KT subscriber's connection or prove that all KT incidents are resolved.
