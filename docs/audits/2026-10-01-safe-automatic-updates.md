# 안전한 자동 업데이트 구현·검증 기록

날짜: 2026-10-01. 기준 `c348f4e4d61caba2b2925b2c5689e0d1510696e9`.
구현 commit `e752c6330c66e9238b45bc6c71b369cb76b08821`.
브랜치 `feature/commercial-auth-foundation`.

## 결론

명시적 opt-in 패치 병합과 호스팅 독립 rollout/복구 코어를 로컬 구현·검증했다.
기존 서비스 설정, 인증 runtime, lease/cache 정책은 변경하지 않았다.
운영 배포·npm 발행·GitHub push/권한 설정·외부 소비자 사이트 수정은 수행하지 않았다.
네이티브 호스팅 adapter, 실제 GitHub mutation/권한, preview origin closure와 canary는 미검증이다.
상용 전체 출시 승인과 구분한다.

## 실제 작동 경로

`protect automate --auto-merge`는 기존 자동화를 덮어쓰지 않고, 검증된 정상본과
검토한 adapter 설정이 있을 때만 선택 workflow를 생성한다.
권한 있는 workflow는 default branch SHA에서 실행하며 PR 코드/artifact를 실행하지 않는다.
`update-pr`는 실제 GitHub run/PR/HEAD/파일/브랜치 보호/check app/job, npm 배포 integrity를
확인한 뒤 `mergePullRequest(expectedHeadOid)`를 한 번 실행한다. SDK 하나의 exact
patch만 대상이며 다른 체크/리뷰가 남으면 GitHub가 거부한다. 병합은 배포 성공이 아니다.

`rollout`은 현재 serving ID가 강하게 검증된 baseline과 일치하는지 확인하고,
현재 baseline의 익명 차단/정상 파일 hash도 새로 검사한다. candidate inventory와 로컬
bytes를 검증한 뒤 SHA-pinned Node adapter의 deploy를 호출한다. 새 배포도 전체 검사한다.
차단 실패, 항상401, 5xx 등 검증 실패 시 현재 배포가 정확한 이 operation인 경우만
이전 artifact로 복구한다. 복구 결과도 검증하며 새 릴리스/CI는 여전히 실패이다.
다른 배포를 발견하면 덮어쓰지 않는다. 자격 증명은 명시한 호스팅 변수만 child에 전달한다.

고정 origin 집합, owner adapter의 전체 배포 직렬화·compare-before-write가 전제이다.
provider 이름만 바꾼 실제 child-process 계약 fixture를 시험했다. 이것은
Cloudflare/Vercel/Netlify API의 실제 운영 배포 시험이 아니다.

## 독립 리뷰와 수정

새 컨텍스트의 `review_safe_automatic_updates` 읽기 전용 리뷰를 실행했다.
초기 판정은 **Request changes**였으며 다음 Important 5개와 check identity 보강을 반영했다.
이 기록은 별도의 최종 무결함 리뷰 판정을 주장하지 않는다. 각 수정의 실행 증거를 기록한다.

| 발견 | 수정 | 실행 근거 |
| --- | --- | --- |
| 검증 직후 PR HEAD 변경 경합 | 최종 mutation에 expectedHeadOid 바인딩; API 거부를 성공 처리하지 않음 | `head-red.log`, `final-targets.log` |
| PR-wide auto-merge가 이후 새 HEAD까지 자동 승인 | continuous enable 대신 exact-head 원자 병합으로 교체 | `ongoing-head-red.log`, `final-targets.log` |
| 기본 GitHub token으로 branch protection 조회 불가 | owner의 repository-scoped `NAKWOL_UPDATE_GITHUB_TOKEN` 연결; 최소 권한 문서화 | packed opt-in workflow 검증, 공식 API 권한 문서; 실제 token 미연결 |
| Windows 대소문자 alias로 비밀 환경 변수 전달 | canonical uppercase 비교, 중복·쿠키·reserved alias 거부 | `env-red.log`, 실제 child 격리 검사 `final-targets.log` |
| 배포 후 journal 저장 실패로 복구 미실행 | 저장 실패는 성공을 금지하면서 정확한 배포의 recovery를 계속 시도 | `journal-red.log`, `final-targets.log` |
| 다른 app의 동일 check 이름/skip 결과 인정 가능 | check suite GitHub Actions app ID와 branch required app 및 실제 job 성공 확인 | `check-identity-red.log`, `final-targets.log` |

추가로 1 MiB를 넘는 candidate 파일은 원격 verifier 한계 때문에 배포 전에 거부했다.
Windows 프로젝트 밖 report 경로 거부, 동시에 바뀐 외부 배포 보존도 실행했다.
이전 자동화 설정이 `protect update` 과정에서 사라지는 회귀는 재현 후 보존하도록 수정했다.

## 검증 범위

증거 디렉터리: `.wrangler/commercial/automatic-updates/` (ignored 로컬 실행 로그).

| 검증 | 결과 | 범위/로그 |
| --- | --- | --- |
| 전체 SDK `.mjs` 회귀 | 218/218 PASS | `package-suite.log`; 마지막 경계 테스트 2개 추가 전 전체 실행 |
| 최종 변경 영역 | 54/54 PASS | `final-targets.log`; portable rollout22, patch validation24, automate8 |
| 패키지 포장 + TypeScript | exit0 | `typecheck.log`; Connect0.14.0 tarball 생성, `tsc --noEmit` |
| 설치한 tarball의 기존 CLI | PASS | `packed-smoke-final.log`; pack/install/automate/npm-ci/build/update/local HTTPS status 및 verify24 requests |
| 설치한 tarball의 새 CLI | PASS | 같은 로그; opt-in workflow 생성, 정상 rollout 승인, 503 새 배포 복구 및 exit1, 실제 HTTPS probe246회 |
| diff whitespace | PASS | `git diff --check` |

패키지 실사용 검증은 TLS를 끄지 않았다. localhost certificate를 child의 trusted CA에
추가했다. 새 rollout의 서버/배포 adapter는 synthetic fixture이며 실제 local HTTPS,
CLI subprocess, 파일 manifest/hash·보고서·exit code를 사용했다.
사용자 실제 Discord OAuth·운영 호스팅·live GitHub 병합을 수행했다고 주장하지 않는다.
test runner 입력/credential은 테스트 값이며 로그·보고서에 쿠키/token 값을 남기지 않았다.

초기 smoke는 새 프로젝트 fixture에 기존 gate hook을 복사해 설치 거부를 관측했다.
소유자 hook을 덮어쓰지 않는 정상 거부였다. 새 fixture에서 해당 hook을 만들지 않도록
고친 뒤 실사용 검증이 통과했다. 요청 수는 실제 서버 관측과 모든 baseline/new/recovery
검사의 합을 대조했다. 초기 선택 단계 합164를 전체246으로 바로잡았다.

## 배포 전 남은 확인

1. 사이트별 owner-reviewed adapter/credential/전체 origin/외부 배포 lock/정상본 보관을 연결.
2. 실제 GitHub 최소 권한, branch checks/app identity, token 갱신과 merged push의 배포 trigger 확인.
3. native deploy/rollback ID와 timeout receipt, 동시 수동 변경, 과거 공개 주소 우회 차단을 canary에서 시험.
4. 다른 필수 검사·리뷰 후 병합 재실행 절차. 현재 periodic retry/review 자동 승인은 제공하지 않음.
5. 새 preview origin이 생기는 연결과 1 MiB 초과 자산은 현재 자동 모드에서 수동 검토.

이전 [상용 리뷰 수정 기록](2026-10-01-commercial-auth-review-fixes.md)의 T11 bounded
performance budget·edge CPU/실제 matrix, 전체 Miniflare loopback/EADDRINUSE 회귀와 T12
운영 canary 미합격은 그대로 남는다. 이번 SDK 검증을 root 전체 정상/상용 출시 완료로 표현하지 않는다.

## 변경 파일

- `packages/connect-cli/src/portable-rollout.mjs`: host adapter, baseline/candidate 검증, 배포·복구 상태 머신.
- `packages/connect-cli/src/patch-auto-merge.mjs`: patch/lock/npm/GitHub 검증 및 atomic merge.
- `packages/connect-cli/src/managed-updates.mjs`, `src/protection.mjs`, `bin/nakwol-connect.mjs`: opt-in workflow/CLI/config 보존.
- `packages/connect-cli/test/{portable-rollout,patch-auto-merge,managed-updates}.test.mjs`: 실패·경합·격리 회귀.
- `scripts/{managed-gate-smoke,automatic-update-smoke}.mjs`: tarball CLI와 실제 local HTTPS.
- `README.md`, `packages/connect-cli/README.md`, `docs/{MANAGED_GATE_UPDATES,LLM_INSTALLATION,SAFE_AUTOMATIC_UPDATES}.md`: 상태/설치/연결 안내.
- `docs/superpowers/plans/2026-10-01-safe-managed-updates.md`, 이 문서: 하위 계획과 실제 검증 범위.

MCP graph generation2026-09-27은 이 새 코드를 포함하지 않았고 docs/scripts가 제외되어
있다. coverage를 확인하고 실제 source/fixture/CLI 실행으로 보완했다.
