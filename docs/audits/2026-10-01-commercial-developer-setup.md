# D04 설치·재설정 마법사 검증

## 재개 기준

- 저장소: `E:/Codex/낙월 인증기/nakwol-auth`, branch `feature/commercial-auth-foundation`.
- 이전 정상 commit: `7a54ff9a19a286a98c1bdbad6ddae5c7a5660196` (D03).
- 재개 시 실제 변경은 `developer-setup.test.ts`, `setup-resume.test.mjs` 두 RED 테스트뿐이었다. 구현·마이그레이션은 없었으며 `.wrangler/commercial/d04/red.log`는 모듈 부재와 API 404로 0/5였다.
- 프로젝트 체크포인트, 단계 ledger, Git 상태와 실패 로그를 대조했다. 오래된 graph generation `2026-09-27T10:21:51Z`는 새 파일을 포함하지 않아 실제 소스를 읽었다.

## 구현 범위

`/developer/setup`에서 서비스 생성/선택, 주소·호스팅, 디자인과 상태 미리보기, 정책 실효값, 변경 비교, JSON 다운로드, Secret·설치·배포·검증 안내를 제공한다. 기존 디자인·정책 API와 검증기를 사용한다. 저장되지 않은 디자인·정책 입력에는 단계 저장 성공을 표시하지 않는다. 모바일 44px 제어와 키보드·상태 안내를 유지한다.

공통 setup schema는 `schemaVersion/clientId/siteOrigin/provider/buildDirectory/presentationVersion/policyVersion/step/idempotencyKey`만 허용한다. Secret과 임의 완료 상태는 거부한다. CLI `protect plan/install/update --setup-file`과 `init --setup-file`이 같은 검증기를 사용한다. 다운로드 후 화면 단계만 이동한 경우에는 파일을 계속 사용할 수 있지만 실제 설정/버전 변화는 거부한다.

0022는 setup, 앱 생성 receipt, 자격증명 receipt를 추가한다. 현재 소유권과 생성자에 묶여 다른 소유자도 재개 ID만으로 읽을 수 없다. 변경은 최근 재인증·Origin·사유·rate limit·CAS를 확인한다. 앱 생성은 고정 ID와 트랜잭션으로 중복·자동 suffix·소유권 탈취를 막는다. 자격증명은 동시 요청에서도 한 번 발급되며 원문은 최초 응답만 반환한다. 발급과 origin 변경의 경쟁 조건도 SQL 안에서 검사한다.

기존 설치 검사·공식 어댑터·exact managed dependency·lockfile 계약을 유지한다. 신규 AUTH 전용 설치는 빈 DATA scope와 `dataIntegration=none`을 기록한다. doctor의 AUTH·게이트·차단 검사는 유지하며 DATA 등록 검사만 제외한다. 기존 DATA 설정을 보존하고 명시적 DATA 활성화 시 일반 검사로 돌아간다.

CLI/runtime 후보 버전은 0.14.0이다. 0.13.0의 공식 갱신 hook도 인식한다. 서버 세션·자산 접근 알고리즘은 추가하지 않았다. 마법사 설정 조회는 보호 자산의 hot path에 없다.

## 독립 리뷰와 수정

새 Astra 리뷰어 한 명이 Important 3건을 보고했다. 재리뷰나 구현 위임은 하지 않았다.

1. 자격증명 발급과 origin 변경 경쟁: receipt 사전 조회 뒤 발급을 끼워 넣은 테스트가 `200 !== 409`로 실패했다. UPDATE의 CAS 조건 안에 receipt/origin 조건을 추가했고 회귀 테스트가 통과했다.
2. 최초 빌드보다 설치가 먼저인 안내: 실제 화면에서 순서를 확인했다. 최초 빌드 → 보호 설치 → 재빌드로 수정했다.
3. 디자인/정책 입력을 저장하지 않고 단계 저장 성공 표시: 브라우저에서 light 입력 후 저장·reload 시 dark로 돌아오는 현상을 확인했다. 공통 저장 경로와 단계 이동에 미저장 검사를 적용했다. 실제 디자인 게시와 정책 저장 후 reload 유지도 확인했다.

추가 수용 시험에서 브라우저가 다운로드 이름의 앞 점을 제거하는 것을 확인해 `nakwol-setup.json`으로 통일했다. 다운로드 후 검증 단계로 이동하면 CLI가 불필요하게 stale로 판단하던 사례도 RED → GREEN으로 고쳤다. 충돌 화면에는 최신 setup 버전과 제출 버전·정책·디자인 버전을 표시한다.

## 실행 증거

증거 폴더: `.wrangler/commercial/d04/` (운영 Secret·실사용자 데이터 없음).

| 검사 | 결과 | 근거 |
|---|---|---|
| 초기 RED | 0/5, 모듈 부재·404 | `red.log` |
| API·CLI·리뷰 경쟁 회귀 | 11/11 | `review-green.log` |
| 단계 이동 후 setup 파일·실제 버전 drift | 5/5 | `navigation-red.log`, `navigation-green.log` |
| 3개 생성 어댑터의 실제 로컬 HTTP | 3/3 | `adapter-third.log` |
| 전체 회귀 최종 | 359/359, 실패·skip 0, 581.864초 | `full-verified.log`, `full-verified.exit` |
| TypeScript·CLI pack·Worker dry-run | exit 0 | `typecheck-final2.log`, `pack-final2.log`, `dry-run-final.log` |

플랫폼별 수용 결과:

| 생성 게이트 | Secret 없음 | 비로그인 검사 | 정상 파일 해시 | 이미지 300회 중 중앙 호출 | 정책 |
|---|---:|---:|---:|---:|---:|
| Workers Static Assets | 503, 자산 0 | 55 통과 | 7/7 | 0 | 7,200초 |
| Pages | 503, 자산 0 | 55 통과 | 7/7 | 0 | 7,200초 |
| Vercel 정적 middleware | 503, 자산 0 | 55 통과 | 7/7 | 0 | 7,200초 |

이는 생성한 실제 코드 → 로컬 HTTP → 중앙 workerd/D1 경로다. 중앙 시험 세션과 OAuth code는 fixture에서 생성했으며 Discord 실로그인이나 각 사업자의 클라우드 배포 검증은 아니다. Vercel은 실제 `@vercel/functions@3.9.9`의 middleware 응답을 로컬 자산 체인에서 실행했다. `doctor`와 manifest+정상 쿠키의 `protect verify`가 통과하고 `releaseAccepted=true`였다. 외부 운영 주소 전체를 검사했다는 뜻은 아니다.

브라우저에서 서비스 생성/선택, light 디자인 preview·게시, 2시간 실효값 확인·저장, reload 재개, 원문 최초 발급·마스킹·저장소 미포함·이동 시 삭제, JSON 다운로드 이름, 미지원 호스팅 거부, 다른 개발자의 앱 403, CAS409 최신 버전 비교를 확인했다. 모바일 375px에서 페이지 가로 넘침이 없었고 표시 버튼의 최소 높이는 44px였다. 설정·배포·차단·정상 수용 상태는 별도이며 미검증으로 남는다. `browser-qa.json`, `wizard-mobile.png`, `setup-download-final.json`에 요약과 산출물이 있다.

## 검증 중 발생한 실패

- 시험 데이터의 NOT NULL 컬럼 입력 두 곳은 명시적 컬럼으로 수정했다.
- 초기 300 HTTP 요청에서 Windows 동시 연결이 실패해 기존 D03 방식과 같은 16개 연결 풀로 제한했다. 생성 게이트는 수정하지 않았다.
- 루트 `npm install`은 기존 Wrangler peer 범위 충돌로 실패했다. 강제 해석 대신 이미 선언된 `@vercel/functions@3.9.9`만 ignored QA prefix에 설치하고 누락된 로컬 의존성을 연결했다. 범위·lockfile을 바꾸지 않았다.
- 첫 전체 실행은 356/358이었다. CLI 안내서 헤더의 구 버전을 고쳤고 해당 3개 검사가 통과했다. 나머지 한 건은 로컬 Miniflare 요청의 `fetch failed`로 단독 재실행에서는 통과했다. 시험 서버 종료 후 concurrency 2의 최종 전체 실행은 359/359로 통과했다. 원인은 확정하지 않았으며 테스트 retry나 assertion 완화는 하지 않았다.

## 운영 상태와 다음 단계

로컬 개발·검증 범위다. 운영 D1 마이그레이션, Worker 배포, npm 게시, push, 외부 소비 사이트 수정은 하지 않았다. 기존 설치 사이트에 자동 적용됐다고 표시하지 않는다. 공개 활성화에는 0022와 AUTH/CLI의 함께 배포가 필요하다.

다음 계획 작업은 T10 동적 API 보호, T11 성능·비용 수용, T12 rollout이다. 이번 플랫폼 수용은 D04 설치 경로의 검증이며, 다지역·실제 사용자·실제 호스팅 비용을 포함한 상용 출시 최종 수용은 해당 후속 단계에 남는다.

구현 commit: `b3e7763` (`feat(auth): add resumable service setup wizard`).
