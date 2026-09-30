# D03 서비스별 인증 화면 편집 검증

## 적용 상태와 범위

기준 commit `e4b9ef4150c5db7ca40adabc487dba6eb0b08f33`, branch `feature/commercial-auth-foundation`의 D03입니다. `/developer/presentation`에서 자기 서비스의 초안·상태별 미리보기·게시·이전 버전 복원을 제공합니다. Connect **0.13.0은 로컬 후보**입니다. 운영 migration·배포·npm 발행·외부 소비 사이트 변경은 수행하지 않았습니다. 상용 계획 전체는 진행 중이며 다음 단계는 D04입니다.

관리 권한, 실제 최근 OAuth(15분), Origin, 사유, 속도 제한, expectedVersion CAS를 적용합니다. 저장 batch에서도 현재 권한과 참조 이미지의 존재를 검사합니다. 게시 설정은 별도 revision이며 정책/outbox/로그인 세션을 변경하지 않습니다. rollback은 기존 revision을 되돌리지 않고 새 revision을 발행합니다.

공유 validator·타입·브라우저 렌더러는 canonical `packages/connect-cli/src/shared/`에서 배포합니다. 생성 Worker는 기존 공통 인증 구현을 사용하며 별도 인증 알고리즘을 복제하지 않습니다. `auth=required`, member, 앱/origin 바인딩, GET/HEAD/Range, 장애 시 차단은 유지됩니다. hidden은 정상 사용자 위젯만 숨깁니다.

## 기능과 비용 경계

- widget visible/hidden, inline/fixed/sticky, button/compact/menu, light/dark/system, 위치·여백·이름 표시를 편집합니다.
- login/checking/denied/unavailable의 브랜드 텍스트·로고·배경·정렬 및 HTTPS 지원 링크를 편집합니다. 실제 상태 제목·로그인·재시도·계정 복구는 runtime 소유입니다. cookie-blocked 원인을 브랜드 문구로 지우지 않습니다.
- 공개 bootstrap은 게시된 브랜드만 반환합니다. ETag/304와 최대60초 캐시를 사용하며 초안·사용자·actor·비밀값·보호 경로는 포함하지 않습니다. 설정은 화면 단위로 읽고 정상 보호 자산 hot path에서 조회하지 않습니다.
- 소스/출력512KiB, 가로·세로2048px, 앱당16개를 제한합니다. PNG/JPEG/WebP 실제 MIME와 크기를 검사하고 Cloudflare Images로 decode/re-encode한 정지 WebP만 D1에 저장합니다. 미게시 파일은 owner 전용이며 현재 게시에서 참조한 파일만 공개합니다. 초안/보관된 게시 이력에 쓰는 파일은 삭제하지 않습니다.
- upload 때 Images transformation 비용, D1 저장·공개 브랜드 조회 비용이 생깁니다. 방문자별 재변환은 없습니다. binding이 없으면 upload409이며 텍스트 편집은 가능합니다. 실제 운영 과금·quota 수용은 T11에 남아 있습니다.

세부 API/스키마와 운영 순서는 `docs/SERVICE_PRESENTATION.md`에 있습니다. 기존0.12 이하 설치는0.13 업데이트·재배포가 먼저 필요합니다. 지원 renderer 채택 이후 이미 지원하는 브랜드 설정 게시는 재설치 없이 다음 화면 로드/캐시 만료 뒤 반영됩니다.

## 실제 HTTP 보호·성능 증거

`.wrangler/commercial/d03/http-driver.ts`는 실제 로컬 HTTP → 공식 게이트 → workerd 중앙 AUTH/D1/SQLite DO를 실행했습니다. 운영 SLO가 아닌 로컬 측정입니다.

| 항목 | cold | warm |
|---|---:|---:|
| HTML 응답 시간 | 100.96ms | 14.46ms |
| 이미지300개 완료 | 403.96ms | 415.93ms |
| 중앙 control 호출 | 1 | 0 |
| 중앙 session refresh 호출 | 0 | 0 |

`protect verify`의 HTML·이미지·JSON·JS·CSS·폰트·다운로드 GET/HEAD/Range/잘못된 쿠키 **28/28** 차단입니다. 승인 관측 전송/기록은 각각1입니다. 차단 후 약31.361초에 이미지300개 모두 거부, asset 제공0회이며 해제 후200으로 복구했습니다. 차단/해제 검증의 control/refresh는 각각2회입니다. 정상 자산마다 브랜드 설정을 읽지 않는 것은 실행 경로 및 별도의 anonymous no-fetch 회귀 검사로 확인했습니다. 이 HTTP driver에 브랜드 요청 카운터를 별도로 설치했다고 주장하지 않습니다.

## 실제 브라우저 검증

로컬 owner UI → 실제 workerd/D1 API로 초안1 → 게시2 → 수정3/게시4 → 이전 버전2로 복원5를 완료했습니다. 공개 문서는 복원한 브랜드를 반환했고 이후 이미지 초안6은 공개 버전5를 바꾸지 않았습니다. 이미지 업로드는 실제 Images decode이며 owner preview는 private blob URL/2×2 디코딩으로 확인했습니다. 다른 앱 초안403, 다른 앱 이미지404, XSS 형태 제목은 텍스트 그대로이며 실행 요소0개입니다.

처음 renderer를 별도 노드에 적용한54개 조합 검사는 실제 SDK mount slot 경합을 잡지 못했습니다. 리뷰 수정 후 **실제 connected iframe preview**에서 visible/hidden×3배치×3variant×3mode=54개를 다시 확인했고 JavaScript 오류0입니다. hidden이 최종 적용되며 inline/sticky의 자기 append 예외가 없습니다.

375px login/denied/unavailable에서 overflow0, 버튼44px 이상입니다. checking은 즉시 카드 숨김,300ms에 단일 확인 문구,8초 이후 재시도/복구입니다. headless 버튼은 실제 login/logout 메서드와 복구 URL에 연결됐습니다. 키보드 Tab/Enter, focus outline, reduced-motion, 모바일 fixed bottom-right 메뉴의 viewport 내부 배치와 sticky scroll400px/top16px를 확인했습니다. 시스템 테마 위젯의 밝은→어두운 기본 토큰 잔류도 RED/GREEN으로 수정했습니다. 미리보기 기본 화면의 schema 불일치·설정 네트워크 실패·깨진 이미지 fallback을 확인했습니다.

두 공식 로그인 방식의 실제 cookie-loop 분기는 통제한 SDK/세션 응답과 attempt 기록으로 재현했습니다. 둘 다 `로그인 쿠키를 저장하지 못했습니다 / 이 사이트의 쿠키를 허용한 뒤 다시 시도해 주세요`와 다시 시도·계정 복구를 표시했습니다. 실 Discord OAuth, 브라우저 설정에서 실제 쿠키를 차단한 운영 재현은 이번 검증에 포함하지 않습니다.

증거: `browser-qa.json`, `mobile-login.png`, `browser-server*.log`. 브라우저 미리보기의 connected 사용자와 OAuth cookie-loop 입력은 합성 fixture이며 실제 계정 수용을 뜻하지 않습니다. 실제 기기 safe-area 값·Safari/webview·보조기기·외부 사이트 고유 버튼과의 충돌은 운영 수용에 남습니다.

## 독립 리뷰와 회귀 수정

한 명의 새 Astra 리뷰어가 읽기 전용으로 검토했습니다. Critical0, Important4, Minor1입니다. Important4는 그대로 유지해 한 수정 단계에서 모두 처리했습니다.

1. 기존 공식0.12 hook이 업데이트 거부:0.12/0.11을 알려진 공식 allowlist에 추가. Workers/Pages의 실제 CLI 업데이트 fixture를0.12로 실행합니다. 사용자 수정 hook 거부는 유지합니다.
2. 이미지 소유권 확인 뒤 삭제 경합: draft UPDATE transaction 안에서 모든 파일의 존재를 재검사합니다. precheck 직후 DB 삭제를 주입해 dangling 참조 저장을 거부하는 회귀 검사를 추가했습니다.
3. SDK mount slot의 inline/sticky 자기 append: 동일 노드·조상 관계로의 이동을 피합니다. 단위 검사와 실제 SDK iframe54조합을 확인했습니다.
4. 쿠키 차단 안내 소실: runtime-owned `cookie-blocked` 이유를 공유 renderer로 전달합니다. 두 실제 생성 페이지 분기를 검사했고401 실패도 login 상태로 구분합니다.
5. Minor 업로드 binding 부재 시 버튼 재활성화: 작업 unlock 시 uploadAvailable 조건을 다시 적용했습니다. 서버 거부 경계도 유지합니다.

`review-red.log`는4원인의5개 실패, `review-green.log`는19/19입니다. 추가 system-theme RED1→GREEN6/6입니다. 최초 전체335/338의 Pages import 조립·문서 버전 불일치, 다음337/340의 VM fixture timer 부재도 수정했습니다. 기존 잠금 assertions는 유지하고 browser timer를 fixture에 추가했습니다. unsafe inline JSON escape도 RED/GREEN입니다. 전체 검사와 모듈/브라우저 증거를 구분했습니다.

## 최종 검사와 남은 단계

**모든 수정 후 최종 전체344/344, 실패/취소/skip0, exit0, 약268.963초**입니다. 명령은 `npx tsx --test --test-concurrency=4 tests/worker/*.test.ts packages/connect-cli/test/*.test.mjs`이며 증거는 `.wrangler/commercial/d03/verified-full-final.log`와 `full-final.exit`입니다. 타입 검사, CLI 패키징, Worker dry-run은 exit0입니다. dry-run은 배포가 아닙니다.

Ruling: 기존 npm/Hono/tsx/D1와 typed boundary parser를 유지하고 framework migration은 하지 않았습니다. migration0020은 D02 소유이므로0021을 사용합니다. graph generation은 stale이고 assets는 excluded/new paths는 untracked여서 실제 소스를 읽었습니다. 이 사설 관리 화면에 무관한 SEO/Lighthouse 기준이나 외부 디자인 탐색을 추가하지 않고 실제 상태·모바일·네트워크 검사로 수용했습니다. 잘못될 비용인 실제 지역·기기·운영 SLO/과금 검증은 T11/T12에 명시해 남겼습니다.

운영 순서는 migration0021 → 중앙 Worker/Images binding 및 editor 검증 → 원하는 사이트 Connect0.13 업데이트/build/deploy → doctor/protect verify/정상 사용자 수용입니다. D04 설치 마법사, T10/T11/T12, 운영 OAuth/다중 지역 전파·CDN·부하·canary/rollback은 이번 단계에서 완료하지 않았습니다. 기존 세션 암호화/SSO 알고리즘 전체 재감사도 별도 범위입니다.

## 변경 파일 묶음

| 묶음 | 주요 경로 |
|---|---|
| 공유 스키마/renderer | `packages/connect-cli/src/shared/presentation-schema.mjs`, `.d.mts`, `presentation-renderer.mjs`; 대응 `src/assets/presentation-*.js.txt` |
| API/DB/이미지 | `src/service-presentation.ts`, `src/service-management-auth.ts`, `src/types.ts`, `migrations/0021_service_presentation.sql`, `wrangler.jsonc` |
| owner editor/preview | `src/service-presentation-page.ts`, `src/assets/nakwol-developer-presentation.js.txt`, `nakwol-presentation-preview.js.txt`, `src/service-management-page.ts`, `src/sdk-entry.ts` |
| Connect/게이트 | `src/assets/nakwol-connect-v1.js.txt`, `packages/connect-cli/src/server/{login,session,gate}.mjs`, `packages/connect-cli/src/adapters/cloudflare-pages.mjs`, `packages/connect-cli/src/protection.mjs` |
| 패키지/배포 계약 | `packages/connect-cli/package.json`, `src/connect-cli-distribution.ts`, `scripts/build-connect-cli-package.mjs` |
| 검사 | `tests/worker/service-presentation.test.ts`, `connect-restore-session.test.ts`, `connect-cli-v03-distribution.test.ts`, `tests/helpers/auth-d1.ts`, `tests/fixtures/presentation/*`; 패키지 `test/{presentation,common-gate,control-snapshot}.test.mjs` |
| 문서 | `SERVICE_PRESENTATION.md`, `DESIGN.md`, CLI README/GATE_SPEC, CONNECT_CLI/CONNECT_SERVER_PROTECTION/SERVER_GATED_AUTH, D03 계획 및 이 감사 보고서 |
