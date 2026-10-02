# D02 서비스 개발자의 사용자 관리 검증

## 범위와 적용 상태

기준 commit `af642ac1ce3b86380dea55bd5eab7507f9dd1810`, branch `feature/commercial-auth-foundation`의 D02 개발입니다. 운영 DB 변경·Worker 배포·npm 발행·외부 사이트 수정은 수행하지 않았습니다. 상용 계획 전체는 진행 중이며 다음 단계는 D03입니다.

현재 앱 소유자만 `/developer/users`에서 앱 사용자 목록·조회·사전등록·앱 차단/해제·앱 세션 종료·위임 허가/철회·관계 삭제를 수행합니다. 관리 API는 현재 소유권, 실제 최근 OAuth 인증, 같은 Origin, 사유, 속도 제한, 버전 CAS, idempotency를 검사합니다. 앱별 subject를 사용하고 중앙 사용자/역할/다른 앱의 데이터는 반환하지 않습니다.

시즌3·역할 freshness·중앙 deny·admin 기준은 owner가 우회할 수 없습니다. owner의 추가 역할 허가는 플랫폼이 `additional-roles`를 위임한 경우에만 가능합니다. 앱 세션 종료는 중앙 SSO와 다른 앱을 보존합니다. 관계 삭제도 앱 deny를 제거하지 않습니다.

## 실행 경로

중앙 로그인/발급/거부 기록 → migration0020의 관계 트리거 → 앱별 사용자 API → owner 화면입니다. D1 트리거가 발급 INSERT의 `meta.changes`를 늘리는 실제 회귀를 발견해, 서버 세션/앱 토큰은 발급 행의 `RETURNING` 결과로 단일 승자를 검사하도록 수정했습니다.

승인된 공통 게이트 → asset 응답 → 공식 background hook → isolate 내 앱/사용자/5분 구간 병합 → `/server/v1/observations` → credential 및 중앙 승인 세션에서 신원 도출 → 앱별 관측 기록입니다. 관측 네트워크는 보호 응답에서 기다리지 않습니다. legacy token 모드와 background hook이 없는 호스트는 관측 미지원이며 보호는 유지합니다.

큐128·배치50·작업당 최대3배치·전송당2초 timeout·1회 재시도입니다. 실패는 관측을 누락시킬 수 있으나 승인 판단을 바꾸지 않습니다. 여러 isolate는 각각 전송할 수 있습니다. 마지막 관측은 온라인 상태가 아니며, 익명 집계는 신원이 없는 중앙 OAuth 실패입니다. 관측/익명 집계30일, 관리 감사180일, deny는 명시적 해제까지 보존합니다.

## 실제 로컬 HTTP 검증

driver: `.wrangler/commercial/d02/http-driver.ts`, 결과: `http-driver.log`. 실제 HTTP → 공식 공통 게이트 → workerd의 중앙 AUTH/D1/SQLite DO를 사용했습니다. 임의의 성공 응답만 반환하는 인증 mock은 사용하지 않았습니다. 시간은 로컬 단일 측정값이며 운영 SLO가 아닙니다.

| 항목 | cold | warm |
|---|---:|---:|
| HTML 응답 시간 | 104.28ms | 13.27ms |
| 이미지300개 완료 | 454.82ms | 351.63ms |
| 중앙 control 호출 | 1 | 0 |
| 중앙 session refresh 호출 | 0 | 0 |

승인 관측 전송1회, 실제 승인 기록1건을 확인했습니다. 사용자 관리에서 차단 후 약31.381초에 이미지300개 모두403이며 asset 제공은0회였습니다. 차단 해제 후200으로 복구됐습니다. 제어 재확인/세션 refresh는 차단과 해제 검증을 합해 각각2회였습니다.

`protect verify`: HTML·이미지·JSON·JS·CSS·폰트·다운로드7경로에서 GET/HEAD/Range/잘못된 쿠키, 총28/28 차단 통과. 미인증 자산과 직접 URL 보호를 유지합니다.

관측 모듈 시험은 이미지300요청/10 isolate에서 전송10회, 본문 합계1,270 bytes, 예약 작업 wall time4.568ms를 기록했습니다. Node `process.cpuUsage`는 Windows 계측 해상도 아래인0ms를 반환했으며 Worker CPU0을 뜻하지 않습니다. 네트워크 장애·큐 초과 시험은 전송 시도6회/누락1,000건으로 제한됐습니다. 이 수치는 isolate 단위 병합의 시험이며 전세계 isolate 간 단일 전송을 주장하지 않습니다.

## 독립 리뷰와 수정

한 명의 새 Astra 리뷰어가 읽기 전용으로 검토했습니다. Critical0, Important2, Minor1이었습니다.

- Important: 한국어/이모지 검색 cursor의 Latin-1 예외. UTF-8 양방향 변환 및 cursor 길이 제한으로 수정했습니다.
- Important: 완료된 임시 허가 재시도가 시간 경과 후 실패. 정적 입력 검증과 새 허가의 시간 검증을 분리해 저장된 동일 operation을 먼저 반환합니다. 만료 후 재시도가 새 허가를 만들지 않습니다.
- Minor: 뒤늦은 오래된 관측이 최신 관측의 수신시각을 덮어씀. 관측/수신시각을 같은 최신 이벤트의 값으로 유지하도록 수정했습니다.
- 추가 UI 경합: 서비스 전환 중 이전 capabilities 응답이 도착하면 무시하도록 앱과 요청 generation을 확인합니다.

`review-red.log`의 Unicode/관측 실패, `grant-retry-red.log`의 `INVALID_GRANT`를 재현한 뒤 `review-green.log` 2/2로 확인했습니다. 초기 전체 회귀 실패는 기존 테스트 DB의0020 누락, 트리거 발급 검사, runtime 버전/생성 파일 기대값을 수정했습니다. 테스트 조건을 완화하지 않았습니다.

## 최종 검사

타입 검사·CLI0.12.0 패키징·Worker `--dry-run`은 exit0입니다. 브라우저에서 A/B owner 각각 목록→차단→해제→앱 세션 종료를 완료했고, B owner의 A 앱 조회와 일반 사용자의 관리 API는403입니다. 일반 사용자에게 관리 workspace는 보이지 않습니다. 저장된 조치를 `applied / pending / 최대300초 / 빠른 지원 미확인`으로 표시하는 것도 확인했습니다. 오래된 capabilities 응답이 늦게 도착하는 UI 경합을 실제 브라우저의 제어된 지연 응답으로 재현한 뒤 grant 옵션이 더 이상 남지 않는 것을 확인했습니다. 이 경합 시험의 API 응답만 fixture로 제어했으며, 권한/실제 조치 시험은 중앙 D1을 실행했습니다. 콘솔에는 의도적인403 resource 오류만 있었고 앱 JavaScript 오류는 관찰되지 않았습니다.

전체 suite의 첫 최종 실행은 도구300초 제한 뒤 중단했습니다. 로그를 보존하고 해당 파일 단독4/4를 확인했습니다. 다음 전체 검사332/333에서 설치 안내의0.11.0 표기가 발견돼0.12.0으로 수정했고 대상 검사1/1이 통과했습니다. **모든 수정 후 최종 전체333/333, 실패/취소/skip0, exit0**입니다. 동시 실행4개, 약282.996초로 끝났으며 독립 완료 코드 파일을 사용해 도구 제한시간과 구분했습니다. 증거는 `.wrangler/commercial/d02/`의 `verified-full-final.log`, `full-final.exit`, `typecheck-final.log`, `pack-final.log`, `dry-run-final.log`, `browser-qa.json`, `timeout-target.log`, `interrupted-full.log`, `before-guide-full.log`, `guide-version-green.log`, `observations-final.log`입니다.

## 배포와 남은 범위

운영 적용은 additive migration0020 → 중앙 Worker → owner 수용 검사 → 원하는 소비 사이트의 Connect0.12.0 업데이트/재배포 순서입니다. 기존 사이트의 파일은 자동 변경되지 않습니다. 중앙 배포만으로 관측 기능이 추가되지 않습니다.

권한 회수는 기본 local lease에서 앱 설정의 재확인 간격(최대300초), opt-in bounded control에서는 성공 발행 후35초 상한을 따릅니다. 설치 프로필이 확인되지 않은 사이트를 빠른 회수 지원으로 표시하지 않습니다. Discord 역할 발견 시간과 제어 발행 시간은 별개입니다.

실제 Discord OAuth·운영 부하·원격 DB·외부 소비 사이트·여러 지역의 제어 전파는 이번에 검증하지 않았습니다. D03 UI 편집, D04 설치 마법사, T11 전체 SLO/호스팅별 원격 query 비용 검증과 운영 rollout은 후속 범위입니다. 중앙 관측 endpoint의 이벤트별 DB 처리 비용을 포함해 최대50건 배치의 호스팅 quota는 운영 성능 검사에서 확인해야 합니다.

## 변경 파일

| 묶음 | 경로 |
|---|---|
| 앱 사용자 관리 | `src/service-users.ts`, `src/service-user-actions.ts`, `src/service-user-routes.ts`, `src/service-observations.ts`, `migrations/0020_service_users.sql` |
| 화면/관리 계약 | `src/service-users-page.ts`, `src/assets/nakwol-developer-users.js.txt`, `src/assets/nakwol-connect-admin.js.txt`, `src/service-management-auth.ts`, `src/service-management-page.ts`, `src/service-management-types.ts`, `src/sdk-entry.ts` |
| 인가/발급 | `src/policy.ts`, `src/server-sessions.ts`, `src/store.ts` |
| 공통 runtime | `packages/connect-cli/src/server/observations.mjs`, `packages/connect-cli/src/server/session.mjs`, `packages/connect-cli/src/server/gate.mjs` |
| 설치/패키지 | `packages/connect-cli/src/adapters/shared.mjs`, `cloudflare-workers.mjs`, `cloudflare-pages.mjs`, `vercel-static.mjs`, `packages/connect-cli/src/protection.mjs`, `packages/connect-cli/package.json`, `src/connect-cli-distribution.ts` |
| 테스트 | `tests/helpers/auth-d1.ts`, `tests/worker/service-users.test.ts`, `access-support.test.ts`, `membership-refresh.test.ts`, `season-access.test.ts`, `connect-cli-v03-distribution.test.ts`; `packages/connect-cli/test/observations.test.mjs`, `common-gate.test.mjs`, `control-snapshot.test.mjs` |
| 문서 | `CONNECT_CLI.md`, `DESIGN.md`, `docs/CONNECT_SERVER_PROTECTION.md`, `docs/SERVICE_USER_MANAGEMENT.md`, `packages/connect-cli/GATE_SPEC.md`, 단계별 개발 계획과 이 audit |
