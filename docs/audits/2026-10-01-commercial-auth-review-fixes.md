# 상용 인증 독립 리뷰 후 주요 결함 수정

날짜: 2026-10-01. 기준 소스: `9d57529e70068b359f28957425037dbd21e54d80`,
브랜치: `feature/commercial-auth-foundation`. 운영 배포와 npm 발행은 포함하지 않는다.

## 수정한 경로와 동작

1. **운영자 앱 잠금 경계** — 소유자 CLI `PATCH /connect/cli/apps/:clientId`와
   기존 관리자 `PUT /admin/api/apps/:clientId`의 메타데이터 SQL에서 `status` 대입을
   제거했다. 상태 변경 요청은 `409 APP_STATUS_WORKFLOW_REQUIRED`이며,
   영향 확인·최근 인증·변경 사유·감사 기록을 갖는 기존 운영자 잠금/해제 조치를 사용한다.
   잠금과 메타데이터 저장이 겹쳐도 이전 `active` 값을 다시 쓰지 않는다.
   기존 앱 편집 화면은 상태 필드를 읽기 전용으로 표시하고 저장에서 제외한다.
   상태를 생략한 기존 앱의 메타데이터 저장은 현재 상태를 유지한다.
2. **완료된 인증 실패의 요청 폭증** — local-lease에서 같은 승인 바인딩의
   401/403/503 및 통신 실패를 isolate 메모리에 1초간 재사용한다.
   bounded-control의 거부는 동일 epoch에 한해 기존 30초를 유지하고, 오류503은 1초다.
   실패 중 보호 자산은 제공하지 않으며 성공 증명의 고정 만료 300초는 늘리지 않는다.
   다른 앱·origin·AUTH·정책·credential·세션 핸들은 실패 기록을 공유하지 않는다.
3. **관리자 영향 집계** — 특정 세션 해지는 그 세션 하나만 집계하고,
   아직 계정에 연결되지 않은 Discord ID의 조치는 활성 세션 0개로 표시한다.
   앱 전체 조치와 사용자별 앱/전역 조치의 집계를 구분한다.
4. **정책 적용 상태** — 정책 저장 응답의 조치 ID를 유지하고 접수·게시·수신 관측
   시간을 표시한다. 조회는 해당 앱의 정책 조치와 outbox client를 함께 제한한다.
   수신 한 건을 전체 사용자 적용 완료로 표시하지 않으며 미확인 프로필은 미확인으로 남긴다.
5. **설치 복구** — 같은 앱에 새 설치 설정을 만들 때 새 UUID와 CAS 버전0으로
   시작한다. 기존 credential은 자동 해지하지 않는다. 확인한 credential의 해지·교체는
   명시적 확인, 사유, 기존 API의 최근 인증을 필요로 한다. 원문은 최초 발급에서만
   제공하며 재조회·실패한 저장·화면 이동 시 원문 표시를 정리한다.
   재인증 완료 시 검증된 client ID와 고정 `/developer/setup` 경로로 돌아간다.
   Secret 교체·재배포·새 주소 검사·기존 배포/원본 주소 폐쇄는 별도 수행하도록 안내한다.
6. **관측 메모리와 측정 도구** — 성공 후 값0인 drop binding을 삭제하고 최대128개를
   유지한다. benchmark의 `createGate`는 binding/isolate 준비 단계에서 생성·재사용하며
   측정 요청 중 factory 생성은0이다. 준비 비용은 별도 기록한다.

## 검증 근거

- 실제 Hono 경로와 Miniflare D1에서 잠금 우회, 오래된 상태의 동시 저장,
  감사 조치 해제 및 세션 영향 집계를 재현했다. 수정 전 실패 → 수정 후 대상 회귀 통과.
- 300개씩 3회 실패 wave의 합성 중앙 refresh 호출은 900회에서1회로 감소했다.
  999ms에는 계속 차단하고 1000ms에 중앙 회복을 확인한다. 승인 만료·로그아웃·
  세션/credential 분리·bounded epoch 변경도 대상 테스트에서 확인한다.
- `npm run typecheck`: 패키지 빌드와 `tsc --noEmit` 통과. 로컬 CLI 후보0.14.0을
  생성했으며 npm 발행은 하지 않았다. 대응 검사: 코어27/27, 런타임43/43,
  추가 UI7/7·D1/API2/2. 실제 로컬 Chromium의 합성 API/SDK 환경에서6개 흐름 통과,
  pageErrors0. 실제 Discord OAuth, 운영 사이트의 원본 폐쇄를 검증한 것은 아니다.
- 최초 전체 실행은398개 중386개 통과·12개 실패였다. 실패에는 Miniflare 내부
  loopback `fetch failed`와 명시적인 `connect EADDRINUSE 127.0.0.1:7278`가 기록됐다.
  실행 도구의300초 transport timeout 후에도 테스트가 남아 있었고, 진행이 멈춘
  이 실행의 두 테스트 프로세스를 확인해 종료했다. 전체 실행은 green으로 기록하지 않는다.
- 실패12개를 파일 단위 동시 실행1로 분리했다. 먼저3/3, 이후8/9 통과였으며 남은1개는
  이번에 승인된 공개 receipt 필드를 기존4개 DTO 키 목록이 거부한 실제 계약 검사 실패였다.
  정확한 상위8개·중첩 공개 필드 목록, 다른 앱 receipt 제외·다른 앱404·앱 토큰401
  검사를 보강한 후 해당1개도 통과했다. 그러므로 실패했던 각 검사12개는 최종 개별
  실행에서 통과했다. 통합 실행의 통신 실패 원인 전체를 규명하거나 전체 재실행을
  통과시킨 것으로 해석하지 않는다. host TCP 설정은 변경하지 않았다.
- 별도 컨텍스트의 제한 범위 소스 리뷰: PASS, 확인된 신규 결함0건.
  리뷰어는 테스트와 benchmark를 재실행하지 않았다.

원시 로그: `.wrangler/commercial/review-fixes/{status-red,status-green,typecheck,full,
failed-isolated,failed-isolated-remaining}.log`,
`.wrangler/commercial/ui-recovery/{green-ui,green-api,metadata-contract-green}.log`,
`browser-results.json`. 실패 상태와 테스트 프로세스 식별 기록은 삭제하지 않았다.
런타임 RED/GREEN 및 독립 리뷰 산출물은 저장소 상위 `reviews/evidence/`에 보존했다.

## 변경 파일과 구현 커밋

- `abc3965`: `src/{connect-cli-apps,connect,admin-operations}.ts`,
  `tests/worker/app-status-workflow.test.ts`. 기존 폼의 상태 조치 안내도 포함한다.
- `c12c367`: `packages/connect-cli/src/server/{session,observations}.mjs`,
  `test/{server-refresh-backoff,server-sso,observations}.test.mjs`,
  `GATE_SPEC.md`, `docs/{SERVER_SESSION_REFRESH,BOUNDED_GATE_CONTROL}.md`.
- `486ea35`: `scripts/benchmark-gate.mjs`, CLI `test/benchmark.test.mjs`,
  `docs/benchmarks/commercial-gate.md`, `results/2026-10-01-corrected-*.json`3개.
- `6d79f5d`: `DESIGN.md`, `src/assets/nakwol-{connect-admin,developer-setup,service-management}.js.txt`,
  `src/{developer-setup-page,service-management-page,service-management-routes}.ts`,
  `tests/worker/management-recovery-{api.test.ts,ui.test.ts,ui.test.mjs}`,
  `service-management-auth.test.ts`, `docs/audits/2026-10-01-management-recovery-ui.md`.

이 기록은 해당 구현 소스의 검증 범위를 보존하는 후속 문서 커밋으로 추가한다.

## 수정한 측정 도구의 focused 결과

315개 보호 파일, 이미지300개×50KiB, 동시300, 독립 Node 모듈 그래프10개,
합성 AUTH100ms, warmup10회 및 측정30회. 실제 edge CPU/Discord/브라우저 paint 측정은 아니다.

| 프로필 | 기준선 전체 p95 | 보호 전체 p95 | 추가 p95 | 100ms 예산 | warm 중앙 호출 |
| --- | ---: | ---: | ---: | --- | ---: |
| local-lease | 151.60ms | 233.83ms | 82.23ms | 통과 | 0 |
| bounded-control | 180.54ms | 303.26ms | 122.73ms | 미달 | 0 |

두 프로필 각각 `protect verify` 1264요청 통과, 모든 측정 wave에서 자산 오류0,
측정 중 factory 생성0. 기준선과 소스가 과거 측정과 다르므로 개선량을 factory 수정만의
효과로 해석하지 않는다. 원시 결과·환경·전체 항목은
[측정 문서](../benchmarks/commercial-gate.md)에 보존했다.

## 유지하는 보안 계약과 남은 범위

auth required/member, 시즌3 기준, 직접 주소 및 HTML/JS/CSS/JSON/이미지/폰트/다운로드 보호,
GET/HEAD/Range, AES-GCM·HttpOnly·Secure 쿠키와 앱/origin 바인딩을 유지한다.
성공 응답의 브라우저 캐시 정책과 정상 승인 TTL을 완화하지 않았다.

새 비용/지연은 실패한 같은 핸들의 회복 확인이 최대1초 늦어질 수 있다는 점이다.
isolate 교체·512건 실패 기록 축출 후에는 중앙 요청이 다시 발생할 수 있다.
중앙에서 명시적으로 확인한 권한 회수의 기존 지연 상한은 local-lease300초,
bounded-control은 게시 후30초+5초 clock skew다. Discord 역할 변경 발견은
별도의 증거 갱신14분/만료15분 계약을 따른다.

이번 결함 수정은 상용 출시 승인과 구분한다. T11 전체108조합·운영 edge CPU·3지역 SSO·
할당량/CDN 검증, bounded-control 성능 예산, T12 출시 문서/CI/호환성/canary는 남아 있다.
기존 설치 사이트의 공통 게이트 수정 적용은 패키지 발행 후 업데이트·재배포가 필요하다.
