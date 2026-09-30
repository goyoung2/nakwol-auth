# T08: 선택형 빠른 차단 전파 구현 기록

기준 commit: `592fbd69129ea709b4c5604cfe69ca7c0dbaeac4`.
브랜치: `feature/commercial-auth-foundation`. 운영 배포·npm 게시·원격 migration 없음.
공통 게이트 source 버전: `0.11.0` 출시 후보. 기능 계약: [BOUNDED_GATE_CONTROL](../BOUNDED_GATE_CONTROL.md).

## 구현

- DB 권한 변경과 같은 트랜잭션에서 앱별 outbox 생성. 글로벌 deny는 전체 앱에 반영.
- 앱별 SQLite Durable Object에 단조 증가 projection 저장, 중복 게시 가능.
- 중앙 조회 시작 시각부터 30초인 P-256 서명 문서. client/origin/audience/kid 검증.
- 유효 control + proof는 로컬 복호화·검증 후 asset 제공. 만료 조회는 isolate single-flight.
- 앱 epoch 변경 시 세션별 중앙 재검증 한 번. 승인 실패 캐시도 제한하여 거절 요청 폭증 방지.
- 발행 실패 시 pending/failed 상태와 재시도 유지. 실제 이전 버전을 보고받은 경우만 observed 기록.
- 정책 작업 ID별 fanout 완료 집계. 다른 앱의 미게시 기록이 앱 작업을 영구 pending으로 만들지 않음.
- 권한 변경 버전을 평가 전 읽고 세션 발급·갱신의 D1 INSERT/CAS에서 검사.
- 취소 세션 최대 300개, 초과 시 epoch로 전체 기존 증명 재검증. outbox 30일 보존 후 최신 epoch 유지.
- Workers/Pages/Vercel은 공식 control/session source 공유. 기본 local-lease와 기존 설치 동작 유지.

## 측정

아래는 SDK driver에 중앙 왕복 20ms를 넣은 로컬 fixture입니다. 이미지 payload 다운로드나
실제 브라우저 렌더링·인터넷 지역 지연을 측정한 수치가 아닙니다.

| 프로필/상태 | HTML 응답 ms | 이미지 300개 응답 ms | control 호출 | 세션 재검증 |
|---|---:|---:|---:|---:|
| local-lease | 1.63 | 172.93 | 0 | 0 |
| bounded-control cold | 27.62 | 130.52 | 1 | 0 |
| bounded-control warm | 1.34 | 127.78 | 0 | 0 |
| bounded-control 30초 경계 | 30.99 | 152.36 | 1 | 0 |

별도 실제 HTTP driver: 로컬 HTTP 사이트 → 공식 gate → workerd 중앙 AUTH → D1/SQLite DO.
중앙 서명·세션 발급은 실제 실행 코드와 DB를 사용했습니다. Discord OAuth 승인은 fixture입니다.
HTTP transport는 연결 16개로 제한했습니다. 처음 만든 테스트 서버의 Set-Cookie 중복 전달과
300개 개별 TCP 연결의 ECONNREFUSED를 fixture에서 수정했으며 SDK 소스 결함으로 보고하지 않습니다.

| 실제 로컬 HTTP | HTML ms | 이미지 300개 ms | control | 세션 재검증 |
|---|---:|---:|---:|---:|
| cold | 80.14 | 292.69 | 1 | 0 |
| warm | 1.27 | 246.92 | 0 | 0 |

글로벌 deny 게시 후 **31,273ms**에 300개 새 이미지 요청 모두 403, asset 제공 0회,
control 1회, session refresh 1회. 만료 제어 문서 + 연결 장애는 503으로 차단했습니다.
구 control 문서의 수신 시각으로 유효기간을 연장하지 않습니다.

## 검증과 리뷰

- 전체: `npx tsx --test --test-concurrency=4 tests/worker/*.test.ts packages/connect-cli/test/*.test.mjs`
  **308/308 통과**, 227.53초.
- `npx tsc --noEmit`, `npm run cli:pack`, 실제 Wrangler DO binding 포함 deploy dry-run 통과.
- 실제 HTTP `protect verify`: **28/28 차단 통과**. HTML, 이미지, JSON, 폰트, JS/CSS,
  다운로드의 GET/HEAD/Range/조건부 요청 검사. 생성된 Workers/Pages의 기존 실제 workerd
  검증과 Vercel 어댑터 회귀도 전체 테스트에 포함.
- 없음/변조 쿠키는 control 요청 전 차단. 정상 proof 300개 로컬 처리, epoch 갱신 300개
  single-flight, 독립 module isolate, 만료 replay, 버전 후퇴, 미래 시각, 잘못된 kid,
  다른 origin/app/audience, oversized revocation, 발행 실패/재시도, global fanout/부분 게시 검증.
- DB mutation+outbox rollback, 동시 proof issuance fence, 기존 credential/role/session 회귀 유지.
- 독립 Astra 리뷰: Critical 0, Important 3. 개발자/lab authority trigger, 작업별 게시 집계,
  최신 실패 receipt를 수정. 앱 집계 결함과 authority trigger 누락은 RED를 직접 확인 후 GREEN.
  수정 후 두 번째 독립 리뷰는 실행하지 않았습니다.
- 처음 전체 검증 307/308(안내서 버전); 다음 301/308(독립 fixture 0018 누락 및 게시 실패
  상태 테스트); 모두 수정 후 위 최종 전체 검증을 통과했습니다.

원시 재현 자료: `.wrangler/commercial/t08/{verified-full.log,authority-red.log,review-red.log,
review-fix.log,typecheck-final.log,bundle-final.log,http-driver.ts,http-driver.log}` (로컬 ignored).

## 구현 판단과 남은 범위

작은 권한 변경에도 앱 전체 epoch를 올립니다. 한 사용자의 변경 때문에 다른 정상 사용자도
세션 갱신 한 번을 할 수 있는 보수적인 구현입니다. 향후 세밀한 사용자별 전파 최적화는
T11 측정으로 판단하며 현재 비용을 숨기지 않습니다.
0018을 이 기능에 사용하여 T09 관리자 migration 번호는 0019로 조정했습니다.
이 프로필은 게시 완료 후 새 요청을 최대 35초 안에 차단하는 계약이며, Discord 역할 변경
발견 시점은 T07 계약을 따릅니다. 운영 지역 성능·실제 Discord·브라우저 OAuth 검증은
이번 단계에서 수행하지 않았습니다. 기본 프로필이나 기존 운영 사이트를 전환하지 않았습니다.

다음 단계: T09 관리자 진단·기한부 조치·복구. D02 및 이후 관리 기능, T11 지역 비용/성능,
운영 출시 절차는 남아 있습니다.

## 변경 경로

신규: `src/gate-control.ts`, `src/gate-control-object.ts`, `migrations/0018_gate_control.sql`,
`packages/connect-cli/src/server/control.mjs`, `tests/worker/gate-control.test.ts`,
`packages/connect-cli/test/control-snapshot.test.mjs`, 본 기록과 bounded-control 안내서.

수정: `src/{access-support,auth-policy-settings,server-sessions,sdk-entry,types,connect-cli-distribution}.ts`,
`wrangler.jsonc`, 공통 gate/session, 3개 adapter/shared, protection installer, CLI package/version,
테스트 fixture/배포 버전 계약, CONNECT_CLI/GATE_SPEC/서버 보호 문서와 단계별 계획 체크포인트.
