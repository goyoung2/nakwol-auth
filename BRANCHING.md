# NAKWOL Branching and Release Policy

이 저장소의 장기 브랜치는 `dev -> main -> stable` 3단계 승격 모델을 사용한다.

## Long-lived branches

### `dev` — integration

- 일반 개발의 기준 브랜치다.
- `feature/*`, `fix/*`, `chore/*`, `docs/*`는 `dev`에서 분기한다.
- 일반 작업 PR은 다시 `dev`로 보낸다.
- CI는 실행하지만 production 배포/배포용 npm publish는 하지 않는다.

### `main` — release candidate

- 정상 진입 경로는 `dev -> main` PR이다.
- 릴리스 후보만 존재해야 한다.
- production Cloudflare 배포는 실행하지 않는다.
- 일반 feature/fix 브랜치를 직접 main에 병합하지 않는다.

### `stable` — production

- 정상 진입 경로는 `main -> stable` PR이다.
- 실제 production Cloudflare 배포와 production npm publish는 stable에서만 실행한다.
- production smoke를 통과한 상태를 운영 기준으로 삼는다.
- 실패한 release candidate를 stable의 production golden으로 기록하지 않는다.

## Normal flow

```text
feature/* | fix/* | chore/* | docs/*
                  |
                  v
                 dev
                  |
          integration PR + CI
                  v
                 main
                  |
       release-candidate PR + CI
                  v
                stable
                  |
        deploy + production smoke
                  v
       component tag / GitHub Release
```

## Branch naming

- 기능: `feature/<topic>`
- 버그 수정: `fix/<topic>`
- 저장소/운영 정리: `chore/<topic>`
- 문서 전용: `docs/<topic>`
- production 긴급수정: `hotfix/<topic>`
- release descriptor: `release/<component>-v<version>`

새 작업은 과거의 `feature/nakwol-data-v0.x-*`나 `ops/*` 브랜치에서 분기하지 않는다.

## Hotfix flow

Production 장애에 한해서 다음 예외를 허용한다.

```text
stable -> hotfix/* -> stable -> main -> dev
```

1. `hotfix/*`를 stable에서 만든다.
2. 증상 재현 테스트를 먼저 추가한다.
3. 최소 수정 후 full CI를 실행한다.
4. `hotfix/* -> stable` PR을 병합한다.
5. production deploy/smoke를 확인한다.
6. `stable -> main`, `main -> dev` 순으로 동기화한다.
7. component patch release를 만든다.

Hotfix라는 이름으로 direct push나 force-push를 허용하지 않는다.

## Pull request source policy

- base `dev`: `feature/*`, `fix/*`, `chore/*`, `docs/*`, 또는 hotfix 동기화용 `main`
- base `main`: 정상 `dev`, hotfix 역동기화용 `stable`
- base `stable`: 정상 `main`, 예외 `hotfix/*`, release 기록용 `release/*`

`repository-governance` CI가 이 source/base 관계를 검사한다.

## Production deployment

- NAKWOL AUTH / Connect: `.github/workflows/deploy.yml` — stable-only push deployment
- NAKWOL DATA: `.github/workflows/deploy-data.yml` — stable의 `ops/data-deploy.flag` 변경으로 배포
- DATA bootstrap: 복구/신규 환경용이며 stable-only flag 또는 수동 실행
- Connect npm publish: stable의 `ops/npm-publish.flag` 또는 의도된 수동 실행
- production smoke: stable 승격 경로에서만 사용

`main`과 `dev`에서 production을 자동 배포하는 workflow를 추가하지 않는다.

Production-capable stable push workflow는 `scripts/verify-stable-promotion.mjs`를 가장 먼저 실행한다. 자동 push에서는 현재 `stable` SHA가 실제 허용된 PR의 `merge_commit_sha`인지 GitHub API로 확인한 뒤에만 다음 단계로 진행한다.

- AUTH/DATA deploy, DATA bootstrap, npm publish: `main -> stable` 또는 `hotfix/* -> stable`만 허용
- component release: `release/* -> stable`만 허용
- `workflow_dispatch`: 명시적 운영자 실행은 허용하지만 선택한 ref가 반드시 `stable`이어야 함

따라서 실수로 `stable`에 direct push가 발생하더라도 production deploy/publish/release는 fail-closed로 중단된다.

## Release naming

이 저장소는 여러 component가 독립 버전을 가지므로 tag에 component prefix를 붙인다.

- DATA: `data-vX.Y.Z`
- Connect: `connect-vX.Y.Z`
- AUTH: `auth-vX.Y.Z`

Release는 production smoke 성공 이후에만 만든다. `ops/release.json`은 release 생성 요청의 감사 가능한 descriptor이며, `release/* -> stable` PR로만 활성화한다.

현재 DATA 첫 정식 release 기준은 `data-v0.8.0`이고 exact production deploy commit은 `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`이다.

## GitHub Free + private governance boundary

이 저장소는 **GitHub Free + private repository**로 유지한다. 이 조합에서는 native **Branch Protection**을 사용할 수 없으므로 `dev`, `main`, `stable`에 대한 direct push 자체를 GitHub 서버가 물리적으로 거부해 주지는 않는다.

2026-08-29 기준으로 무료 범위에서 적용된 repository setting은 다음과 같다.

- default branch: `dev`
- automatically delete merged head branches: enabled
- native Branch Protection: unavailable / not active by design

따라서 운영 규칙은 다음 방어층으로 구성한다.

1. 사람과 Codex/LLM은 long-lived branch에 direct push하지 않는다. 모든 정상 변경은 PR을 사용한다.
2. `Repository Governance`가 PR의 source/base 승격 경로를 검사한다.
3. `quality-gate`가 AUTH/Connect와 DATA 전체 검증을 수행한다.
4. production-capable workflow는 stable promotion guard로 허용된 PR merge provenance를 재검사한다.
5. component release는 별도 `release/* -> stable` PR provenance까지 요구한다.

이 구조는 Branch Protection과 완전히 동일하지 않다. direct push 자체를 되돌리거나 금지할 수는 없지만, 잘못된 stable direct push가 자동으로 운영 배포·npm publish·GitHub Release까지 이어지는 경로는 차단한다.

유료 플랜으로 전환하는 경우 native Branch Protection을 추가 방어층으로 다시 검토할 수 있지만 현재 운영의 필수 조건으로 취급하지 않는다.

## Golden rule

`stable`은 현재 운영 코드의 branch 기준점이고, component tag/GitHub Release는 과거 운영 릴리스의 불변 기준점이다. 문서에 production golden이라고 적기 전에 실제 production smoke 증거가 있어야 한다.
