# Account page

`/account` is an ordinary user's profile, membership check, and login recovery page.

- One column, maximum 720px; 20px side gutters (16px on mobile).
- Existing AUTH dark palette: background #0b1020, surface #111a2b, text #f1f5f9, muted #a6b3c7, border #29364b, action #5865f2.
- Section spacing 16–24px, cards radius 16px, buttons 44px minimum height, visible keyboard focus.
- Profile → last confirmed membership → explicit Discord recheck → previously used services → logout → collapsed support details.
- Membership is the last OAuth observation, not live presence or a guarantee of service access. Manual service grants do not turn someone into a season3 member.
- Account/client identifiers and policy details belong in support details. Existing account and permission deep links remain valid.
- Never show deck/favorite placeholders before those capabilities exist.
- Recheck clears only this browser's central SSO session through a bearer-protected same-origin POST, then uses the pinned official SDK's PKCE login. It does not revoke other devices or service tokens. Global logout is separate and confirmed.

## Access recovery entry

- Common failure screens offer a separate account recovery link; never automatically send users away from the original error.
- `/account?client_id=...&recovery=1` shows the registered service name and an explicit return button.
- Return targets come exclusively from stored application redirect URIs (HTTP(S), no credentials). Query-supplied return URLs are ignored; disabled/unknown apps receive no return target.
- Only the client ID and a 30-minute timestamp survive OAuth in session storage. No access token or arbitrary return URL is transported between services.
- Verified account diagnostics distinguish role refresh from administrator-only action. The recovery UI does not grant access or change service policies.
- Central Embed updates apply on reload. Generated server login pages require Connect 0.6.1 protection regeneration and redeployment; custom consumer error pages must add the documented link themselves.

## Administrator deployment reports

- Reuse `/admin/apps`' existing `content-card`, `section-head`, `event-row`, `muted`, `error-text`, `ghost` and `el()` primitives. No new palette or layout system.
- Selected app: latest reported runtime and installed version, receipt time, then newest-first verification history (100 retained). Use text labels as well as existing success/error colors.
- Empty, loading and API-error states are distinct. Never present missing reports as a healthy deployment. Reports are publisher observations, not central attestation.
- Switching apps invalidates pending responses; render report values through textContent only. Refresh is keyboard accessible, results use a polite live region.
- This is an operator surface; do not add deployment details to ordinary users' account page.

## User-initiated AUTH diagnostics

- Central and official gate use the existing AUTH dark palette, 720px column, 16px mobile gutters, 16px cards and 44px controls. Shared runtime and markup live in Connect's server diagnostics module.
- Start/retry, progress, cancel, completed observations, local/server reference, upload status, copy/download and explicit diagnostic login are separate states. Buttons never rely on color alone; progress and receipt status use polite live regions.
- Technical privacy/retention copy is collapsed in details. The selected registered service name uses textContent. Central has a registered-service link; diagnostic login runs on the service's registered callback origin.
- Operator reports reuse content-card, section-head, event-row, muted/error-text and el(). App switch invalidates pending results. Trusted server timings and untrusted browser observations have separate headings; every network sample states its observation source.
- DNS/TCP/TLS/first-response timing is optional for owned public ping endpoints only. Reused or inaccessible setup metrics are null and display as unobserved.


## Named membership qualifications

- `/admin/roles` manages named qualifications mapped to manually entered Discord role IDs; bot access is optional. Renaming, remapping or disabling applies to every app referencing the qualification.
- `/admin/apps` selects qualifications and ANY/ALL directly below app settings. This panel saves separately and shows the current legacy/custom mode. App switching invalidates pending responses; names and IDs render as text.
- Custom qualification selection is available only for member policy. Empty, unknown and disabled selections are rejected. Admin policy remains separate.
- Explicit restore returns to the existing season3 plus supplementary-role requirements. Existing supplementary-role APIs reject writes while custom selection is active.

## Developer service qualification settings

- `/developer/apps` reuses the account page's 720px shell, dark palette, 16px cards, 44px controls, system typography and 520px mobile breakpoint. App selection, current policy, eligible qualification checklist and save form follow the user's decision order.
- Operators explicitly publish each qualification with “개발자 선택 허용”; new and existing records default to unpublished. Disabling publication does not silently rewrite app selections.
- Native labelled select, radio/checkbox controls and fieldsets remain keyboard accessible. Loading, empty, non-member, unavailable-selection, error and saved states are explicit; status is a polite live region. No motion is required.
- Developer forms operate on owned apps only, offer ANY/ALL and legacy restore, and preserve the selected client ID across authentication. Missing published IDs appear as unavailable and cannot be silently dropped on save. Switching apps or refreshing invalidates stale responses.
- QA uses the real developer page as the primitive/state harness. Browser verification covers narrow mobile width and the app-selection/save flow; no additional framework or global redesign is introduced.

## Discord callback waiting

- Reuse the account palette, 720px shell, 16px cards and 44px links. No external assets on the callback page.
- An indeterminate progress bar and elapsed seconds describe waiting, never invented completion percentages. After 3 seconds show a delay explanation; after 15 seconds explain that verification is still running. Reduced motion uses a static track.
- Success navigates to the registered service. Failure stops the indicator and exposes a service return link when available, plus account recovery. Never automatically replay a one-use Discord code.
- Render the public waiting page before database or Discord work. Keep callback parameters only in page memory and remove them from browser history. Responses are no-store and no-referrer with nonce CSP.

- Official gate and Embed also use native indeterminate progress while authentication is pending, a polite delay explanation after 3s, and stop/hide progress on success, anonymous result or error. They retain their existing page palettes.
