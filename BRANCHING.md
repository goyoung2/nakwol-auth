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

Hotfix라는 이름으로 직접 push나 force-push를 허용하지 않는다.

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

## Release naming

이 저장소는 여러 component가 독립 버전을 가지므로 tag에 component prefix를 붙인다.

- DATA: `data-vX.Y.Z`
- Connect: `connect-vX.Y.Z`
- AUTH: `auth-vX.Y.Z`

Release는 production smoke 성공 이후에만 만든다. `ops/release.json`은 release 생성 요청의 감사 가능한 descriptor이며, `release/* -> stable` PR로만 활성화한다.

현재 DATA 첫 정식 release 기준은 `data-v0.8.0`이고 exact production deploy commit은 `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`이다.

## Protection policy

장기 브랜치 `dev`, `main`, `stable`은 다음 정책을 목표로 한다.

- PR required
- required CI status checks
- force-push disabled
- branch deletion disabled
- external approval count 0 (solo repository)

관리 설정은 `scripts/apply-repository-governance.mjs`와 수동 GitHub Actions workflow로 재현 가능하게 관리한다. 실제 적용 여부는 `CODEX_HANDOFF.md`에서 반드시 구분해 기록한다.

## Golden rule

`stable`은 현재 운영 코드의 branch 기준점이고, component tag/GitHub Release는 과거 운영 릴리스의 불변 기준점이다. 문서에 production golden이라고 적기 전에 실제 production smoke 증거가 있어야 한다.
