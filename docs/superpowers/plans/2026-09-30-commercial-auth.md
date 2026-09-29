# NAKWOL AUTH 상용 운영 Implementation Plan

> **For agentic workers:** Use `executing-plans` to implement task-by-task. 사용자가 병렬 실행을 선택할 때만 `subagent-driven-development`를 사용한다. 이 문서는 개발 계획이며 실행 승인이 아니다.

**개정 상태:** 2026-09-30 독립 리뷰 R1~R8 반영. 미구현이며 개정판 독립 재승인 전이다. [리뷰 근거](../../reviews/2026-09-30-commercial-auth-independent-review.md).

**Goal:** 비인가자의 모든 보호 콘텐츠 전송을 차단하면서 반복 로그인과 자산별 중앙 인증을 없애고, AUTH 운영자와 외부 서비스 소유자가 각 권한 범위에서 문제를 진단·복구하고 UI·정책을 편집·설치할 수 있는 공식 서버 SDK를 완성한다.

**Architecture:** 기존 `nakwol-connect/server`를 유지하고 호스팅 어댑터/정책 프로토콜/서버 세션 갱신/관리 제어를 분리한다. 기본 자산 요청은 암호 검증 후 자산 제공으로 끝난다. 빠른 차단은 별도 짧은 제어 snapshot의 비용과 가용성 계약을 가진다.

**Tech Stack:** TypeScript/Hono, Cloudflare Workers+D1, Web Crypto AES-GCM, npm ESM, workerd/Miniflare, 공식 Vercel middleware. Durable Object는 T08에서 성능/비용을 검증할 신규 제어 계층 후보다.

**Spec:** [상용 운영 설계안](../specs/2026-09-30-commercial-auth-design.md)

기준 소스 `4ca24da5e8a4dfd4867ad1f6b88725f1b0f59a40`, Connect0.7.1. 작업 시작 때 dev HEAD와 migration 번호를 다시 확인한다. 아래 `신규` 파일/endpoint/명령은 구현할 계약이며 현재 존재하는 기능으로 취급하지 않는다.

## Global Constraints

- required/member 기본값, 시즌3만 전역 member. guest도 로그인 필수.
- 비로그인 콘텐츠 바이트0, GET/HEAD/Range/조건부 요청 동일 판정. 허용 전에 원본 handler 호출0.
- 기존 사용자가 내려받은 파일 회수를 약속하지 않는다.
- 유효 lease+유효 제어 snapshot의 자산 요청 `/me`0, D1/KV/R2 0.
- local-lease 회수 상한300초, bounded-control 발행 이후30초+clock skew5초. 둘의 차이를 숨기지 않는다.
- Discord 봇은 기본 로그인 요구사항이 아니다. Discord credential은 중앙에만 보관한다.
- 기존 사용자 변경·CI·secret 보존. 외부 소비 사이트 수정은 해당 작업의 승인 범위에서 수행한다.
- 제품 코드/스키마/배포는 이 계획 작성 작업에 포함하지 않는다.
- owner의 조회·조치는 자기 앱에 한정하며 전역 시즌3/deny/다른 앱 세션을 변경하지 않는다.
- UI 숨김·설정 실패·관측 장애로 보호를 해제하지 않는다. 관측/디자인 설정 때문에 자산별 중앙 통신을 추가하지 않는다.
- T01~T12와 D01~D04의 16개 작업을 추적한다. D 작업은 외부 개발자용 첫 정식 출시 필수이며 선택 부록이 아니다.

## Review Focus

| 실제 사용에서 놓치기 쉬운 입력 | 소유 작업 / 필수 검증 |
|---|---|
| A로그인 후 B권한 거부 | T02: A의 중앙 세션 유지, B콘텐츠 차단 |
| 300동시 만료+여러 탭+여러 isolate | T06/T08: 한 토큰의 정상 갱신 경합과 replay 공격 구분 |
| 로그인된 캐시를 로그아웃 뒤 재사용 | T01/T03/T11: CDN hit·304·service worker·Range도 게이트 선행 |
| 관리자 정책 저장 중 제어 발행 실패 | T08/T09: pending 표시, stale snapshot 재연장 금지 |
| AUTH 운영자까지 정책 오류로 잠김 | T09/T12: 독립 복구 수단, 전체 자료 공개 없이 복구 |
| owner 토큰 발급 후 소유권 회수·타 앱 ID 대입 | D01/D02: 현재 귀속 검사, 타 앱 조치·정보0 |
| 오래된 쿠키 응답이 최신 세대를 덮음 | T06: 30초 초과 지연도 정상 복구, 회수 세션 부활0 |
| 정상 role+만료 grant·guest role없음 | T05: 사용한 승인 근거만 만료 계산 |
| UI 숨김·악성 설정·preview 공개 접근 | D03: 보호 유지, 초안 비공개, 안전 기본 화면 |
| 마법사 중단·중복 제출·설정 동시 편집 | D04: 재개/중복0/CAS409, 배포 여부 정확 |

## 1. 단계와 우선순위

| 단계 | 작업 | 산출물 | 다음 단계 진입 조건 |
|---|---|---|---|
| P0 현재 보호 완성 | T01,T02 | 사이트 예외 수정안, SSO/코드 교환 보강 | 비노출·인증 회귀 검증 |
| P1 설치 표준화 | T03,T04 | 공식 Vercel static 어댑터, 전체 경로 검증 | 3호스팅 실배포 검사 |
| P2 정책/사용성 | T05,T06,T07 | 동적 정책, 서버 갱신, 봇 없는 역할 갱신 | TTL경계·SSO·갱신·장애 검증 |
| P3 운영 대응 | T08,T09,T10,D01~D04 | bounded control, 운영/개발자 콘솔, UI·설치 마법사, API hook | 앱 격리/조치/복구/설치 수용 검증 |
| P4 출시 | T11,T12 | 성능·비용 자료, canary·복구·문서 | 상용 출시 기준 전부 충족 |

T09의 화면/진단은 T05 이후 먼저 개발 가능하고 전파 완료 표시는 T08 이후에만 제공한다. T01의 소비 사이트 설정 수정은 AUTH 라이브러리 배포를 기다릴 이유가 없다. T08이 목표를 못 맞추면 local-lease 제품으로 제한해 출시는 가능하지만 '신속 차단 상용 등급' 완료라고 보고하지 않는다.

작업 순서: T01~04 → T05와D01의 공통 권한/정책 계약 → T06/T07 → D02 및 T09. D03은 D01/T03 이후, D04는 D03/T05 이후 진행한다. T08은 독립 성능 검증 후 조치 전파에 결합하고 T11/T12는 16개 작업 전체를 수용한다. D02/T06은 T08 없이 local-lease 모드에서도 동작해야 한다.

규모 추정 개정: 기존6~10인주에 D01~D04 및 추가 경합 검증 약4~6인주를 반영한 **10~16인주+canary 관찰 기간**을 임시 계획 범위로 둔다. 실측 견적이 아니며 T01~04와 D01 계약 확정 후 파일별 재산정한다. 모델 속도나 코드 생성량으로 운영 검증 기간을 대체하지 않는다.

## 2. 공통 작업 방법과 완료 증거

각 작업은 별도 feature/fix 브랜치→dev PR. 스키마는 additive, source/test/docs를 한 기능 단위로 커밋한다. `npm run test:unit`, `npm run typecheck`는 작업 말미에 영향 범위를 확인하고 릴리스에서 전체 실행한다. 실제 플랫폼 결과는 별도 artifact다.

모든 PR에 다음을 남긴다: 기준 SHA, 변경 계약, 실행한 명령/결과, 실제 배포 ID, 익명화된 실패 증거, 현재 미지원 범위, 이전 정상 artifact, rollback 방법. 단순 HTTP200·헤더 버전·문자열 정규식 테스트는 인증 동작 합격 근거로 충분하지 않다.

## T01. 공개 경로 차단 및 검증 증거 보존 — P0

**대상:** 별도 가이드 저장소 `E:/Codex/낙월 홈페이지 제작소/nakwol-portal-guidelines-main`의 `middleware.js`, `vercel.json`, `worker/index.js`, `scripts/test-gate.mjs`. AUTH에 `docs/audits/2026-09-29-server-gate-baseline.md` 신규. 소비 사이트 변경은 해당 저장소 상태/지침/배포 승인을 확인한 작업에서 수행한다.

**입력/출력:** 9월29일844주소 인벤토리→배포 ID에 묶인 보호 manifest와 결과. 공개 경로는 정확한 allowlist로만 유지한다. 기본안은 version.json도 보호하고 운영 확인은 인증된 경로로 옮긴다.

- [ ] 이미지279+_astro6+아이콘2+version1의 비로그인200/206을 fixture와 현재 운영에서 최소 재확인한다.
- [ ] Vercel 전체경로 matcher로 전환, 콘텐츠 public/immutable 헤더 제거. Cloudflare version 예외도 동일 계약으로 정리. 로그인 bootstrap이 이 자산에 의존하지 않는지 확인한다.
- [ ] 빌드 인벤토리의 모든 파일/HTML 별칭을4방식으로 검사한다. 정상 계정이 로그인 후 같은 파일을 받을 수 있는지, ETag가 있어도 비로그인304가 없는지 확인한다.
- [ ] 정상/차단 계정, A→B, 재방문을 실브라우저로 확인하고 배포별 증거를 저장한다.
- [ ] 예전 배포·alias·버킷·공개 소스 자료를 목록화한다. 삭제는 별도 명시 승인, 미확인은 완료로 처리하지 않는다.

**실행:** 각 사이트의 기존 build/test/deploy 절차, AUTH CLI `protect verify --provider custom --url <등록주소> --paths <manifest경로들> --expect-runtime 0.7.1 --json`. 큰 인벤토리는 T04에서 파일 입력 옵션으로 대체한다.
**합격:** 비로그인 보호 경로2xx/304/원문0, 정상 계정 제공 성공. 사이트 설정 문제라 공통 패키지 재발행 불필요.

## T02. 중앙 인증의 격리와 일회성 소비 — P0

**수정:** `src/index.ts`, `src/store.ts`, `src/policy.ts`, `tests/worker/authorize-reverify-roles.test.ts`.
**신규 테스트:** `tests/worker/oauth-concurrency.test.ts`, `tests/worker/sso-isolation.test.ts`.

**계약:** `diagnoseApplicationAccess`의 앱 거부/신원 무효/일시 장애를 구분. code 교환은 동일 code의 병렬 요청 중 하나만 성공한다.

- [ ] 실제 Hono+D1 test DB에서 A세션 유효→B추가역할 부족→`prompt=none` 테스트를 만들고 A의 sid가 유지되는지 확인한다.
- [ ] `APP_DISABLED`, `SEASON_ROLE_MISSING`, `ADDITIONAL_ROLE_MISSING` 등 앱 거부에서 중앙 sid 삭제를 제거. `USER_DISABLED`/명시적 session revocation은 계속 차단한다. B유효 사이트 쿠키는 만들지 않는다.
- [ ] 동일 authorization code20개 동시 교환을 재현한다. 현재 중복 성공 여부를 기록한 뒤, 조건부 원자 consume와 토큰 INSERT를 하나의 DB승인 단위로 묶는다. 단순 SELECT후UPDATE 재사용 금지.
- [ ] 구현 후보는 조건부 claim `UPDATE ... WHERE used_at IS NULL AND expires_at > now RETURNING ...` + 발급 원자 트랜잭션이다. D1에서 발급과 원자성이 구현되지 않으면 `INSERT ... SELECT`와 변경수/claim ID를 포함하는 batch로 증명한다. 실패 시 토큰0개, 성공1개가 판정 기준이다.
- [ ] Discord callback transaction도 브라우저 state/만료/중복 소모를 검사한다. 이 단계에서 봇 의존성 추가 금지.

**실행:** `npx tsx --test tests/worker/oauth-concurrency.test.ts tests/worker/sso-isolation.test.ts tests/worker/authorize-reverify-roles.test.ts`.
**합격:** 앱 거부가 다른 앱 로그인에 영향0, 병렬 code교환 성공1회, 잘못된 PKCE/origin/redirect는 발급0.

## T03. 공식 어댑터와 설치 계약 — P1

**수정:** `packages/connect-cli/src/protection.mjs`, `config.mjs`, `commands.mjs`, `project.mjs`, `src/server/{gate,login}.mjs`.
**신규:** `packages/connect-cli/src/adapters/{cloudflare-workers,cloudflare-pages,vercel-static}.mjs`, `test/vercel-adapter.test.mjs`.

**계약:** 각 adapter가 `generate(config,inventory)`, `inspect(root,config)`, `capabilities`를 제공. 코드 복사본을 따로 유지하지 않고 공통 gate에서 생성한다. 기존 `protect install/update/status`, doctor출력의 기존 필드는 유지하고 schemaVersion/capabilities를 추가한다.

- [ ] Vercel fixture에 기존 matcher/headers 충돌을 넣어 설치가 조용히 덮어쓰지 않는 테스트 작성.
- [ ] `--provider vercel`은 1차에 정적 빌드만 지원. 모든 경로 matcher·bootstrap route·캐시 계약·secret명·등록origin·빌드출력 검증을 생성한다.
- [ ] settings를 URL.origin으로 정규화하고 `new URL('/sdk/...',authOrigin)` 사용. trailing slash두 형태에서 같은URL이고 SDK 로드 실패 시 재시도/복구 링크가 실제 동작하는 테스트 추가.
- [ ] provider에 맞는 공식 검사로 라우팅 순서·Range/HEAD·rewrite 뒤 응답·캐시hit를 테스트한다. Next SSR 자동 감지 시 현재는 미지원으로 명시하고 Embed대체로 성공 처리하지 않는다.
- [ ] Workers/Pages 생성 결과가 현재 gate 의미와 동일한지 기존 workerd테스트 유지.

**실행:** `node --test packages/connect-cli/test/common-gate.test.mjs packages/connect-cli/test/server-worker-runtime.test.mjs packages/connect-cli/test/vercel-adapter.test.mjs packages/connect-cli/test/login-return.test.mjs`.
**합격:** 3플랫폼 fixture 로그인/비로그인 실배포 통과, 개발자가 OAuth나 쿠키 코드를 작성하지 않아도 설치 가능.

## T04. 배포 검증을 보호 범위 증명으로 확장 — P1

**수정:** `packages/connect-cli/src/protection-verify.mjs`, `protection.mjs`, `release-check.mjs`, `src/gate-reports.ts`, `test/custom-protection.test.mjs`.
**신규:** `src/protection-inventory.ts`, `packages/connect-cli/test/protection-evidence.test.mjs`.

**계약:** CLI `--manifest <file>`와 `--origins-file <file>` 추가. manifest는 schemaVersion, deploymentId, buildHash, 파일paths+size+hash, runtime/capabilities를 가진다. 중앙 전송은 요약이며 private path는 최소화한다.

- [ ] 응답401에 private canary가 섞인 fixture, cachehit304, 302→공개자료, 404,503를 분리하는 테스트 작성.
- [ ] bounded body검사, 알려진 테스트 canary/내용 해시, no-body HEAD, Range/content-type 검사. 확인하지 않은 대용량 body는 부분검사라고 표시한다.
- [ ] 정상 계정으로 자료가 실제 존재함도 검증한다. 무조건401을 반환하는 고장난 사이트를 출시합격으로 만들지 않는다.
- [ ] 배포ID/manifest 바뀜은 검사 무효화. origin별 verified/exposed/closed/unreachable/unknown을 분리. 헤더위조만으로 verified 불가.
- [ ] 원격 origin 발견은 read-only 플랫폼 API 사용. 등록된 계정 범위 밖은 조회하지 않는다. 중앙검사 기능에는 설계안§5의 SSRF방어를 적용한다.

**실행:** `node --test packages/connect-cli/test/protection-evidence.test.mjs packages/connect-cli/test/custom-protection.test.mjs packages/connect-cli/test/deployment-rollback.test.mjs`.
**합격:** T01의 공개 경로를 fixture에서 탐지하고, 401body유출도 실패. 자동 rollback은 실노출과 단순연결장애를 구분하며 마지막 안전한 배포만 사용.

## T05. 정책 모델·관리 API·버전 협상 — P2

**수정:** `src/{policy,store,index,types,access-support,gate-reports}.ts`, `src/assets/nakwol-connect-admin.js.txt`, `packages/connect-cli/src/server/gate.mjs`.
**신규:** `src/auth-policy-settings.ts`, `src/auth-policy-admin.ts`, `migrations/0015_auth_policy_settings.sql`, `tests/worker/auth-policy-settings.test.ts`.

**데이터:** 전역default와 appoverride, monotonic version, updated_by/reason; access_grants에 expires_at, 명시적 deny 별도테이블(scope app/global); 세션/정책 변경 outbox. migration번호는 실행 시 재배정한다.

**인터페이스:** `resolveAuthPolicy(env,clientId)`→effective policy; `saveAuthPolicy(env,{actor,clientId,expectedVersion,patch,reason})`→새version/operationId; `evaluateAccess(...)`→allow/deny/reason/source/validUntil/policyVersion. legacy `/me` 응답 필드는 보존한다.

- [ ] lease=0/301초, idle>absolute, 만료grant, grant+deny, inactiveuser+grant, adminrole수동대체 테스트 작성.
- [ ] D01의 현재 owner/capability 검사로 자기 앱 session idle(1시간~10일)/absolute(1시간~30일, idle≤absolute)/lease(60~300초)를 위임 범위에서 허용. member→guest, 전역상한·grantableConditions 변경은 운영자 권한/영향미리보기로 한정.
- [ ] 모든 만료를 server time으로 계산. 변경시 version CAS, 충돌409. 기존 토큰 만료 연장/부활 금지.
- [ ] `leaseUntil=min(verifiedAt+leaseMs,accessExpiresAt,sessionExpiresAt,authorizationEvidenceValidUntil)` 적용. 사용한 source와 면제 불가능한 조건만 validUntil에 포함하고 v2쿠키의 기존 의미 보존. stale role+플랫폼 승인 grant, 정상 role+만료 미사용 grant, guest+role 없음, grant+deny 네 fixture에서 source/만료를 검증한다.
- [ ] 2시간 session 설정, owner 범위 밖/타 앱 변경 거부, 축소 반영 기한, 확대 시 만료 세션 부활0을 테스트. UI에 정책값/유효값/신규·기존 적용대상/예상반영시간/마지막 관측 버전/미지원런타임을 구분. 0.7.x에 동적정책 적용완료로 표시하지 않는다.

**실행:** `npx tsx --test tests/worker/auth-policy-settings.test.ts tests/worker/season-access.test.ts tests/worker/access-support.test.ts`.
**합격:** 앱별정책버전 일관, 권한완화 권한검사, stale CAS 거부, legacy 응답회귀없음.

## T06. 서버 콜백과 세션 갱신 — P2

**수정:** `src/{index,store,types}.ts`, `packages/connect-cli/src/server/{gate,login}.mjs`, `src/assets/nakwol-connect-v1.js.txt`.
**신규:** `src/server-sessions.ts`, `src/server-session-routes.ts`, `packages/connect-cli/src/server/session.mjs`, `migrations/0016_server_sessions.sql`, `tests/worker/server-session-rotation.test.ts`, `packages/connect-cli/test/server-sso.test.mjs`.

**인터페이스:** 서버전용 `/server/v1/code-exchange`, `/server/v1/session/refresh`, `/server/v1/session/revoke`. site credential별 client/origin scope와 token audience를 확인. 게이트 `/__nakwol/callback`은 PKCE/state transaction을 검증한다. 일반 브라우저 `/token`은 호환 유지.

- [ ] 가짜 clock으로 1시간 만료, 300동시·2isolate, 30초 초과 응답 지연, 다음 세대 뒤 이전 Set-Cookie 도착, 응답 유실, 동시 logout/deny를 재현한다. 정상 경합과 잘못된 handle/credential을 구분한다.
- [ ] 안정 handle의 hash/sessionId/family/generation/clientId/origin/sitecredential/idle/absolute/revoked 상태를 중앙 저장. 중앙 CAS는 `(clientId,origin,sessionId,expectedGeneration)`으로 한 번 전진하고 경쟁 요청은 최신 활성 상태 반환. 30초 결과 캐시는 최적화이며 오래된 generation만으로 family를 폐기하지 않는다.
- [ ] browser에는 host-only HttpOnly/Secure/SameSite=Lax AEAD handle(clientId+siteOrigin+sessionId+난수 bearer)과 AES-GCM proof. proof는 kid/version/sessionId/generation/source/verifiedAt/leaseUntil/authorizationEvidenceValidUntil을 포함하고 전체 쿠키 크기는 실브라우저 한도 내(각4KiB 미만)로 검사한다. handle/proof sessionId 불일치는 차단. 유효 proof는 중앙 handle 조회 없이 로컬 검증한다.
- [ ] refresh는 handle+site credential을 검증하며 중앙 SSO family와 revoke 상태를 확인. 갱신 응답은 proof만 교체하고 handle은 변경/삭제하지 않는다. 늦은 proof는 다음 중앙 확인에서 최신 세대로 복구한다. revoke와 갱신은 원자적 상태 전이로 순서화하고 회수된 handle은 재활성화하지 않는다.
- [ ] 회수 이전 proof가 늦게 도착한 경우에도 local-lease300초/bounded-control35초의 공시 상한 이후 허용0을 확인. cookie 삭제만으로 회수를 구현하지 않는다. T08 없는 fixture에서도 refresh 정상 동작을 입증한다.
- [ ] cookie key current+previous를 제한기간 허용하고 긴급 key revoke는 전체무효화. 중앙 site credential/쿠키 키/Discord 암호 키를 분리. stable handle의 bearer 탈취 위험과 앱 단위 회수 경로를 문서화한다.
- [ ] 정상 access expiry는 페이지 재로그인 없이 server refresh. lease와absolute expiry를 sliding으로무한연장하지 않는다.
- [ ] 한사이트logout/전체logout/re-auth요구를 구분. callback과refresh는CSRF/Origin/bodylimit/no-store, private 내부헤더는 외부요청에서 신뢰하지 않는다.
- [ ] 최초B접속은 중앙SSO복귀, 자산 subrequest는 loginHTML redirect를 받지 않도록401/JSON 유지. HTML navigation만 자동연결한다. query/hash는안전하게복귀.

**실행:** `npx tsx --test tests/worker/server-session-rotation.test.ts`; `node --test packages/connect-cli/test/server-sso.test.mjs packages/connect-cli/test/authorization-lease.test.mjs`.
**합격:** 1시간→갱신 때 로그인 버튼0, validSSO A→B Discord화면0, 실제expire/deny는차단, 잘못된 credential/다른 app/origin/회수 handle은0발급. 늦은 응답 때문에 정상 사용자의 강제 로그인0. 최대30일 정책은 유지. 경합 입증 실패 시 자동 갱신 출시 금지.

## T07. 중앙 OAuth credential과 역할 자동 갱신 — P2

**수정:** `src/discord.ts`, `src/store.ts`, `src/policy.ts`, `src/types.ts`.
**신규:** `src/discord-credentials.ts`, `src/membership-refresh.ts`, `migrations/0017_discord_credentials.sql`, `tests/worker/membership-refresh.test.ts`.

**인터페이스:** `ensureFreshMembership(env,userId,{maxAgeMs,force})`→fresh/reauth-required/unavailable, checkedAt/validUntil. 사용자별 동시갱신 lease/CAS는 중앙에서 관리한다.

- [ ] OAuth fixture로정상refresh/회전/429/5xx/invalid_grant/404탈퇴/새role/role제거/동시앱조회 테스트 작성.
- [ ] 중앙에서 access/refresh token을 별도 AEAD키로 암호화보관. expires_in/현재권한scope 검증, 읽기권한최소화,삭제/키회전 경로 제공.
- [ ] Discord 역할15분 정책은 credential존재사용자에게만 적용. legacy 사용자UI에는 재동의필요를 표시하고 이전24시간fallback을 전환기간에 한정한다.
- [ ] 429 Retry-After준수, 사용자별single-flight,hard expiry를넘어오래된정상role로승인금지. 조회실패로정상role을없음으로덮어쓰지않는다.
- [ ] admin '역할다시확인'은force경로재사용, 사용자가없는경우복구링크반환.

**실행:** `npx tsx --test tests/worker/membership-refresh.test.ts tests/worker/season-access.test.ts`.
**합격:** 봇없이refresh, 정상 사용자재로그인 0, role제거는validUntil이후거부, credentials브라우저/로그노출0.

## T08. 짧은 차단 전파 프로필 — P3, 성능 검증 후 활성화

**신규:** `src/gate-control.ts`, `src/gate-control-object.ts`, `packages/connect-cli/src/server/control.mjs`, `tests/worker/gate-control.test.ts`, `packages/connect-cli/test/control-snapshot.test.mjs`.
**수정:** 실제 운영 Wrangler설정의 binding/migration, `src/sdk-entry.ts`, `src/access-support.ts`, `packages/connect-cli/src/server/gate.mjs`.

**인터페이스:** `/server/v1/control`→서명snapshot(schemaVersion,clientId,siteOrigin,version,issuedAt,expiresAt,appStatus,policyFloor,revocations). `publishControl(operationId)`는idempotent. `readControl`은유효문서메모리+single-flight만사용.

- [ ] frozenclock/multipleisolate fixture에서30초안의회수,만료snapshot replay,미래시각,잘못된kid,다른origin,발행실패를테스트한다.
- [ ] DO조정자 prototype을 isolatedfixture에서계측. cacheTTL을수신때마다연장하지않고origin발행만료를검증. snapshot조회마다DB전체조회금지.
- [ ] outbox/publish/observation상태를분리. appglobal차단을한앱에만잘못전파하지않도록사용자소속앱목록과실패재시도처리.
- [ ] 최대64KiB snapshot넘으면appepoch전환,불필요하게매자산me요청하지않고세션별single-flight. tombstone은관련세션/lease가더이상유효하지않을때만정리한다.
- [ ] coldstart/30초경계요청추가RTT,정상warm0control,제어장애503를측정. old0.7사이트는unsupported로표시하고성공대상에서제외.
- [ ] 목표실패시프로필 자동 승격 금지. local-lease지원은유지하고그회수상한300초를정확히표시.

**실행:** `npx tsx --test tests/worker/gate-control.test.ts`; `node --test packages/connect-cli/test/control-snapshot.test.mjs`; T11벤치2프로필비교.
**합격:** 발행 후35초이내신규요청차단,네트워크 분할에서stale승인연장0,유효snapshot내자산별네트워크0.

## T09. 관리자 진단·기한부 조치·자기 복구 — P3

**수정:** `src/access-support.ts`, `src/account-recovery.ts`, `src/gate-reports.ts`, `src/assets/nakwol-connect-admin.js.txt`, `src/role-admin.ts`.
**신규:** `src/admin-operations.ts`, `src/admin-recovery.ts`, `migrations/0018_admin_operations.sql`, `tests/worker/admin-operations.test.ts`.

**범위:** 중앙 운영자 콘솔과 D01/D02 개발자 콘솔은 권한·DTO·조치를 분리한다. owner는 자기 앱 사용자 조회/차단/세션 종료를 D02에서 수행하며 기존 중앙 reauthenticate를 재사용하지 않는다.

**인터페이스:** 기존grant/revoke/reauthenticate 유지. 새actions `deny`,`clear-deny`,`refresh-membership`,`revoke-session`,`lock-app`,`restore-policy`. operationId와status는T08공유. 이전revoke는deny로의미를바꾸지않는다.

- [ ] 운영자/앱 owner/다른앱 owner/일반 user,자신을마지막 운영자로차단,만료된임시허가,operation중복재시도테스트.
- [ ] 운영자 사용자×앱 진단에실제판정reason+역할갱신시각+site버전+관측시각을표시한다. owner 응답은 D01 최소 DTO로 제한한다. 요청별traceId는원문PII없이발급, support UI에노출.
- [ ] 영향미리보기→version CAS저장→접수/발행/관측/시간상한표시. 자동복구가role조건을낮추거나서비스를guest/public으로바꾸지못하게한다.
- [ ] 중앙에서 차단한유저의실제 요청 실패와권한 복구 후정상 요청을공통 fixture로검증. support사용자에게관리자상세역할목록/다른 회원 정보노출금지.
- [ ] 일회성운영복구코드와오프라인호스팅rollback runbook. 최근운영자재인증/속도제한/사유필수/감사기록. recovery기능으로자료접근을직접허용하지않는다.

**실행:** `npx tsx --test tests/worker/admin-operations.test.ts tests/worker/access-support.test.ts tests/worker/gate-reports.test.ts`; 실제 브라우저운영자/비운영자 조치 시나리오.
**합격:** '잘못된정책으로막힌사용자'를코드수정없이원인확인→기한부 조치→결과확인가능. 즉시회수불가사이트는미지원으로명확히표시.

## D01. 서비스 관리 권한과 owner API — P2/P3, R1/R4/R8

**선행:** T05와 권한/capability 계약 공동 확정. **수정:** `src/connect-cli-apps.ts`, `src/index.ts`, `src/types.ts`, `src/access-support.ts`의 공통 판정 추출만(전역 조치 의미 유지).
**신규:** `src/service-management-auth.ts`, `src/service-management-routes.ts`, `src/service-management-types.ts`, `tests/worker/service-management-auth.test.ts`.

**인터페이스:** `requireServiceOwner(env, actor, clientId)`는 현재 소유권과 관리 capability를 검사한다. `requireAppTarget(env,clientId,{subject,sessionId,operationId})`는 제공된 모든 대상의 귀속을 확인한다. `/developer/v1/apps/:clientId/*`는 owner용, 기존 중앙 운영 API는 operator용이다. 사람의 관리 세션과 서버 site credential을 혼용하지 않는다. `getServiceCapabilities`는 editable policy 범위와 grantableConditions를 반환한다.

- [ ] actor A owner/B owner/operator/user와 소유권 회수 후 이전 토큰 fixture를 만든다. URL뿐 아니라 body의 clientId, sessionId, operationId, cursor, support code를 바꿔도 타 앱 필드/조치가 나오지 않아야 한다.
- [ ] 최소 DTO를 설계안§10과 일치시키고 중앙 운영자 응답 재사용을 금지한다. 신규 Discord ID 사전등록 응답은 중앙 계정 존재 여부를 드러내지 않는다.
- [ ] 변경 API에 CSRF/최근 재인증/사유/속도 제한/감사를 적용한다. owner는 global scope, 전역 시즌3 변경, 중앙 전체 logout, 위임 밖 grant를 실행할 수 없다.
- [ ] 실제 콘솔의 권한 없는 버튼 숨김과 서버 거부를 각각 확인한다. 소유권 회수 즉시 관리 API 거부는 콘텐츠 lease와 별개다.

**실행:** `npx tsx --test tests/worker/service-management-auth.test.ts` 및 A/B owner 브라우저 API 조작 fixture.
**합격:** 자기 앱 필수 관리 허용, 타 앱 및 전역 관리0. 감사와 오류 응답에도 다른 앱 PII0.

## D02. 서비스 사용자 목록과 앱 단위 조치 — P3, R1/R2/R4

**선행:** D01, T05, T06. **수정:** `src/index.ts`, `src/gate-reports.ts`, `packages/connect-cli/src/server/gate.mjs`.
**신규:** `src/service-users.ts`, `src/service-user-routes.ts`, `src/assets/nakwol-developer-users.js.txt`, `packages/connect-cli/src/server/observations.mjs`, `migrations/0019_service_users.sql`, `tests/worker/service-users.test.ts`, `packages/connect-cli/test/observations.test.mjs`. migration 번호는 실행 시 재배정한다.

**데이터:** app_user_relationships(client_id,subject,first_authorized_at,last_authenticated_at,last_observed_at,status), 익명/식별 가능한 시도 이벤트, 별도 app deny tombstone과 감사. 상세 source/time/지연을 유지한다. 관계 삭제가 중앙 users를 삭제하지 않는다.
**인터페이스:** `GET /developer/v1/apps/:clientId/users?cursor&limit&state`, `GET .../users/:subject`, `POST .../users/:subject/actions`(deny/clear-deny/revoke-app-sessions/grant/clear-grant/delete-relationship). 사전등록은 `POST .../users`의 검증된 Discord ID 입력이다. `POST /server/v1/observations`는 site credential+app/origin scope로 보호한다. 모든 action은 reason/expectedVersion/idempotencyKey를 받고 operationId 반환. revoke-app-sessions는 해당 client의 family만 회수하며 중앙 reauthenticate를 호출하지 않는다.

- [ ] 최초 승인/로그인했으나 미방문/lease 재방문/거부/익명/사전등록을 구분하는 목록 fixture와 cursor50/최대100, 필터, 상세를 작성한다.
- [ ] 게이트 승인 결과에서만 관측 생성. 앱·사용자·5분 구간 coalescing, isolate 큐 최대128건, 배치 최대50건, 전송 timeout2초/재시도1회 후 drop 집계. 수신측 같은 구간 upsert로 중복 억제. 인증 응답은 관측 전송을 await하지 않고 provider의 공식 background hook을 사용하며 지원 없는 환경은 관측 미지원으로 표시한다.
- [ ] 300이미지/10isolate에서 실제 전송·중복·drop·CPU/bytes 기록. AUTH 관측503·큐 포화에도 콘텐츠 승인 지연/판정 영향 없음. 동기 원격 쓰기0. 사용자 목록에는 마지막 관측·지연 표시, 온라인으로 단정 금지.
- [ ] A app deny 후 B 정상, A session revoke 후 B/중앙 SSO 유지, grant 만료 및 deny 우선, 같은 action 재시도1회 효과를 실제 fixture로 확인한다. local-lease/bounded-control별 반영 기한을 표시한다.
- [ ] 관계 삭제 후 중앙/타 앱 자료와 deny tombstone 보존. 익명 요청을 가짜 Discord 사용자로 생성하지 않는다. owner가 지원 코드/검색으로 무관한 중앙 사용자를 열거하지 못한다.

**실행:** `npx tsx --test tests/worker/service-users.test.ts`; `node --test packages/connect-cli/test/observations.test.mjs`; 두 owner+일반 사용자 브라우저 목록→차단→해제→세션 종료 확인.
**합격:** owner가 자기 서비스 문제를 조치하며 타 앱 영향0, 관측 실패로 인증 실패0, 자산 수 비례 중앙 기록0.

## D03. 인증 UI 편집·미리보기·게시 — P3, R3

**선행:** D01/T03. **수정:** `src/index.ts`, `src/assets/nakwol-connect-v1.js.txt`, `packages/connect-cli/src/server/login.mjs`.
**신규:** `packages/connect-cli/src/shared/presentation-schema.mjs`, `src/service-presentation.ts`, `src/assets/nakwol-developer-presentation.js.txt`, `migrations/0020_service_presentation.sql`, `tests/worker/service-presentation.test.ts`, `packages/connect-cli/test/presentation.test.mjs`.

**스키마:** 설계안§10의 schemaVersion/version/widget/theme/screens/support와 동일. validator는 중앙·CLI가 함께 소비하도록 패키지 export하고 TS 선언을 제공한다. 기존 SDK variant/theme 토큰과 Connect headless 기반을 재사용한다.
**인터페이스:** owner `GET/PUT .../presentation/draft`, `POST .../presentation/preview|publish|rollback`; PUT/publish/rollback은 expectedVersion CAS. public `GET /public/v1/apps/:clientId/presentation`은 게시된 브랜드 데이터만 제공. preview는 owner 인증 필요. rollback도 새 version을 발행한다.

- [ ] visible/hidden×inline/fixed/sticky×3variant, light/dark/system 및 login/checking/denied/unavailable 상태 fixture를 만든다. hidden에서도 비로그인 HTML/이미지/JSON/HEAD/Range 차단을 재확인한다.
- [ ] 편집→상태/모바일 미리보기→게시→이전 버전 복원 흐름을 구현. 실제 연결 상태/재시도/지원 동작은 runtime 소유이며 임의 코드·거짓 connected 문구 설정을 허용하지 않는다.
- [ ] 텍스트 escape, HTTPS 지원 링크, PNG/WebP/JPEG512KiB/2048px 한도와 실제 MIME/decode 확인. SVG/HTML/JS/CSS 주입 거부. 소유 앱별 브랜드 저장소 namespace/업로드 권한을 검사하고 새 저장소가 필요하면 비용을 T11에 포함한다.
- [ ] 공개 bootstrap에서 PII/secret/private path/초안 노출0. 보호 앱 bundle 없이 화면 렌더. 게시 설정만 ETag/60초 캐시; schema 불일치·깨진 로고·네트워크 실패는 안전 기본 테마. UI 변경으로 인증 세션 폐기0, 자산별 설정 조회0.
- [ ] headless의 로그인/로그아웃/복구 연결, 키보드 focus/reduced-motion/mobile safe area/클릭 가림을 브라우저로 확인. 상태 깜빡임/8초 복구 안내는 T03/T06과 동일 계약이다.

**실행:** `npx tsx --test tests/worker/service-presentation.test.ts`; `node --test packages/connect-cli/test/presentation.test.mjs`; 데스크톱/모바일 상태별 화면과 network 증거.
**합격:** 자기 앱만 편집, 초안 비공개, 안전 렌더링, 보호 유지, 지원 runtime에 게시 버전 반영 확인.

## D04. 설치·재설정 마법사 — P3, R7/R8

**선행:** D03/T05/T03. **수정:** `src/connect-onboarding.ts`, `packages/connect-cli/src/{config,commands,protection}.mjs`.
**신규:** `packages/connect-cli/src/shared/setup-schema.mjs`, `src/assets/nakwol-developer-setup.js.txt`, `tests/worker/developer-setup.test.ts`, `packages/connect-cli/test/setup-resume.test.mjs`.

**인터페이스:** setup JSON은 schemaVersion/clientId/siteOrigin/provider/buildDirectory/presentationVersion/policyVersion/step/idempotencyKey. presentation validator와 policy capability를 재사용하며 secrets는 포함하지 않는다. 기존 `protect install/update` 계약을 유지하면서 `--setup-file <file>` 비대화형 입력을 추가한다. 중앙 설정 저장/CLI 설치/실제 배포 상태를 별도 반환한다.

- [ ] 서비스 선택→origin/호스팅→UI preview→정책/실효값→diff 검토/저장→설치/배포/verify 흐름. unsupported 환경은 해결 안내와 미지원 상태를 표시하며 Embed로 보호 완료 처리 금지.
- [ ] 각 단계 종료/재시작, 중복 제출, 설정 CAS409, stale capability, secret 미설정을 재현한다. 재개 후 앱/credential 중복0, 다른 사용자의 setup ID 접근0. resume key는 비밀값을 대신하지 않는다.
- [ ] 기존 프로젝트 재설정에서 현재 설정과 diff를 제시하고 관계 없는 CI/소스를 덮어쓰지 않는다. 기존 exact dependency/lockfile/update/doctor 계약을 유지한다.
- [ ] 브라우저/CLI 입력이 동일 validator에서 같은 오류를 내는 계약 시험. UI·정책 저장과 runtime 적용은 구분하고 구 runtime을 적용 완료로 표시하지 않는다.
- [ ] 신규 외부 개발자가 지원 플랫폼 fixture에서 OAuth/쿠키 코드 수작업 없이 설치, 디자인 변경, 2시간 정책 설정, 차단 검사와 정상 사용자 접속까지 수행한다.

**실행:** `npx tsx --test tests/worker/developer-setup.test.ts`; `node --test packages/connect-cli/test/setup-resume.test.mjs`; Workers/Pages/Vercel static 각각 설치→doctor→protect verify→정상 접속 수용 시험.
**합격:** 모든 초기 설정을 같은 흐름에서 완료, 중단 재개/충돌 처리 정상, 실제 보호 검증 전 완료 표시0.

## T10. 동적 API 보호와 리소스 권한 경계 — P3

**신규:** `packages/connect-cli/src/server/authorize.mjs`, `test/server-api.test.mjs`.
**수정:** `packages/connect-cli/package.json` exports, `src/server/gate.mjs`, 공식 adapter.

**인터페이스(제안):** `authorizeRequest(request,context)`→`{allowed:false,response}` 또는 `{allowed:true,principal,responseHeaders}`. principal은server-only userId/clientId/scopes/policyVersion. `protectHandler(handler,options)`는최종응답에cache/renewedcookie를적용한다.

- [ ] GET뿐아니라POST/PUT/DELETE 요청에도handler호출전판정. cross-sitecookiePOST는CSRF거부,body는검사전에임의소비하지않는다.
- [ ] client가보낸X-User/역할header는제거/무시. 원본서버가인터넷직접접근가능하면SDK설치완료로판정하지않는다.
- [ ] 덱소유권같은row-level권한은서비스의역할임을명세. member인A가B데이터를수정하는것은SDK로그인만으로허용하지않는다.
- [ ] WebSocket/SSE는명시적으로미지원 또는연결수명/재검증을정의한별도adapter만지원. 일반GET예외로통과시키지않는다.

**실행:** `node --test packages/connect-cli/test/server-api.test.mjs`; 두사용자소유권fixture와cross-sitePOST실제 HTTP검사.
**합격:** developer는공식wrapper를사용,비인가handler호출0,기존정적GET/HEAD계약유지.

## T11. 재현 가능한 성능·비용·장애 시험 — P4

**신규:** `scripts/benchmark-gate.mjs`, `tests/fixtures/gate-benchmark/`, `docs/benchmarks/commercial-gate.md`.
**기존 근거:** `.wrangler/lease-benchmark-before.log`, `lease-benchmark-after.log`는비교기준이지만소스관리되는재현fixture로승격한다. 보호자료원본은fixture에넣지않는다.

- [ ] HTML1/JS4/CSS3/JSON4/이미지300+폰트2+다운로드1 고정seed자료와SHA를생성. 6/30/300동시,1/10isolate,AUTH지연0/100/500ms.
- [ ] 보안용 작은 fixture와 별도로 실제 디코딩 가능한 이미지 크기 분포를 사용한다. 예: 이미지당10/50/200KiB 세 부하, 동일 화면 크기와 lazy-load 조건을 고정하고 각 총 전송량을 보고한다. 자료는 합성 이미지이며 운영 자료를 공개하지 않는다.
- [ ] cold/warm/lease-expired/control-expired/access-expired/revisit/role-expired 각각10회warmup+30회측정. 평균만아니라p50/p95/p99,에러율,실제요청수,bytes,CPU/wall,cache결과측정.
- [ ] 동일호스팅fixture의gate없는비민감baseline과비교. staging3지역실브라우저Chrome/Firefox/Safari,모바일조건의LCP/TTFB/SSO왕복·버튼횟수기록.
- [ ] AUTH/Discord/control503,429,시간초과,키회전,quota,외부캐시오설정에대한fail-closed+회복검증.
- [ ] D02 관측 활성/비활성, 10isolate 중복·유실·큐 포화, D03 presentation cold/cache-hit/failure를 추가 측정한다. 300이미지에 동기 관측 RTT0, 설정 조회0, 기존 warm 추가지연 목표 유지. 수집 실패는 last-observed 지연으로 보고한다.
- [ ] 중앙/사이트/Discord/제어/관측비용을분리,활성이용자100/1,000/10,000의관측값기반추정. 실제 요금 출처/날짜명시. 한도초과공개fallback0.

**실행(신규):** `node scripts/benchmark-gate.mjs --profile local-lease --output .nakwol/reports/bench-local.json`, 같은명령`--profile bounded-control`.
**합격:** 설계안§11 수치목표 충족,실측/미측정분리. 목표미달을TTL상향으로숨기지않는다.

## T12. 배포·업데이트·관측·상용 지원 문서 — P4

**수정:** `packages/connect-cli/src/{managed-updates,gate-reporting,release-check,deployment-rollback}.mjs`, `src/connect-onboarding.ts`, `README.md`, `CONNECT_CLI.md`, `CONNECT.md`, `docs/{LLM_INSTALLATION,CONNECT_SERVER_PROTECTION,MANAGED_GATE_UPDATES,SERVER_GATED_AUTH}.md`, `packages/connect-cli/GATE_SPEC.md`, `.github/workflows/`의관련workflow.
**신규:** `docs/OPERATIONS_RUNBOOK.md`, `docs/SUPPORT_MATRIX.md`, `docs/SECURITY_RESPONSE.md`.

- [ ] D01~D04 owner 권한표·사용자 목록 의미·UI 상태/설치 스키마·설정 전파 기한을 README/CLI/개발자 콘솔 도움말에 연결한다. 외부 개발자 1차 정식 릴리스에서 네 작업을 제외하지 않는다.
- [ ] 관측/브랜드 저장소 보존·삭제·비용, owner 관계 삭제 후 deny 유지, 소유권 회수 시 관리 차단 훈련을 추가한다.
- [ ] protocol capability와runtime지원matrix를발행. 설치완료/빌드완료/배포완료/비로그인검증/실사용검증을별도상태로표시.
- [ ] 신규 서버는legacy+v1동시지원,새 gate를테스트앱→소유사이트1개→나머지소유사이트→타개발자opt-in순배포. 타개발자에호스팅권한을추측해배포하지않는다.
- [ ] canary48시간,첫소유사이트7일관찰을초기계획으로둔다. 신규비노출실패는즉시중단/안전한artifact복구. 5xx·SSO루프·비용회귀도rollback조건에포함.
- [ ] 기존 0.7쿠키는중앙재검증후migration하고기한없이legacy예외허용하지않는다. DB열추가후이전 서버 읽기를테스트한다. runtime downgrade로새key/session을오해하지않도록지원 범위명시.
- [ ] 관리자복구훈련,DBbackup복원,secret회전,토큰노출사고,잘못된정책rollback,이전배포차단을runbook대로실행한다.
- [ ] README/웹connect/llms.txt/npmREADME/CLIhelp/스키마를단일기능 목록에서생성하거나동일성검사한다. 현재처럼각문서수정이따로빠지는것을방지한다.
- [ ] 개인정보 최소화/보존30일진단·180일감사/삭제job/로그마스킹을검증. 이미지마다중앙 로그하지않고저비용집계와장애trace로관측한다.

**최종 실행:** `npm test`, `npm run typecheck`, `npm run test:managed`, T11 benchmark,3호스팅실제검증,두일반계정+운영자브라우저검증.
**합격:** 각출시범위의모든안전/성능/복구gate통과. 관리자가조치를등록할수있다는사실만으로실제반영을완료로보고하지않는다.

## 3. 검증 행렬

| ID | 시나리오 | 성공 조건 | 작업 |
|---|---|---|---|
| S01 | 쿠키없음/위조/중복/만료 | 보호콘텐츠0,handler0 | T01/03/04 |
| S02 | 다른 app/origin/정책/키 | 거부,자동완화0 | T05/06 |
| S03 | GET/HEAD/Range/304/CDNhit | 모두auth선행 | T01/03/04 |
| S04 | code20동시교환 | 성공1/토큰1 | T02 |
| U01 | A성공→B권한거부→A | A세션유지/B자료0 | T02/06 |
| U02 | 같은SSO로B최초접속 | 추가동의없으면로그인 버튼0 | T06 |
| U03 | access1시간/role15분만료 | 정상갱신은사용자개입0 | T06/07 |
| U04 | cookie/storage차단·SDK실패 | 무한 루프0,동작하는재시도 | T03/06 |
| P01 | valid300images | me0/원격store0 | T11 |
| P02 | 300갱신/10isolate | 경합억제·replay구분·실측수보고 | T06/08/11 |
| A01 | 임시허가만료/explicitdeny | deny우선,기한후차단 | T05/09 |
| A02 | 관리자조치/제어분할 | pending표시/stale연장0 | T08/09 |
| A03 | 운영자lockout | 별도복구·자료 공개0 | T09/12 |
| R01 | 새 gate실패/이전 공개 배포 | 안전artifact만rollback | T04/12 |
| R02 | AUTH/Discord/제어장애 | 남은승인범위외차단/복구가능 | T07/08/11 |
| C01 | 최신문서/구SDK혼재 | capability정확,미지원 명시 | T12 |
| M01 | owner A/B·소유권 회수 | 타 앱 조회/조치0, 기존 owner 토큰 거부 | D01 |
| M02 | A차단/세션종료→B접속 | A기한내차단/B세션유지 | D02/T08 |
| M03 | 승인/거부/익명/관측실패 | 방문 의미 정확, PII 열거0, 인증 영향0 | D02 |
| M04 | 관계 삭제 | 타 앱/중앙 사용자 보존, deny 유지 | D02/T12 |
| V01 | hidden/테마오류/악성입력 | 보호 유지, 기본 UI·복구 작동 | D03 |
| V02 | draft/preview/publish/rollback | 초안 비공개, CAS, 버전 관측 정확 | D03 |
| I01 | 설치 중단/재실행/중복/409 | 중복 앱·credential0, 설정 diff·재개 | D04 |
| I02 | 3플랫폼 신규 외부 개발자 | 코드 수작업 없이 UI/정책/실제 보호 완료 | D04/T12 |
| A04 | source별 만료 네 조합 | 사용 증거만 계산, deny 우선 | T05 |
| A05 | owner 2시간/기간 축소·확대 | 범위검사, 적용 기한, 만료 세션 부활0 | T05/D04 |
| U05 | 30초초과 지연/세대역전/logout | 정상 경합 강제로그인0, 회수 후 새 발급0 | T06 |
| P03 | 관측+presentation 활성300자산 | 자산별 중앙쓰기/설정조회0, 비용 실측 | D02/D03/T11 |

## 4. 승인과 실행 경계

이 문서는 사용자가 요청한 개발 계획까지 작성한 것이다. 기능 개발·운영 정책 변경·OAuth credential 저장·새 인프라 활성화·외부 사이트 배포는 실행 단계의 작업이다.

권장 착수 범위는 **T01~T04**다. 지금 발견된 공개 예외를 해결하고, 공식 어댑터와 검사 품질부터 높인다. T05~T09와 D01~D04는 그 위에서 정책·로그인 지속성·외부 개발자 운영 경험을 구현한다. 기본 owner 기능을 팀 RBAC 같은 후속 확장 때문에 지연시키지 않는다. 현세대 게이트를 전면 재작성하거나 모든 사이트에당장재설치를요구하는 방식은 취하지 않는다.

## 5. 계획 자체 검토 결과

- 사용자 조건 연결: 비인가/우회 차단=T01~04/T10,사용성=T02/T06/T07/D03/D04,성능·트래픽=T08/T11/D02,관리조치=T05/T08/T09/D01/D02/T12.
- 이미 구현된 lease/수동grant/관리업데이트/CFrollback은재사용한다.
- 0초회수와0네트워크의충돌,역할신선도와재로그인의충돌,브라우저캐시와사후회수의한계를명시했다.
- 운영 노출은확인사실,OAuth중복 발급은소스상 위험으로분리했다. 신규 endpoint/migration/CLI명령은현재존재한다고쓰지않았다.
- unsupported호스팅,프리뷰/원본미확인,기존쿠키migration,관리자자기잠김,제어 발행 실패를출시gate에포함했다.

## 6. 리뷰 수정 추적과 개정 완료 기준

| 지적 | 설계안 | 계획 반영 | 수용 증거 |
|---|---|---|---|
| R1 owner 권한 | §10 | D01/D02/T09 | M01/M02 |
| R2 사용자 관측 | §10/§11 | D02/T11 | M03/P03 |
| R3 UI 편집 | §10 | D03 | V01/V02 |
| R4 개인정보 격리 | §10/§12 | D01/D02/T12 | M01/M03/M04 |
| R5 갱신 경합 | §8 | T06 | U05/P02 |
| R6 승인 증거별 만료 | §6 | T05/T07 | A04 |
| R7 설치 편의 | §10 | D04/T03/T12 | I01/I02 |
| R8 정책 위임 | §6 | T05/D01/D04 | A05 |

문서 개정은 위 계약·작업·검증 연결을 포함한다. 이 문서의 체크박스는 아직 수행하지 않은 구현 단계다. 이전 리뷰의 ITERATE를 자동으로 승인으로 바꾸지 않으며 신규 기능 구현·실제 플랫폼 수용 결과는 후속 작업에서 기록한다.

## 2026-09-30 실행 체크포인트: T05/D01

정책 모델, 현재 소유권 검사, 관리 API/화면, 동적 lease 협상은 로컬 구현했다. 상세 증거는
[정책 관리 검증](../../audits/2026-09-30-commercial-policy-management.md)을 따른다.
T05의 2시간 세션 실제 지속 수용은 T06 서버 갱신 이후에 검증한다. D01의 향후 사용자·세션
대상 귀속 검사는 D02/T06 데이터 모델이 생길 때 확장하며, 현재는 해당 대상을 거절한다.
원격 migration/배포/사이트 적용은 아직 하지 않았다. 이 기록으로 전체 작업 체크박스를
일괄 완료 처리하지 않는다. 다음 구현 순서는 T06/T07이다.

### T06 구현 체크포인트 (2026-09-30)

T06 서버 세션 갱신과 공식 3개 어댑터 연결을 구현했다. 상세 결과와 검증 범위는
[서버 세션 검증](../../audits/2026-09-30-commercial-server-sessions.md)을 참조한다.
T05의 세션 수명은 credential을 설정한 0.10 런타임에서 실제 강제한다. 기존 방식은 유지한다.
T08의 35초 전파, T07 역할 자동 갱신, 운영 배포는 완료 처리하지 않는다. 다음 구현은 T07이다.
