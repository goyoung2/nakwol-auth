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

## Administrator diagnosis and recovery

- Extend the existing operator card and `field`, `actions`, `event-row`, `muted`, `error-text`, `el()` primitives. No new palette or motion.
- Discord ID or support trace → actual decision and role freshness → reported runtime and last receipt → central/token/site session boundaries → explicit action.
- Preview shows scope and affected active site-session count. Commit requires confirmation; a lost response reuses its idempotency key. Changing app invalidates pending screen responses.
- Grant expiry is explicit. Deny, clear deny, grant withdrawal and global reauthentication are separate labeled controls.
- Applied, pending, failed, published and observed use text labels; observed never means all users are online or all gates upgraded. Missing runtime/control-profile evidence is unconfirmed.
- Recovery code is shown once in a password-style field, cleared on navigation, never put in a URL or local storage. The separate recovery page has no protected product content and grants no data access.
- Controls have associated labels; result areas use polite live regions. Reuse account palette, 720px column and 44px controls on the separate recovery page.

## Service owner users

- Reuse Connect content-card, form-grid, field, event-row, actions, ghost and primary primitives. Keep current palette and responsive breakpoints.
- Service selection → state/search → paginated minimum identity list → selected user details → reason and confirmed app-scoped action. Empty, loading, rejected, observed and preregistered are distinct.
- Do not label last observation as online. Show observation receipt/delay, retention and unsupported gates; never expose central roles, sessions or secrets.
- Invalidate responses on service/user switch. Failed response can retry the same operation key. Confirmation names app, Discord ID and action. Deny/clear, grant withdrawal and relationship deletion are separate.
- Labels, native keyboard controls, polite result region; hide workspace until owner API authorizes it.

## Service presentation editor and renderer (D03)

The owner console reuses Connect content-card, form-grid, field, actions, ghost and primary. Policy, user management and presentation are separate navigation destinations. Draft, published revision and retained publication history are labeled separately; previews never claim real access authorization.

Presentation screen tokens: dark background #0b1020, card #111a2b, text #f1f5f9, muted #a6b3c7, action #5865f2. Light/system-light: background #f6f3eb, card #ffffff, text #182235, muted #475569, same action. Custom six-digit colors require text/background, text/card, muted/card and white/action contrast >=4.5. Radius 8/12/16/24px, size14/16/18px, headings20px, body14px, gaps8/12/16/20/24px. Logos64x64; card image432x120, object-fit cover; card width480px. Safe-area padding and44px controls; visible keyboard focus. No motion is required; reduced-motion disables presentation transitions/animations. Arbitrary CSS/HTML/SVG is never a token.

Checking has one runtime-owned label after250ms and retry/recovery after8s. Configured brand copy supplements login/denied/unavailable; it never replaces real status. Inline follows document flow; sticky occupies a slot and tracks its containing block; fixed uses the selected corner and safe-area margins. Integrators choose a data-nakwol-widget container for inline/sticky. Hidden affects identity widget only; service content gates and recovery screens remain. Preview iframe375px reproduces mobile layout without loading any protected app bundle.

## Installation and reconfiguration wizard (D04)

Reuse the Connect owner-console tokens and native 44px controls. Service selection, hosting, private state preview, effective policy, baseline diff, installation, and verification remain one flow. Steps use aria-current; feedback uses a polite live region. Saved central metadata never implies local build, deployment, anonymous blocking, or authenticated acceptance. Unsaved design/policy changes must not produce a successful checkpoint message. One-delivery server secrets use a masked field, explicit copy, and navigation cleanup; they never enter browser storage or export JSON. Unsupported hosts show server-protection alternatives, never Embed-complete.

Same-app new installation starts a fresh setup ID and zero expected version while preserving existing setup and credential. Credential receipt ID and origin identify the explicit revoke/replace target; reason, native confirmation and recent administrator authentication precede revocation. Replacement issues a new secret once from a new setup. Installation and verification explain Secret deployment, normal login acceptance and separate closure checks for the old origin, previews and original storage.

Service-policy save retains the returned operation/control receipt in the current console session. App-scoped refresh separates accepted, published and observed timestamps; absent timestamps and runtime/control-profile evidence remain unconfirmed. A single control observation never means every gate or user applied the policy. Global publication counts describe the returned batch attempt and do not attest service observations. Existing app metadata forms show status read-only; audited operator lock/unlock controls own changes to existing status.
