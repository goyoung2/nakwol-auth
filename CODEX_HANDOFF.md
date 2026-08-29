# CODEX HANDOFF — NAKWOL AUTH / CONNECT / DATA

Last updated: 2026-08-29
Repository: `goyoung2/nakwol-auth`

## Read this first

Codex가 이 저장소에서 작업을 시작할 때 다음 순서로 읽는다.

1. `CODEX_HANDOFF.md`
2. `BRANCHING.md`
3. `DATA.md`
4. `CONNECT.md`
5. 가장 최신 `docs/releases/*`
6. 현재 작업과 관련된 `docs/superpowers/specs/*` 및 `docs/superpowers/plans/*`

## Authoritative branch model

정상 개발 흐름은 다음 하나다.

```text
feature/fix/chore/docs -> dev -> main -> stable -> component release
```

- `dev`: 개발 통합
- `main`: release candidate
- `stable`: production

일반 작업은 반드시 최신 `dev`에서 새 task branch를 만든다. 과거 feature/ops/release 실험 브랜치를 새 작업의 base로 사용하지 않는다.

Repository default branch is now `dev`. GitHub UI와 새 작업의 기준도 `dev`로 맞춰져 있다. `dev`, `main`, `stable`은 모두 long-lived branch이며 항상 보존한다.

## Current production DATA golden

- DATA 0.8.0
- schema 3
- production origin: `https://nakwol-data.sepsd21.workers.dev`
- Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
- v0.8 release merge commit: `509b74259891a54adf81cef29a0a3d84f2d01b43`
- exact deploy trigger commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- production workflow: `33051511909`
- golden documentation commit: `4af1635b08c0b69c1f952ae58618c506cb747855`
- finalized release record commit: `ec9405872b9fe4d60c763260bb23b724d31b6c56`
- release record: `docs/releases/2026-08-27-nakwol-data-v0.8.md`

Production verification for v0.8:

- 70/70 tests
- typecheck green
- Worker bundle green
- existing exact D1 confirmed
- migration `0003_equipment_options_v08.sql` applied
- Registry UPSERT/count gate green
- health HTTP 200 / schema HTTP 200 on first smoke attempt
- marker `NAKWOL_DATA_DEPLOY_OK`

Registry production counts:

- generals 209 / enabled 140
- tactics 1077
- equipment templates 134
- generic stat types 281
- formations 8
- warbooks 442
- canonical equipment skill traits 106
- canonical equipment effect traits 74
- canonical applicability 0

## Formal GitHub Release baseline

The first formal component-prefixed release exists:

- tag/name: `data-v0.8.0`
- GitHub Release ID: `378361577`
- exact target commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- release workflow: `33157010443`
- release job: `98802084828`
- draft: false
- prerelease: false
- notes source: `docs/releases/2026-08-27-nakwol-data-v0.8.md`

The release target is intentionally the exact commit that performed the verified production deployment, not a later documentation-only commit.

## Important v0.8 safety boundary

`canonical applicability` is intentionally **0**.

The user will provide authoritative weapon/mount trait applicability data later. Until then:

- do not infer weapon/mount applicability from names, descriptions, native ID ranges, or missing observations;
- do not convert observed runtime combinations into a complete possibility rule;
- equipment trait mutation remains evidence-gated and safely closed in production without canonical applicability rows;
- generic `game_stat_types` 281 rows are not an equipment base-stat option catalog;
- do not open `user_equipment_stats` writes until authoritative option subset/ranges exist.

## Permanent data principles

- User-owned generals and tactics are permanent account assets.
- Equipment instances are account-owned; template is immutable after creation.
- Decks may contain planned/unowned general/tactic Registry references.
- Deck snapshots are immutable historical JSON.
- Registry reseeding is UPSERT-only; never DELETE/TRUNCATE user data.
- Never invent unsourced combat/game legality rules to make validation look complete.

## Current API/runtime boundaries

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

DATA verifies caller identity through NAKWOL AUTH `/me` and must not directly depend on AUTH D1.

AUTH origin:

`https://nakwol-auth.sepsd21.workers.dev`

DATA origin:

`https://nakwol-data.sepsd21.workers.dev`

## Verification commands

Repository root (AUTH / Connect):

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
```

DATA:

```bash
cd services/data
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run bundle
```

Before claiming any release complete, run the full relevant suite on the exact final commit and inspect workflow logs rather than relying on an earlier run.

## Release and deployment rules

- Production deploy/publish automation belongs to `stable` only.
- Normal promotion: `dev -> main -> stable` by PR.
- Release tags use component prefixes: `data-vX.Y.Z`, `connect-vX.Y.Z`, `auth-vX.Y.Z`.
- Release is created only after production smoke succeeds.
- `ops/release.json` is the auditable release descriptor.
- DATA production golden docs are changed only after actual production evidence is green.
- After a release has been created, the descriptor should return to `enabled:false` during normal branch synchronization; never leave a new release request armed accidentally.
- Automatic production-capable stable workflows must pass `scripts/verify-stable-promotion.mjs` before any deploy/publish/release action.
- Manual production workflow dispatch is an explicit operator override but must select the `stable` ref.

## Hotfix rule

Emergency only:

```text
stable -> hotfix/* -> stable -> main -> dev
```

A hotfix requires a regression test, full verification, production smoke, then synchronization back to main/dev.

## Historical branch warning

The repository currently contains historical branches such as:

- `feature/nakwol-connect-v0.1`
- `feature/nakwol-connect-v0.2`
- `feature/nakwol-connect-v0.2-agent-cli`
- `feature/nakwol-connect-v0.3-data-auto`
- `feature/nakwol-data-v0.1-foundation`
- `feature/nakwol-data-v0.2-registry`
- `feature/nakwol-data-v0.4-generals-roster`
- `feature/nakwol-data-v0.5-tactics-roster`
- `feature/nakwol-data-v0.6-equipment-instances`
- `feature/nakwol-data-v0.7-decks`
- `feature/nakwol-data-v0.8-equipment-options`
- `handoff/verify-independent-auth`
- `ops/production-smoke-v02-final`
- `ops/verify-cloudflare-token-ci`
- `ops/verify-connect-production`
- `release/npm-nakwol-connect`

They are **non-authoritative historical refs** after governance migration. Do not branch from them, merge them, or treat their unmerged commits as required work without a fresh comparison against `dev` and an explicit new plan.

Stale PR #5 was explicitly renamed `[ARCHIVED]` and closed. It is historical evidence only.

## Repository governance active in code/CI

The following repository-level controls are implemented in committed workflows:

- `Repository Governance` validates PR source/base promotion paths.
- `quality-gate` runs full AUTH/Connect and DATA verification on PRs to `dev`, `main`, and `stable`.
- AUTH/Connect production deploy triggers from `stable` only.
- DATA production deploy/bootstrap triggers from `stable` only.
- npm publish trigger uses `stable` only.
- production-smoke PR path targets `stable` only.
- governance-only test/guard changes are excluded from AUTH production deployment path filtering.
- component release creation is stable-only and requires an explicit audited release descriptor.
- production-capable stable push workflows fail closed unless the current SHA is the exact merge commit of an allowed PR.

## GitHub Free/private governance checkpoint

The repository intentionally remains **private on GitHub Free**. Native Branch Protection for private repositories is therefore unavailable and is not active by design.

Verified live repository state before the final Free/private stable promotion on 2026-08-29:

- default branch: `dev`
- delete merged head branches: currently enabled and **must be switched off before `main -> stable` is merged**
- `dev` Branch Protection: unavailable / not active
- `main` Branch Protection: unavailable / not active
- `stable` Branch Protection: unavailable / not active

Required target setting for this governance model:

- **delete merged head branches: disabled**
- `dev`, `main`, `stable` are preserved as long-lived branches

The repository-wide automatic head-branch deletion setting is unsafe here because `main` itself is the head branch of normal `main -> stable` promotion PRs. With no paid Branch Protection/Rules available to exempt `main`, do not merge a stable promotion while that repository setting remains enabled. Disposable task branches are cleaned separately when appropriate.

The previous paid-plan branch-protection bootstrap (`scripts/apply-repository-governance.mjs`, `.github/workflows/apply-repository-governance.yml`, `REPO_ADMIN_TOKEN`) is retired. Do not recreate it unless the repository deliberately moves to a plan that supports private-repository Branch Protection.

Because GitHub Free cannot reject a direct push to a long-lived private branch, the operational rule remains strict: humans and agents must not direct-push `dev`, `main`, or `stable`. The production blast radius is additionally reduced by the stable promotion guard:

- deploy/bootstrap/npm: only exact `main -> stable` or `hotfix/* -> stable` PR merge commits are accepted on automatic push;
- component release: only exact `release/* -> stable` PR merge commits are accepted;
- manual production workflow dispatch requires ref `stable`.

This is not a substitute for native Branch Protection: it cannot prevent or undo a bad direct push. It does prevent an accidental stable direct push from automatically becoming a production deploy, npm publish, or component release.

## Do not do these

- do not develop directly on `main` or `stable`;
- do not direct-push long-lived branches;
- do not force-push long-lived branches;
- do not enable repository-wide automatic merged-head deletion while `dev/main/stable` are unprotected long-lived branches;
- do not deploy production from `dev` or `main`;
- do not bypass the stable promotion guard;
- do not change production golden before smoke evidence;
- do not delete/truncate Registry or user-owned data during reseed;
- do not invent game rules or equipment applicability;
- do not silently reuse a stale feature branch because its name looks relevant;
- do not bypass failing CI by weakening tests or removing safety gates.

## Next DATA work when evidence arrives

1. Import authoritative weapon/mount canonical applicability supplied by the user.
2. Recover authoritative equipment base-stat option subset and numeric ranges.
3. Promotion-item Registry.
4. `deck_settings` formation/warbook model and public API.

Until step 1 evidence is supplied, move to other work rather than guessing applicability.
