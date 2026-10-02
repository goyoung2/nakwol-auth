# T09 운영자 진단·조치·복구 검증

기준: `382d80fdbfae40fb9786d28d139e14dfc7cef4ed` (T08), `feature/commercial-auth-foundation`.
범위: AUTH 중앙 운영자 콘솔과 API, additive migration0019. 로컬 구현·검증이며 운영 배포/원격 DB 변경/SDK 게시를 수행하지 않았다. 외부 개발자의 사용자 관리 D02는 별도 후속 단계다.

## 실행 경로

- 운영자 → 실제 AUTH OAuth 가족에 따른 최근 재인증 → 앱·사용자 진단 → 영향 미리보기 → 버전 CAS·중복 키 확인 → D1 조치 및 감사 원장 → T08 outbox 전파 → 게시/수신 확인을 구분한다.
- 권한은 현재 AUTH 운영자 원장으로 확인한다. owner A/B·일반 회원은 중앙 DTO와 조치를 받지 못한다.
- 기존 grant/revoke/reauthenticate 의미를 유지한다. 신규 deny가 수동 허가보다 우선하며 허가 회수는 회원 역할을 차단으로 바꾸지 않는다.
- 한 사이트 세션 종료는 다른 앱과 중앙 SSO를 유지한다. 전체 재인증 요구는 별도 동작으로 표시한다.
- 10분짜리 일회성 복구 코드는 해시 저장, 발급 앱과 정책 조치에 바인딩, 현 운영자 권한 재검사, 속도 제한, 사유·감사를 적용한다. 복구 코드로 회원 역할이나 콘텐츠 토큰을 발급하지 않는다.
- 계정 복구 화면에서 본인의 접근 실패 지원 코드만 표시한다. 중앙 진단은 선택 앱에 속한 지원 코드만 조회한다.

## 보안 및 호환성 판정

기존 legacy 지원 API를 삭제하지 않고 최근 실제 재인증 검사를 보강했다. 신규 콘솔은 영향 확인·CAS·중복 방지가 있는 operation API를 사용한다. legacy API에는 이 신규 계약이 없으므로 자동 재시도 연동에 사용하지 않는다.

실제 OAuth 검증은 현 bearer 발급보다 이전인 중앙 가족 생성 시각을 기준으로 하며 자동 역할 확인 시각을 사용하지 않는다. 같은 사용자라도 재인증 전에 발급된 bearer는 새 가족을 최근 인증 근거로 사용할 수 없다.

콘솔의 `fastRevocationSupported=false`는 사이트의 제어 프로필이 아직 확인되지 않았다는 뜻이다. T08의 게시 후35초와 local-lease 최대300초를 구분한다. `published`를 전체 사용자 차단 완료로 표시하지 않는다. 지원 보고는 수신 시각과 런타임 버전의 참고 자료다.

## 관측한 검증

모든 테스트는 fixture 사용자와 Discord 응답을 사용한다. 실제 Discord 계정, 운영 Cloudflare, 지역별 네트워크 성능은 이 기록의 증거가 아니다.

| 검사 | 관측 결과 |
|---|---|
| 초기 T09 RED | route404, 누락된 기능 확인 |
| 정책 복원 경계 RED | 기존7200초 세션이 복원3600초로 축소되지 않음 → 공유 정책 경계 처리로 수정 |
| 브라우저 복구 스크립트 RED | 렌더된 inlineJS SyntaxError 재현 → 수정, 실제 렌더 JS 파싱 검사 추가 |
| legacy API RED/GREEN | 오래된 인증으로 지원 조치·역할 저장 성공 재현 → 거부, 기존 계약15/15 통과 |
| 지원 코드와 복구 앱 잠금 RED/GREEN | 본인 지원 코드·실제 계정 앱 보호 검사 추가, T09 11/11 통과 |
| 이전 전체 회귀 | 318/318 통과. 이후 수정이 있어 최종 전체 회귀는 아래 체크포인트에 별도 기록 |

### 실제 HTTP 보호 경로

`actual local HTTP → 공식 serveProtected → 중앙 AUTH workerd → D1/SQLite DO`.
운영자 조치 API로 차단·해제했으며 DB 수동 변경으로 차단을 대신하지 않았다.

| 관측 | 초기 요청 | 유효 제어 캐시 |
|---|---:|---:|
| HTML TTFB | 76.8ms | 8.19ms |
| 이미지300개 완료 | 304.5ms | 268.49ms |
| 중앙 제어 요청 | 1 | 0 |
| 중앙 session refresh | 0 | 0 |

비로그인 `protect verify` 28/28 통과. 운영자 차단 게시 후31.346초에 이미지300개가 모두 거부됐고 asset handler 호출은0회였다. 차단 해제 후 실제 이미지 요청200을 확인했다. 두 phase(차단+해제) 합계 control2/session refresh2이며 차단 phase만은각1회였다. 로컬 병렬 시험 수치이고 운영 사이트의 실제 로딩 시간으로 일반화하지 않는다.

### 실제 브라우저

로컬8795의 실제 번들·workerd·D1: 운영자 로그인 fixture → a앱 진단 → 차단 미리보기 확인 → 접근 거부 → 차단 해제 → 허용. 복구 코드 발급 → 앱 잠금 → 별도 복구 폼 제출 → 복원 → 같은 코드 재사용403. 비운영자 fixture는 관리 workspace가 숨겨지고 중앙 API가403을 반환했다. 복구 재사용의 HTTP403은 예상한 console resource 오류이며 JS 실행 오류는 수정했다.

## 독립 리뷰와 최종 검증

독립 Astra 리뷰: Critical0, Important4, Minor1, 판정 With fixes. 작성자가 다음4건을 한 번의 수정 과정에서 RED→GREEN으로 고쳤으며 재리뷰 승인을 주장하지 않는다.

1. admin/lab→과거member 자동 복원을 거부한다. 같은 정책 유지 또는 guest→member만 허용하고 시간 정책 복원은 유지한다.
2. force refresh를 `pending-refresh`로 예약한다. 실행 잠금60초와 실행 소유자 CAS로 외부 실패·중단을 재개하고, fresh/reauth-required/unavailable을 명시한다. 같은 중복 요청으로 applied라는 거짓 완료를 반환하지 않는다.
3. 완료한 refresh가 사용자 사이트·선택 앱에 인과 operation ID의 제어 문서를 원자적으로 생성·연결한다. 전역 seq 범위 추정은 제거했다. 추가 제어 발행 비용은 운영자 강제 재확인 시에만 발생하며 정적 자산 hot path는 변경하지 않는다.
4. 기존 중앙·owner 정책 저장 경로도 같은 실제 OAuth 가족/현재 bearer 시각 경계를 사용한다. memberships.checked_at 자동 갱신으로 재인증 요구를 우회하지 못한다.

`.wrangler/commercial/t09/review-red.log`는 위4건을 재현했다(정책 재인증에는2개 테스트). `review-green.log` 20/20 통과. 유형 검사도 통과했다.

이어 전체 회귀323/324에서 기존 credential management 테스트가 membership 시각을 재인증으로 취급한 것을 확인했다. fixture를 실제 OAuth 기준으로 갱신하고 자동 역할 갱신·새 가족 생성만으로 기존 bearer가 허용되지 않는 검사를 강화했다. 완료한 역할 재확인 작업의 게시 재시도가 실행 재개 경로에서 빠지는 추가 문제도 실제 workerd/D1/SQLite DO로 RED 재현했다. 완료한 작업은 외부 재확인을 반복하지 않고 게시만 다시 수행하도록 고쳤다. `publication-green.log`2/2 통과.

최종 검증: `npx tsx --test --test-concurrency=4 tests/worker/*.test.ts packages/connect-cli/test/*.test.mjs` → **325/325, 실패0**, 247.426초. 로그 `.wrangler/commercial/t09/verified-full-final.log`, exit0. `npx tsc --noEmit`, CLI pack, `wrangler deploy --dry-run` exit0. dry-run은 Worker638.57KiB/gzip197.37KiB와 D1/DO binding을 확인했으며 원격 배포하지 않았다. 최종 browser-qa.json 및 계정 지원 코드 스크린샷도 같은 ignored 증거 폴더에 보관했다. 테스트 이름 필터로 회귀를 숨기지 않고 전체 Worker+CLI suite를 실행했다.

### 유보한 Minor

영향 미리보기의 세션 수는 단일 세션 종료나 미가입 Discord ID에서 실제 영향보다 크게 셀 수 있다. 서버의 실제 대상·앱 귀속 검사는 유지된다. D02 사용자 관리의 미리보기 정밀화와 함께 후속 수정한다.

### 판단 기록

- 이번 단계는 로컬 코드·실행 검증이다. 운영 활성화를 생략한 비용은 운영에 아직 적용되지 않는다는 점이며, 변경된 DB 원장을 검증 없이 운영에 반영하지 않았다.
- 기존 지원 API 의미와 호출 형식을 보존했다. 신규 preview/CAS/idempotency는 신규 operation API에만 있다. 호환 API를 자동 재시도에 쓰면 중복 감사가 생길 수 있어 문서에 제한했다.
- 최근 인증은 실제 중앙 OAuth 가족과 그 이후 발급 bearer를 기준으로 한다. 자동 역할 갱신은 인증 시각이 아니다. 기존 운영 도구는 Discord 재인증이 필요할 수 있다.
- 리뷰가 별도로 재감사하지 않은 CDN/304/Range/service worker 전범위는 이번 HTTP28개 차단 검사와 전체 회귀를 근거로 유지한다. 운영 CDN의 새로운 구성에 대한 검증을 대신하지 않는다.
- A→B SSO 전체, 다중 isolate·지연 cookie 알고리즘은 변경하지 않았다. 기존 suite 회귀는 확인하지만 이번 단계의 실계정 이동 검증으로 주장하지 않는다.
- T05 전체 승인/TTL 조합은 기존 회귀와 복원 경계 테스트만 확인한다. 새 정책 조합은 별도 설계·검증이 필요하다.
- owner 전용 사용자 관리, UI 편집, 설치 마법사는 D02/D03/D04 후속 범위다. 중앙 API의 owner 차단만 이번 단계에서 확인했다.
- 실제 Discord/운영 D1/배포/호스팅 rollback 실행은 이번 로컬 fixture 범위 밖이다. 운영 복구 훈련은 T12에서 수행하며 코드·문서만으로 운영 검증으로 계산하지 않는다.
- 최종 감사 문서의 수치와 완료 선언은 작성자가 실제 로그와 대조한다. 리뷰어는 작성 중 문서의 최종 완료 선언을 승인하지 않았다.

## 파일과 다음 단계

주요 구현은 `src/admin-operations.ts`, `src/admin-recovery.ts`, `migrations/0019_admin_operations.sql`; 콘솔과 own-account 복구·지원 trace, 기존 지원/역할 API 재인증 경계, 공유 정책 만료 처리 및 실제 D1 테스트를 함께 수정했다. 운영 복구 절차는 [ADMIN_RECOVERY.md](../ADMIN_RECOVERY.md).

변경 파일:

- `src/admin-operations.ts`, `src/admin-recovery.ts`, `src/access-support.ts`, `src/account-recovery.ts`, `src/account.ts`
- `src/service-management-auth.ts`, `src/auth-policy-settings.ts`, `src/role-admin.ts`, `src/index.ts`, `src/sdk-entry.ts`
- `src/connect.ts`, `src/assets/nakwol-connect-admin.js.txt`, `DESIGN.md`
- `migrations/0019_admin_operations.sql`, `tests/helpers/auth-d1.ts`
- `tests/worker/admin-operations.test.ts`, `tests/worker/access-support.test.ts`, `tests/worker/role-settings.test.ts`, `tests/worker/server-session-rotation.test.ts`, `tests/worker/service-management-auth.test.ts`
- `docs/ADMIN_RECOVERY.md`, 본 검증 기록, `docs/superpowers/plans/2026-09-30-commercial-auth.md`

다음 개발 단계: D02 서비스별 사용자 관리. D03 UI 편집, D04 설치 마법사, T10 보호 API hook, T11 통합 수용 검증, T12 출시 및 운영 훈련은 남아 있다.
