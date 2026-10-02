# T11 로컬 성능·비용·장애 시험

## 범위와 상태

구현 commit: `0395375c852c137d883b4cf767e9a4f989409e67`, API 캐시 계약 수정 `781ee56`, branch `feature/commercial-auth-foundation`.

**부분 완료:** 재현 도구와 로컬 검증을 구현했다. 상용 성능 승인/T11 전체 완료/운영 배포는 하지 않았다. Connect0.14.0 미발행 후보를 유지한다. [명령·전 상태 수치·원시 결과·비용 근거](../benchmarks/commercial-gate.md).

## 실제 변경

- `scripts/benchmark-gate.mjs`: 실제 `createGate`로 HTTP315자산, 독립 런타임1/10, 조건부304, 세션/역할/control 만료, 공개 합성 baseline, p50/p95/p99, 정확한 중앙 endpoint 수, 바이트, process CPU/wall, source SHA를 기록한다.
- `tests/fixtures/gate-benchmark/`: 고정 seed·SHA·315파일, 실제 디코딩 PNG1/10/50/200KiB·합성 TTF2, browser QA 서버, AUTH/control 장애·키·관측·디자인 시험.
- `packages/connect-cli/test/{benchmark,gate-benchmark-faults}.test.mjs`: 도구 계약과 300동시 독립 그래프, cache vendor header 회귀 검증.
- `server/{gate,session}.mjs`: 정적 자산에서 상속된 `CDN-Cache-Control`, `Cloudflare-CDN-Cache-Control`, `Surrogate-Control` 제거. API는 기존의 명시적 private/no-store를 설정한다. Cache-Control private/no-cache·ETag/304 유지. 새 positive TTL·인증 예외 없음.
- 측정 원시 JSON과 비용·미측정 경계를 소스 관리한다. `.nakwol/reports/`는 개인 실행 결과로 ignore한다.

## 검증 근거

- benchmark 계약 RED: 구현 파일 없음 → 실제 HTTP GREEN. vendor public header RED: `public,max-age=31536000` 유지 → 두 공통 경로에서 제거 후 GREEN.
- T11 직접 테스트5/5, 실패/skip0 (`.wrangler/commercial/t11/target.log`). 이 중 generator1개는 root 전체 suite 패턴 밖이라 별도로 실행했다.
- 장애 드라이버123검증: AUTH/control 각각503/429/실제7초·4초 abort, 차단 handler0, 회복 handler1. 키 제거/기간/신뢰, pending quota8, 관측 off/on·독립10그래프·큐128·overflow872·수집 손실1000·회복, 실제 디자인 loader cold/hit/failure/recovery.
- 각 profile 전7상태마다10warmup+30측정, 동시300·독립10그래프·중앙100ms·이미지50KiB. warm 중앙0, 성공 lease 갱신10, 거부·304 본문0, 예상 상태 오류0. `protect verify`는 각1264요청 통과. 운영 배포의 `releaseAccepted`를 주장하지 않는다.
- Chromium 공개 합성 fixture: 이미지300decode, 폰트2loaded, JSON4loaded,1280×720/DPR1. 앱 간 실제 SSO 시험 아님. 콘솔404는 favicon이며 font/image 디코딩 오류 없음. 사용한 browser 탭과 fixture process를 종료했다.
- Node syntax 검사는 통과했다. LSP daemon은 named pipe에 연결되지 않아 LSP 결과를 확보하지 못했다. typecheck/build/전체 회귀 결과는 아래 최종 검증에 별도 기록한다.

## 중요한 발견과 판정

1. **warm 성능 목표 미달.** local 추가 p95=159.79ms, bounded=117.06ms, 허용100ms. 독립 리뷰도 승인 차단으로 판정했다. Node auth wall은 비동기 암호 연산·스케줄링을 포함하므로 실제 edge CPU나 원인을 확정하지 않는다. TTL을 늘리지 않았다. 실제 Worker 측정/프로파일링과 필요한 hot path 개선을 거쳐야 한다.
2. local role-expired는 동시300에서20갱신, 기존 동시30에서110갱신. 성공 승인의 single-flight와 별도로 거부 wave 트래픽 개선이 남는다. 모두403/자산0이라 공개 우회는 없다.
3. **공유 캐시 지시문 상속 결함 수정.** 원본의 vendor public cache header가 남는 코드 경로를 실제 테스트로 재현해 제거했다. 외부 CDN이 Worker 앞에서 강제로 인증을 우회하는 설정까지 해결했다고 주장하지 않는다.
4. **로컬 신규 연결 burst 문제 분리.** gate/Date/fetch override가 없는 HTTP서버에서도300중232성공/68ECONNREFUSED. 연결300개를 준비한 후 실제300동시 요청은 성공. 준비 시간/요청 수를 측정 배치에서 분리했다. Windows/Node 내부 거부 구성요소와 과거 T10 실패의 동일 원인은 미확정이다. 재시도나 동시성 축소로 실패를 숨기지 않았다.

## 독립 리뷰와 남은 작업

`t11_final_review`: scoped 코드 Critical0, 코드 Important0. 성능 승인 Important1(목표 미달), 초안 측정표 누락 Minor1. 측정표는 원래 예정된 결과 기록 단계에서 채웠다. 성능 승인 차단은 유지한다.

Ruling: 성능 미달을 새로운 승인 캐시 TTL이나 Node wall→edge CPU 환산으로 통과시키지 않는다. T11을 partial로 유지하고 실제 workerd/edge 검증과 개선을 남긴다. 비용: 출시 일정 지연이며 실패 성능을 출시 합격으로 숨기는 위험을 줄인다.

판정 제외: 전체108조합, 실제 요청당 Worker CPU, staging3지역 Chrome/Firefox/Safari·모바일 LCP/자동SSO, 실제 Discord·중앙D1 meta·provider quota·CDN·서비스워커·관측 저장 지연. 테스트 전용 staging 주소와 지역별 실행 환경을 요청했다. 새 유료 인프라·운영 사이트·타 개발자 사이트를 변경하지 않았다. T12 출시 단계로 넘기지 않는다.

## 최종 검증

첫 전체 회귀372/373, 실패1, skip0,571.977초. 새 헤더 제거가 API의 명시적 vendor no-store 헤더까지 제거해 기존 API 계약 시험이 null로 실패했다(`full.log`122). 이 변경의 회귀이며 테스트를 완화하지 않았다. static은 삭제/API는 no-store를 명시하도록 수정 후 해당 경로14/14 GREEN (`cache-regression-green.log`), 전체 회귀를 다시 실행한다. 첫 typecheck/pack/Worker dry-run은0이었다.

원시 성능 보고서는0395375의 측정 코드/정적 자산 경로 snapshot이며 당시 HEAD40401e0 + 실제 SHA를 보존했다. API 헤더 계약 수정 뒤의 새로운 성능 측정으로 소급해서 표현하지 않는다. 정적 자산 정책은 유지했으며 새 hot path 성능 승인은 여전히 미완료다.

수정 후 전체 회귀도372/373, 실패1, skip0,562.128초(`full-verified.log`). API 계약 시험은 통과했으며 이번 실패는 cloudflare-workers generated workerd의 최초 preflight `mf.dispatchFetch` 전송 `TypeError: fetch failed`(136)다. 당시 원인/선택 포트는 로그에 없어 확정하지 않는다. 같은 import tsx의 해당 파일 단독2/2 통과(`worker-isolated.log`). 잘못 선택된 fetch 금지 포트도 가설로 확인했지만 이번 사건의 원인 증거는 아니다. 재시도·대기·assertion 완화 없이 최초 실패에 localhost origin/내부 cause 진단만 추가했다. 추가 후 단독 검증 결과는 아래 기록한다. 전체 green으로 표시하지 않는다.

최종 pack/typecheck/Worker dry-run exit0. Node syntax와 직접5/5·관련14/14는 통과했다. LSP daemon 결과는 확보하지 못했다. 브라우저 공개 합성 fixture만 검증했다. 운영 배포·npm 공개·push 없음.

진단 추가 후 같은 Worker/Pages 파일2/2 GREEN, skip0,3.609초(`worker-diagnostic.log`). 이는 전송 실패의 해결 증거나 전체373/373 통과가 아니다. T11 성능·외부 승인과 이 전송 안정성 조사를 다음 작업에 남긴다.
