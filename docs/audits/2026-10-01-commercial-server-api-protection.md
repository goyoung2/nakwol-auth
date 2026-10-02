# T10 동적 API 보호 검증

## 범위와 재개 기준

- 저장소 `E:/Codex/낙월 인증기/nakwol-auth`, branch `feature/commercial-auth-foundation`.
- BASE `cf815e9520f3afcb47725b1ed304ecb4972b8456`: D04 완료, 재개 시 clean. D04를 반복 구현하지 않았다.
- 설계안의 서비스 소유권 경계·no-store·단일 공통 게이트 및 계획 T10의 변경 요청/CSRF/사용자 헤더/장기 연결 계약을 구현했다.
- Graph generation `2026-09-27T10:21:51Z`의 server 경로는 not_tracked여서 gate/session과 각 공식 어댑터의 실제 소스를 읽었다.

## 실제 실행 경로

`nakwol-connect/server` 공개 entrypoint가 기존 createGate 등의 exports를 유지하며 `authorizeRequest`와 `protectHandler`를 추가한다. 내부 createApiGate가 정적 createGate와 같은 설정 정규화 및 serveProtected/serveServerSession을 호출한다. 기존 cookie 복호화·client/origin 바인딩·lease·선택형 control·refresh/singleflight·background 관측을 재사용한다. 새 OAuth 구현이나 자산별 중앙 조회는 추가하지 않았다.

API 모드만 GET/HEAD/POST/PUT/PATCH/DELETE를 허용하고 변경 요청은 정확한 Origin과 cross-site 거부를 검사한다. body는 핸들러 전에 파싱하지 않는다. 검증된 proof의 userId/clientId/policyVersion과 빈 scopes를 immutable server principal로 전달한다. X-User/역할/NAKWOL 헤더를 제거하고, 서비스의 authorizeResource가 정확한 true일 때만 handler를 실행한다. 콜백 미지정 시 앱 접근 인증만 제공하므로 서비스가 row-level 권한을 따로 검사해야 한다.

성공·리소스 거부 API는 no-store이고 CDN/Cloudflare CDN/Surrogate 캐시 정책도 no-store로 고정한다. 서비스 쿠키와 갱신 쿠키를 모두 전달한다. 기존 정적 GET/HEAD/Range의 private ETag 재검증은 유지한다. API wrapper 예약 경로는404이며 로그인·callback·logout은 정적 게이트로 연결한다. WebSocket 및 SSE 요청/응답은501이다.

## 정책 판단

1. 정적 설치기가 미지의 API·DB 소유권 코드를 자동 작성하면 잘못된 보호 완료가 된다. Workers/Pages의 서비스 Worker 및 Vercel의 실제 서비스 함수는 공개 공식 wrapper를 import하여 연결한다. 자동 정적 어댑터는 기존 서버 설정을 덮어쓰지 않는다. 공개 원본은 별도 폐쇄·검증해야 한다. 틀리면 미연결 API가 공개로 남으므로 문서와 수용 검사에서 자동 완료 주장을 금지했다.
2. 로그인 proof는 DATA 권한 위임이 아니므로 principal.scopes는 빈 배열이고 구 proof policyVersion은0이다. 임의 scope를 발급하지 않는다. 틀리면 DATA 권한을 과다 부여하므로 서비스 문서에 명시했다.
3. Connect0.14.0은 D04에서 아직 게시하지 않은 로컬 후보다. 이번 additive export를 같은 후보에 포함했고 운영 버전의 자동 전환은 하지 않았다.

## 독립 리뷰

fresh Astra reviewer 한 명이 실제 소스로 검토하고 Critical0/Important1/Minor0을 보고했다. SSE media type에 subtype 뒤 공백/탭을 넣으면200이던 문제를 직접 재현했다. 회귀 RED 후 첫 세미콜론 이전의 media type을 trim/lowercase하여501 및 body cancellation을 확인했다. 재리뷰는 하지 않았다.

리뷰어가 판단을 유보한 항목은 다음처럼 처리했다.

- 실제 동적 호스팅 배포·공개 원본 폐쇄: 이번 로컬 hook 검증으로 완료라고 표시하지 않는다. T12/서비스 배포 수용에서 확인한다.
- 실제 DB의 원자적 row 수정: 서비스 책임이다. 두 사용자 HTTP fixture에서 거부 handler0을 확인했고 문서에 owner_id를 쓰기 조건에도 넣으라고 안내했다. 실제 고객 DB 검증은 아니다.
- 플랫폼 CDN 동작: 실제 누출을 재현한 것은 아니다. 다만 handler의 public vendor 캐시 헤더가 그대로 남는 것을 확인해 no-store 계약의 충돌로 판단했다. 추가 RED 후 API 성공과 낮은 수준 hook의 CDN 캐시 헤더를 no-store로 고정했다. 실배포 캐시/잘못된 외부 CDN 설정 검증은 T11에 남는다.

## 실행 증거

`.wrangler/commercial/t10/`에는 운영 Secret·실사용자 자료가 없다.

| 검증 | 결과 | 근거 |
|---|---|---|
| API export 초기 RED | 0/4 | red.log |
| 최초 API/정적 세션 관련 검사 | 36/36 | targeted.log |
| cookie 보존 RED | 0/1 → GREEN | cookie-red.log, final-targeted.log |
| 독립 리뷰·캐시 정책 RED | 0/2 | review-red.log |
| 최종 API 검사 | 10/10 | review-green.log |
| 초기 Connect 전체 | 158/158 | cli-suite.log |
| tsx Connect 전체 재검증 | 160/160 | cli-tsx-repeat.log |
| 생성 Workers/Pages/Vercel 보호 수용 | 각각 익명55·정상해시7, releaseAccepted=true, 이미지300 중앙0 | full-verified.log |
| 최종 전체 회귀 | 369/369, fail/skip0, 545.731초 | full-verified.log, full-verified.exit |
| 최종 CLI pack·TypeScript | exit0 | pack-final.log, typecheck-final.log |
| AUTH Worker dry-run | exit0 | dry-run.log, dry-run.exit |

실제 HTTP acceptance는 두 로컬 Node 서버를 사용한다. 하나는 site entrypoint와 실제 createGate/protectHandler, 다른 하나는 중앙 server code-exchange/refresh 프로토콜 fixture다. 쿠키는 실제 공식 게이트의 start→callback으로 암호화 발급되며 HTTP로 옮긴다. 사용자 A/B, 정상 GET/HEAD/POST/PUT/DELETE, cross-site POST, 비로그인, row 거부, 정책 버전7, lease 만료 시 proof Set-Cookie 및 AUTH503 시 handler0을 확인했다. 중앙/Discord/D1 실운영 검증이 아닌 합성 프로토콜 fixture다.

그 밖에 잘못된 쿠키·다른 client/origin·유효 lease 중앙0·동시 만료300에 재검증1·Range/HEAD·원본 body·위조 헤더·SSE body cancellation·서비스 쿠키 보존을 실제 SDK 실행으로 확인했다. 중앙 단일 호출은 같은 isolate 범위이며 전역1회를 주장하지 않는다. 기존 승인 lease 최대300초와 control 지연 정책을 늘리지 않았다.

검증 중 두 HTTP fixture 결함을 고쳤다: Node 응답의 Set-Cookie 대소문자 중복, 갱신 fixture가 absolute expiry를 늘리던 입력 오류. 게이트의 검증 조건은 완화하지 않았다. 사용자 헤더를 지우는 iterator는 중간 항목을 건너뛰므로 key snapshot으로 수정했다.

## 전체 회귀에서 발견한 연결 실패

첫 전체 실행은 368/369, 549.592초였고 새 HTTP fixture의 첫 login 요청이 `fetch failed`로 실패했다. 같은 `tsx` 조건의 단독 HTTP 1/1 및 Connect 전체 160/160이 다시 통과했다. 원인은 아직 확정하지 않았다. 실패 시 로컬 host와 transport cause를 기록하는 진단만 추가했고 retry/sleep/assertion 완화는 하지 않았다. 전체 범위 재검증은369/369로 통과했다. 단독 성공이나 재실행 성공을 원인 해결로 주장하지 않으며 T11의 시험 안정성 조사 항목으로 남긴다. 최초 실패 이력은 full-final.log에 보존했다.

## 운영 상태

로컬 후보 구현·검증이다. DB migration 추가 없음. 운영 배포·npm 게시·push·외부 서비스 수정은 하지 않았다. 기존 사이트에 API 보호가 자동 적용되었다고 표시하지 않는다. 다음 개발 단계는 T11 재현 성능·비용·장애 시험이고 정식 호스팅/다지역/실사용자/rollout 수용은 후속 단계에 남는다.

구현 commit: `d0396735d5274a74ba15b516b5b06d05201b3008`.
