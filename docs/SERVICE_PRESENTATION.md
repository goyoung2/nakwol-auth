# 서비스별 인증 화면 설정 (Connect 0.13 후보)

## 목적과 보호 경계

`/developer/presentation`에서 **현재 소유한 앱**의 브랜드 초안을 편집·미리보기·게시·복원합니다. 인증 정책 및 사용자 조치와 별도입니다. widget hidden은 로그인 후 위젯만 숨깁니다. `auth=required`, member, 모든 HTML/JS/CSS/JSON/이미지/폰트/다운로드의 GET/HEAD/Range 검사, 세션 바인딩, 장애 시 차단은 변하지 않습니다. 디스코드 OAuth는 여전히 중앙 AUTH에서 수행합니다.

화면 설정을 게시해도 policyVersion/appEpoch/outbox를 변경하거나 세션을 폐기하지 않습니다. 정상 보호 자산 요청에는 브랜드 설정 조회가 없습니다. **공개 브랜드 데이터**만 최대60초 캐시합니다. 보호 콘텐츠의 private no-cache/no-store 정책은 유지합니다.

## 관리 API

모든 관리 API는 `nakwol-connect-admin` audience의 Bearer 토큰과 현재 owner/operator 권한을 검사합니다. 변경은 중앙 Origin, 실제 최근 OAuth(15분), 사유(3–500자), actor/app별 분당20회 제한을 적용합니다. DB batch 안에서도 현재 소유권·활성 계정·OAuth family를 다시 검사합니다.

기본 경로 `/developer/v1/apps/:clientId/presentation`:

| 메서드/경로 | 입력과 결과 |
|---|---|
| GET `/draft` | draft, current revision, publishedVersion, 최근20개 게시 이력, 자기 앱 브랜드 파일 목록/한도 |
| PUT `/draft` | `{expectedVersion,presentation,reason}`; CAS 저장, 비공개 유지 |
| POST `/preview` | owner 토큰 필요; 저장한 draft 반환; iframe 상태 미리보기는 실제 접근 허가가 아님 |
| POST `/publish` | `{expectedVersion,reason}`; 저장한 draft를 **새 revision**으로 게시 |
| POST `/rollback` | `{expectedVersion,targetVersion,reason}`; 자기 앱의 보관된 게시 버전으로 새 revision 발행 |
| POST `/assets` | `{mime,base64,reason}`; 실제 이미지 decode/re-encode 후 자기 앱 namespace에 저장 |
| GET `/assets/:id` | owner 인증 전용; preview용 재인코딩 파일의 MIME/base64 |
| DELETE `/assets/:id` | `{expectedVersion,reason}`; 초안/보관된 게시 이력이 참조하지 않는 자기 앱 파일만 삭제 |

409는 최신 revision/소유권을 다시 확인하고 수정 내용을 재검토해야 합니다. 게시 결과가 모든 설치 사이트에서 관측됐다는 뜻은 아닙니다. audit는180일, 게시 이력은20개 보존하며 referenced asset 삭제를 거부합니다.

## 공유 스키마와 렌더러

`nakwol-connect/presentation`의 `parsePresentation`/`defaultPresentation`을 중앙·CLI·브라우저가 공유합니다. `.d.mts` 타입 선언을 포함합니다. 공개 모듈은 `/presentation/v1/renderer.mjs`, `/presentation/v1/presentation-schema.mjs`이며 브랜드 데이터는 `GET /public/v1/apps/:clientId/presentation`입니다. published snapshot만 반환하고 ETag/304 및 `public,max-age=60`을 제공합니다. 초안, 사용자, actor, 인증 비밀값, 보호 앱 경로는 없습니다.

schemaVersion1/version/widget/theme/screens/support:

- widget: visible/hidden, button/compact/menu, inline/fixed/sticky, top-left/top-right/bottom-left/bottom-right, margin0–64px(4px 단위), showName.
- theme: light/dark/system, six-digit hex색, radius8/12/16/24px, size sm/md/lg. 글자·보조 글자·버튼 대비4.5 이상. light/dark는 선택한 토큰, system-light는 안전한 밝은 팔레트를 사용합니다.
- screens: login/checking/denied/unavailable의 serviceName/title/copy/logoAssetId/backgroundAssetId/layout(center/left). **실제 상태 제목과 버튼은 runtime 소유**입니다. 브랜드 문구는 추가 안내이며 checking에서는 숨깁니다.
- support: HTTPS URL와 링크 이름; 코드·HTML·CSS·SVG·임의 자산 URL 입력은 거부합니다. 업로드 파일만 앱별 ID로 참조합니다.

텍스트는 DOM textContent로 렌더링하며 로고 실패·스키마 불일치·설정 네트워크 실패는 기본 테마로 돌아갑니다. 설정 읽기는 document/module 단위 single-flight, 최대16KiB/1.5초/60초이며 인증 bootstrap을 기다리게 하지 않습니다. 250ms 미만 확인은 안내를 추가하지 않고 이후 ‘접속 확인 중…’ 하나, 8초에 재시도·계정 복구를 제공합니다. 인증 전 화면은 공개 AUTH 모듈로 렌더하며 보호 앱 bundle은 필요하지 않습니다.

inline/sticky용 `[data-nakwol-widget]` 컨테이너를 설치 사이트가 지정할 수 있습니다. 지정하지 않으면 body 앞에 배치합니다. sticky는 해당 부모 영역 안에서 자리 유지, fixed는 safe area를 고려한 화면 모서리입니다. fixed 위치가 사이트 고유 버튼을 가리지 않는지는 미리보기와 실제 사이트에서 확인하세요. 키보드 focus/44px controls/reduced-motion을 제공합니다.

headless의 서비스 버튼은 `button[data-nakwol-action="login"]`, `button[data-nakwol-action="logout"]`, `a[data-nakwol-action="recovery"]`로 연결합니다. `/connect/v1.js`의 none/headless 모드는 연결 유무를 검사하고 `nakwol-headless-bindings` 결과/경고를 제공합니다. 로그인·로그아웃은 실제 client 동작이고 recovery는 앱에 귀속된 계정 복구 URL입니다. 기본 위젯에 ‘내 낙월 계정’ 메뉴를 강제하지 않습니다.

## 이미지와 비용

파일당 source/output 최대512KiB, 가로/세로2048px, 앱당16개(최대8MiB)를 D1 blob으로 보관합니다. PNG/JPEG/WebP의 실제 MIME·크기를 확인한 뒤 **Cloudflare Images input/output으로 decode/re-encode**하여 정지 WebP로 저장합니다. 파일 헤더 확인만으로 승인하지 않습니다. 원격 URL import는 제공하지 않으므로 SSRF fetch 경로가 없습니다. 미게시 파일은 owner preview로만 접근하고 공개 brand 경로는 현재 게시 snapshot의 파일만 제공합니다. 브랜드 파일은 공개 자료이므로 비밀 데이터 업로드 용도로 사용하지 마세요.

`PRESENTATION_IMAGES` binding이 없으면 upload를409로 거부합니다. 기존 텍스트 설정/게시/기본 테마는 사용 가능합니다. Wrangler config에 binding을 선언하지만 이번 단계에서는 운영 활성화/결제 변경을 수행하지 않습니다. Images `.info()`는 무료이며 input/output은 upload 때만 transformation 비용이 발생합니다. 방문자마다 다시 변환하지 않습니다. D1 저장/공개 브랜드 조회와 upload transformation quota는 T11 비용 수용에 포함합니다. [Cloudflare 공식 binding 및 과금 규칙](https://developers.cloudflare.com/images/optimization/binding/).

## 호환성과 운영 순서

1. additive migration0021을 기존0020 뒤에 적용합니다.
2. 중앙 Worker/공개 renderer/editor를 배포하고 binding/업로드 기능을 검증합니다.
3. 원하는 설치 사이트를 Connect0.13으로 `protect update` → build/deploy → doctor/protect verify/정상 사용자 검증합니다.

0.12 이하 서버 게이트의 파일은 AUTH 배포만으로 바뀌지 않습니다. 최초 renderer 채택 후 이미 지원되는 브랜드 설정은 재설치 없이 다음 화면 로드/최대60초 캐시 뒤 반영합니다. 중앙 hosted Embed는 rolling script이므로 해당 script 소비에는 중앙 배포가 필요합니다. 알 수 없는 스키마는 경고와 기본 테마이며 ‘적용 완료’로 표시하지 않습니다. 0.13은 로컬 후보이며 npm publication과 운영 rollout은 별도입니다.
