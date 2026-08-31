# NAKWOL AUTH UX v1 — Resume Handoff

Date: 2026-08-31
Repository: `goyoung2/nakwol-auth`
Working branch: `feature/nakwol-auth-ux-v1`
Authoritative base: `dev` @ `fd0be82353393e873747573d93051191165d133b`

## Why this file exists

This document restores the exact continuation point for NAKWOL AUTH after the prior ChatGPT/Codex work was interrupted. It is a recovery override for the UX v1 implementation phase.

The approved UX design and implementation plan already exist and are authoritative. Runtime UX implementation has **not** started yet. The repository advanced after those documents were written through NAKWOL Connect v0.4 / NAKWOL DATA v0.9 production release, so new implementation must start from the latest `dev`, not from the older planning commit or a historical feature branch.

## Recovered user intent

The last approved AUTH direction was:

1. keep the current Discord OAuth + PKCE/SSO security model intact;
2. replace the test-like always-visible auth widget with a service-native compact Identity Menu;
3. add a user-facing NAKWOL Account Center at `/account`;
4. add a controlled verification/diagnostic surface at `/lab`;
5. ship Web SDK v0.2.0 alongside immutable v0.1.0;
6. fully regression-test authentication before promotion;
7. promote through `feature -> dev -> main -> stable`, production-smoke, then create `auth-v0.2.0`;
8. only after AUTH v0.2 is proven in production, apply the separate siege-calculator reference integration plan.

## Authoritative design and plan

Read these before editing runtime code:

- Design: `docs/superpowers/specs/2026-08-29-nakwol-auth-ux-v1-design.md`
- Core implementation plan: `docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1.md`
- Consumer/reference plan: `goyoung2/siege-calculator` → `docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1-siege-integration.md`

Merged planning history:

- PR #36 — `Document NAKWOL AUTH UX v1 design`
- PR #37 — `Document NAKWOL AUTH UX v1 implementation plan`

No later PR implements the AUTH UX runtime. Therefore Task 1 in the implementation plan is still the correct first implementation task.

## Current repository/runtime state recovered from GitHub

Long-lived branch model remains:

```text
feature/fix/chore/docs -> dev -> main -> stable -> component release
```

Current refs at recovery time:

- `dev`: `fd0be82353393e873747573d93051191165d133b`
- `main`: `cfd333579a3115871e79bd3e21564eff8d9d6209`
- `stable`: `903d860e7c0395be59d36bdb6900e27ba39d18b1`

`main` has only promotion-history commits beyond `dev` and no file-content delta. `stable` differs from `main` only by the completed npm publish flag for `nakwol-connect@0.4.0`. Do **not** merge stable back merely to start this feature.

Actual component versions at this recovery point:

- AUTH root package: `0.1.0` — UX v0.2 runtime is not implemented yet.
- NAKWOL Connect CLI: `0.4.0`.
- NAKWOL DATA Worker: `0.9.0`, schema remains `3`.

Late production work after the UX plan:

- PR #39 — DATA OpenAPI / Connect v0.4 discovery → `dev`.
- PR #40 — promotion `dev -> main`.
- PR #41 — DATA-first production release-order gate → `dev`.
- PR #42 — promotion `dev -> main`.
- PR #43 — `Release Connect v0.4 and DATA v0.9` → `stable`.
- PR #44 — publish `nakwol-connect@0.4.0` → `stable`.

Production evidence:

- release merge: `55ec04ba7484b813ec694978557a28c14467645e`;
- DATA deployment workflow `33255315017`: success, including v0.9 verification, D1 migration/seed/count gate, Worker deploy, production verification;
- AUTH deployment workflow `33255315038`: success, including root tests/typecheck/bundle, AUTH D1 migration, required-app verification, **wait for live DATA v0.9 contract**, Worker deploy, Connect v0.4 production verification;
- npm publish workflow `33255544407`: success for `nakwol-connect@0.4.0`.

A direct Cloudflare inventory check on 2026-08-31 also confirmed that the production `nakwol-auth` and `nakwol-data` Workers and both matching D1 databases still exist. Their Worker modification timestamps match the successful 2026-08-29 release window.

## Important stale-document warning

At recovery time, these documents still describe the previous release baseline:

- `CODEX_HANDOFF.md` still says DATA 0.8 production golden;
- `DATA.md` still says DATA 0.8 production golden;
- `CONNECT.md` still has a Connect v0.3 heading.

Do **not** downgrade code or production assumptions to those stale version labels. The package manifests, PRs, workflows and production evidence above are newer and authoritative for current runtime state.

Updating those general handoff/golden documents should be done deliberately as part of the next documentation/release-maintenance pass. Do not mix a broad historical rewrite into the first UX implementation commit.

## Compatibility check against the old UX plan

The UX plan was merged at `da15dd48a856c34e615f63fd4977c8fae3a0d7ee`. Comparing that commit to current `dev` shows later changes are concentrated in:

- DATA/OpenAPI implementation;
- Connect CLI/runtime discovery;
- DATA/AUTH deployment workflows;
- DATA-first production ordering tests/guards.

The core UX plan targets were **not** modified in the intervening release:

- `src/sdk.ts`
- `src/sdk-entry.ts`
- `src/store.ts`
- `src/index.ts`
- root `package.json`

Therefore the approved UX implementation plan remains directly usable from current `dev`.

One new release constraint must be preserved: the production AUTH deploy now waits fail-closed for the required live DATA contract. Do not weaken, bypass or reorder that DATA-first gate while implementing AUTH UX v1.

## Locked UX v1 safety boundaries

Keep all constraints from the plan. In particular:

- never edit `src/assets/nakwol-auth-web.js.txt`; it is immutable Web SDK v0.1.0;
- create Web SDK v0.2.0 as a new immutable asset;
- preserve Authorization Code + PKCE(S256), state validation, exact redirect allowlists, app-bound tokens, `/me`, logout behavior and CORS boundaries;
- never expose raw access/CLI tokens, cookies, token hashes, Discord/Cloudflare secrets or PKCE verifiers;
- AUTH D1 and DATA D1 stay separate;
- AUTH must not read DATA D1 or invent/mirror DATA scopes;
- `/lab` diagnostics require admin or active Connect developer/operator privilege;
- connected-service history must be based on user-specific successful AUTH evidence, not mere app registration;
- legacy `mountNakwolAuthWidget` remains available;
- new integrations use `mountNakwolIdentityMenu`;
- do not modify `services/data/**` for this feature except running its verification suite;
- do not weaken repository governance, stable-promotion guards or DATA-first deploy ordering.

## Exact implementation restart point

Start at **Task 1 — Web SDK v0.2.0 + Compact Identity Menu** in:

`docs/superpowers/plans/2026-08-29-nakwol-auth-ux-v1.md`

Expected feature sequence:

1. Web SDK v0.2.0 + Compact Identity Menu.
2. Internal Account/Lab OAuth clients + route registration.
3. Evidence-backed Account Summary API.
4. Complete Account Center UI.
5. Privileged Lab access + safe diagnostics API.
6. Complete Auth Lab UI.
7. OAuth regression guards + AUTH version 0.2.0 + docs/release contract.
8. Exact-final-head review → PR to `dev` → promote to `main` → promote to `stable` → production smoke → `auth-v0.2.0` release.
9. Then and only then execute the separate `siege-calculator` integration plan.

Use TDD in the exact RED → implementation → GREEN order defined by the plan. Keep each task as a reviewable commit rather than collapsing the whole feature into one giant commit.

## Baseline verification before first code edit

In an isolated worktree checked out from this feature branch, run:

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run

cd services/data
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run bundle
```

If the clean baseline does not pass, investigate the baseline failure before attributing anything to AUTH UX work.

## Suggested local/Codex resume commands

```bash
git fetch origin
git switch feature/nakwol-auth-ux-v1
git pull --ff-only
```

For a separate worktree, follow the repository/agent worktree policy and branch from `feature/nakwol-auth-ux-v1`; do not create work from `main`, `stable`, or one of the historical feature branches.

## Definition of done for this recovery

The environment is considered restored when:

- this handoff exists in GitHub;
- `feature/nakwol-auth-ux-v1` starts from the recovered current `dev` baseline;
- a draft PR to `dev` is used as the persistent work surface;
- implementation begins from Task 1 of the already-approved plan;
- all later Connect v0.4 / DATA v0.9 / DATA-first release guarantees remain intact.
