# 정책 조치 표시 및 설치 복구 UI 수정

상용 리뷰의 P2 관리 화면과 설치 복구 항목을 수정했습니다. 기준은 `feature/commercial-auth-foundation`의 `9d57529e70068b359f28957425037dbd21e54d80`이며, 이 기록은 로컬 수정·검증 근거입니다.

정책 저장은 operationId와 control 응답을 현재 화면 세션에 보존합니다. 서비스별 조치 조회는 기존 owner/client 검사를 유지하고, SQL도 policy_operation_id와 client_id를 함께 제한합니다. 접수 시각, 제어 게시 시각, 수신 관측 시각 및 제어 버전을 분리합니다. 설치 runtime/control-profile은 미확인이며, 수신 한 번을 전체 게이트·사용자 적용으로 표시하지 않습니다. 전역 정책에는 응답의 게시 시도 성공/실패 건수만 표시하고 서비스별 관측은 미확인으로 남깁니다. 화면을 새로 열면 이전 조치를 자동 복원하지 않습니다.

같은 서비스의 새 설치 설정은 현재 주소·호스팅 입력을 보존하고 새 idempotencyKey를 만들며 record를 비워 expectedVersion=0으로 저장합니다. 기존 앱, 설정, 자격증명 및 원문 비공개 계약을 유지합니다. 자격증명 발급·확인에서 ID를 받은 후 명시적 해지 또는 교체를 선택할 수 있습니다. 해지는 기존 owned API로 reason만 전송하며 최근 관리자 인증이 서버에서 필요합니다. 교체 확인 후 기존 자격증명을 해지하고 새 setup/Secret을 발급합니다. 이미 해지된 receipt도 새 setup으로 교체할 수 있으며 기존 원문을 다시 노출하지 않습니다. 재인증 callback은 고정 `/developer/setup` 경로와 검증된 client_id만 사용합니다.

호스팅 Secret 교체·재배포, 정상 사용자 로그인·새로고침·로그아웃·재로그인과 기존 origin/원본 저장소/이전 배포/미리보기 폐쇄 확인은 화면에 안내하며 자동 검증된 것으로 표시하지 않습니다. 기존 앱 관리의 상태 선택은 편집 시 비활성이고 metadata payload에서 status를 제외합니다. 신규 앱의 초기 상태 선택은 유지하며 기존 잠금·해제는 감사되는 운영자 조치를 안내합니다.

검증:

- 새 DOM/실제 UI 함수 회귀: 기준 HEAD의 공개 asset을 동일 driver로 실행했을 때 첫 5개가 모두 실패(RED), 수정 후 7/7 통과(GREEN). 문구 assertion이 아닌 실제 fresh key, zero CAS, reason-only revoke, receipt-bound issue/version, 한 번의 Secret 공개, 실패한 checkpoint 전에 기존 Secret 지우기, callback redirect, metadata status omission을 검사합니다. 전용 `.test.ts` 진입점으로 기존 `test:unit` glob에 포함됩니다.
- 새 실제 D1/API 회귀 2/2: 다른 app/operation의 outbox 행을 섞은 fixture에서도 정확히 현재 receipt만 반환합니다. 오래된 인증의 해지 거부, 갱신된 토큰/인증의 해지 허용, 기존 receipt 비공개와 새 origin/setup credential 발급을 확인했습니다.
- 기존 관리 UI + setup API 선택 검증 13/13 통과. 전체 suite를 실행하지 않았습니다.
- 실제 Chromium 로컬 브라우저 smoke 6/6 통과, pageErrors 0. 실제 page 함수/공유 CSS/현재 asset과 schema parser를 localhost에서 제공하고 SDK/API만 합성 fixture로 대체했습니다. 기존 Secret 비공개, 기본 확인창 취소 시 요청 0, 새 origin + UUID/CAS0, 새 Secret 한 번 공개와 replay 숨김, recent-auth 실패에서 실제 admin callback을 통한 고정 setup 복귀, 정책 receipt 관측 새로고침을 확인했습니다. Playwright의 설치된 Chromium 1243을 사용했습니다. 검증용 별도 Chromium 브라우저와 두 합성 서버는 종료했습니다.
- `tsc --noEmit`, `git diff --check` 통과. Git은 CRLF 정규화 안내만 출력했습니다.

명령과 로컬 evidence:

```powershell
$env:NAKWOL_UI_BASELINE='HEAD' # RED 실행 당시 HEAD=9d57529
node --test tests/worker/management-recovery-ui.test.mjs
Remove-Item Env:NAKWOL_UI_BASELINE
node --import tsx --test tests/worker/management-recovery-ui.test.ts
node --import tsx --test tests/worker/management-recovery-api.test.ts
node --import tsx --test tests/worker/service-management-ui.test.ts tests/worker/developer-setup.test.ts
node node_modules/typescript/bin/tsc --noEmit
git diff --check
```

Ignored evidence는 `.wrangler/commercial/ui-recovery/red.log`, `green-ui.log`, `green-api.log`, `browser-results.json`, `browser-final-dom.txt`, `setup-browser.png`, `policy-browser.png`입니다. 로컬 브라우저 재현기는 같은 폴더의 `browser-fixture.mjs`와 `browser-smoke.mjs`이며 새 localhost 포트를 인수로 사용합니다. API 테스트의 최초 인증 갱신 fixture는 새 인증보다 오래된 token 발급 시각을 유지하여 403이었습니다. 실제 재인증처럼 token 발급 시각도 함께 갱신한 뒤 recovery가 통과했습니다. 서버의 recent-auth 계약은 수정하지 않았습니다.

최초 IAB 확인창 검사는 기본 confirm이 열린 뒤 도구의 CDP focus/input 명령이 응답하지 않아 종료하지 못했습니다. 이전 합성 서버는 종료했고, 별도의 새 Chromium에서 확인창 취소·나머지 흐름을 검증했습니다. IAB 도구의 modal 제어 실패를 제품 UI 결함 또는 테스트 통과 근거로 사용하지 않았습니다.

운영 배포, remote migration, 실제 Discord/OAuth 왕복 및 provider 배포·기존 origin 전체 폐쇄는 실행하지 않았습니다. 이 수정은 T11 성능 또는 상용 출시 전체 수용을 완료하지 않습니다.
