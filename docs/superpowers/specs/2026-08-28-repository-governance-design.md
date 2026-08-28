# NAKWOL Repository Governance Design

Date: 2026-08-28
Repository: `goyoung2/nakwol-auth`
Base main: `ec9405872b9fe4d60c763260bb23b724d31b6c56`
Current DATA production golden: `0.8.0 / schema 3`

## Goal

Codex가 저장소만 읽고도 안전하게 개발·검증·릴리스·운영 승격을 이어갈 수 있도록 `dev -> main -> stable -> release`의 명시적 승격 체계를 만든다. 현재 운영 중인 NAKWOL AUTH / Connect / DATA의 배포 안전성을 유지하면서, 실수로 개발 커밋이 production에 직접 배포되는 경로를 제거한다.

## Branch model

### `dev`

개발 통합 브랜치다.

- `feature/*`, `fix/*`, `chore/*`, `docs/*`는 기본적으로 `dev`에서 분기한다.
- 일반 개발 PR의 base는 `dev`다.
- CI는 필수지만 production 배포는 절대 실행하지 않는다.
- 여러 기능이 동시에 개발될 때 통합 검증 기준점 역할을 한다.

### `main`

릴리스 후보 브랜치다.

- 일반 기능 브랜치가 직접 들어오지 않는다.
- 정상 승격 경로는 `dev -> main` PR이다.
- full CI / release-contract 검증을 통과한 릴리스 후보만 존재한다.
- `main` push 자체로 production 배포하지 않는다.

### `stable`

현재 production 기준 브랜치다.

- 정상 승격 경로는 `main -> stable` PR이다.
- production Cloudflare 배포는 `stable`에서만 실행한다.
- production smoke가 성공한 상태만 유지한다.
- 배포 성공 뒤 해당 component release tag와 GitHub Release를 만든다.

## Normal promotion flow

```text
feature/* | fix/* | chore/* | docs/*
                  |
                  v
                 dev
                  |
          PR + integration CI
                  v
                 main
                  |
        PR + release validation
                  v
                stable
                  |
      production deploy + smoke
                  v
       component release/tag
```

## Hotfix exception

Production 장애처럼 `dev -> main -> stable`의 전체 승격을 기다릴 수 없는 경우에만 사용한다.

1. `hotfix/*`를 `stable`에서 분기한다.
2. 최소 수정 + 재현 테스트 + full CI를 수행한다.
3. `hotfix/* -> stable` PR로 병합한다.
4. production 배포와 smoke를 통과한다.
5. `stable -> main` 동기화 PR을 만들고, 이어 `main -> dev` 동기화 PR을 만든다.
6. hotfix도 새 component patch release로 태그한다.

직접 push, force-push, stable에서의 일반 기능 개발은 hotfix로 간주하지 않는다.

## CI policy

- 일반 PR CI는 `dev`, `main`, `stable` 대상 PR에서 동작해야 한다.
- AUTH/Connect와 DATA의 기존 test / typecheck / bundle 검증은 유지한다.
- DATA의 schema/Registry/release-contract 검증도 유지한다.
- production deploy workflow는 `stable` 외의 branch에서 자동 실행되지 않아야 한다.

## Deployment policy

### NAKWOL AUTH / Connect

기존 `.github/workflows/deploy.yml`의 production push branch를 `main`에서 `stable`로 변경한다. 코드 경로 필터는 유지한다.

### NAKWOL DATA

기존 `.github/workflows/deploy-data.yml`의 production trigger branch를 `main`에서 `stable`로 변경한다. `ops/data-deploy.flag` 방식과 exact D1 / migration / Registry count / smoke gate를 유지한다.

### Bootstrap

bootstrap은 일반 릴리스 경로가 아니다. 신규/복구 환경에서만 수동 또는 명시적 bootstrap flag로 사용하고 stable release 승격과 혼동하지 않는다.

## Release policy

이 저장소는 AUTH, Connect, DATA가 서로 독립 버전을 가지므로 단순 `v0.8.0` 대신 component prefix tag를 사용한다.

- DATA: `data-vX.Y.Z`
- Connect: `connect-vX.Y.Z`
- AUTH SDK/runtime가 독립 버전을 갖게 되면 `auth-vX.Y.Z`

현재 첫 정식 DATA GitHub Release는 `data-v0.8.0`으로 기록한다.

`data-v0.8.0`의 release target은 실제 production deploy를 수행한 commit `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`로 고정한다. 이후의 golden/release-record 문서 커밋은 release notes에서 별도 증거로 연결한다.

새 release는 production smoke가 성공한 뒤에만 만든다. 실패한 RC에는 release/tag를 만들지 않는다.

## Branch protection target policy

`dev`:

- pull request required
- CI required
- force-push prohibited
- deletion prohibited
- external approval count 0 (solo repository)

`main`:

- pull request required
- CI required
- force-push prohibited
- deletion prohibited
- normal source branch is `dev`

`stable`:

- pull request required
- CI required
- force-push prohibited
- deletion prohibited
- normal source branch is `main`; `hotfix/*` only documented exception

The connected GitHub action surface does not expose branch-protection/ruleset writes, so repository code will contain a reproducible governance script/workflow for applying the desired rules with an admin-capable token. The handoff document must state whether those settings have actually been applied or are only codified.

## Historical branch cleanup

Merged historical feature/ops branches are not authoritative after this governance migration. `main`, `dev`, `stable` and active task branches only are valid bases for new work.

Because the connected action surface does not expose branch-ref deletion, stale branches that cannot be deleted programmatically here will be explicitly listed as archived/deprecated in the handoff. Codex must never branch from them.

Open stale draft PRs that no longer represent an active supported development path are closed with an archival note.

## Codex handoff contract

Create `CODEX_HANDOFF.md` containing at minimum:

- authoritative branches and promotion flow
- current production golden and runtime identifiers
- required first-read documents
- current component versions
- current deferred domains, especially equipment applicability/base-stat option evidence
- release/tag naming
- production deployment rules
- test commands
- prohibited actions: direct stable/main development, invented game rules, destructive Registry reseed, production golden changes before smoke
- stale branch warning

Codex should begin normal work from fresh `dev`, not from historical feature branches.

## Repository artifacts

Create or update:

- `BRANCHING.md`
- `CODEX_HANDOFF.md`
- `docs/superpowers/plans/2026-08-28-repository-governance.md`
- production workflows so deployment is stable-only
- PR/verification workflow branch filters so dev/main/stable are verified
- release automation capable of creating component-prefixed GitHub Releases after production evidence
- optional governance application workflow/script for branch rulesets

## Migration sequence

1. Complete governance docs/workflow changes on `chore/repository-governance-v1`.
2. Verify repo CI and review the diff.
3. Merge governance PR to current `main`.
4. Create `dev` and `stable` from the resulting governance main commit so all three start identical.
5. Close stale draft PR #5 with an archival explanation.
6. Create `data-v0.8.0` GitHub Release targeting the exact v0.8 deploy commit.
7. Apply branch rulesets if an admin-capable automation token is available; otherwise leave one explicit, reproducible admin action in the handoff.
8. Verify `dev`, `main`, `stable` refs and release metadata before Codex handoff.

## Success criteria

- `dev`, `main`, `stable` exist and begin from one identical governance baseline.
- production deploy workflows trigger only from `stable` (manual dispatch remains allowed where already intentional).
- PR CI covers all three long-lived branches.
- `BRANCHING.md` and `CODEX_HANDOFF.md` make the model unambiguous.
- stale draft PR #5 is no longer an active-looking development path.
- DATA v0.8.0 has a component-prefixed immutable release/tag path.
- any branch-protection limitation is explicit and reproducibly fixable, not hidden.
