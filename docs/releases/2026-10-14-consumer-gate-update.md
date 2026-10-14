# 기존 서비스 게이트 업데이트 점검 (2026-10-14)

## 운영 확인

범위: 사용자가 지정한 가이드 2주소, 덱 뷰어, 백과, 비교용 사이트 2곳 및 포털 서비스 목록. 전체 AUTH 등록 앱 전수조사는 아니다.

| 사이트 | 이전 게이트 / SDK | 확인 결과 |
|---|---|---|
| nakwol-guide.nakwol.workers.dev | 0.7.1 / 0.3.1 | 0.7.7 / 0.3.4 배포, 실제 SSO 후 홈 표시 |
| nakwol-guide.vercel.app | 0.7.1 / 0.3.1 | 0.7.7 / 0.3.4 배포, 실제 SSO 후 홈 표시 |
| nslg-deck-viewer.pages.dev | 0.7.1 / 0.3.1 | 0.7.7 / 0.3.4 배포, 실제 SSO 후 덱 목록 및 로그아웃 확인 |
| nakwol-auth-bench-cf-20261013.sepsd21.workers.dev | 0.7.5 / 0.3.3 | 0.7.7 / 0.3.4 배포 |
| nakwol-auth-bench-vc-20261013.sepsd21.workers.dev | 0.7.5 / 0.3.3 | 0.7.7 / 0.3.4 배포 |
| nslgkr-web.nslgkr-web.workers.dev | 0.7.2 / 0.3.1 | 타 개발자: 업데이트 필요, 수정하지 않음 |
| battle-log.nslgkr-web.workers.dev | 0.7.2 / 0.3.1 | 타 개발자: 업데이트 필요, 수정하지 않음 |

포털의 다른 외부 링크는 루트 또는 공유 응답에 공통 게이트 버전 헤더가 없었다. 이를 최신/안전으로 판정하지 않는다. 공개 서비스에 신규 인증을 강제로 설치하지 않았다.

## 타 개발자 전달용

중앙 AUTH 업데이트만으로 사이트에 설치한 서버 게이트가 갱신되지는 않습니다. 기존 앱 ID, 콜백, AUTH 주소와 서버 Secret을 유지하고 **Connect 0.7.7로 업데이트 → 빌드 → 재배포**해 주세요. 새 앱을 등록하거나 Discord OAuth를 다시 구현하지 않습니다.

1. 프로젝트에서 .nakwol-connect.json과 package.json을 확인합니다. 공식 managed 설치인지, 일반 생성 게이트인지, 직접 createGate 어댑터인지 구분합니다.
2. managed 설치는 기존 devDependency를 npm install --save-dev --save-exact nakwol-connect@0.7.7 로 갱신합니다. dependencies에 사용하는 수동 어댑터는 그 위치에서 npm install --save-exact nakwol-connect@0.7.7 을 사용합니다. lockfile도 커밋합니다.
3. 공식 생성 게이트는 npx --yes nakwol-connect@0.7.7 protect update 를 실행합니다. 수동 어댑터는 기존 import를 유지하고 갱신된 패키지로 재빌드합니다. 자체 작성 파일에 protect install을 덮어쓰지 않습니다.
4. 기존 사이트의 빌드 명령과 승인된 배포 명령을 실행합니다. 브라우저 SDK가 별도 버전으로 고정되어 있다면 0.3.4로 갱신합니다. 서버 게이트가 있는데 또 자동 로그인 bootstrap을 붙이지 않습니다.
5. 공식 설치는 doctor --json, protect status --json, protect verify --expect-runtime installed --json으로 확인합니다. 수동 어댑터는 protect verify --provider custom --url 운영주소 --paths 실제보호경로목록 --expect-runtime 0.7.7 --json으로 확인합니다. npx 실행 시 nakwol-connect@0.7.7을 명시합니다.
6. 운영 응답 X-Nakwol-Runtime: 0.7.7, 로그인 화면 SDK 0.3.4, 실제 계정 로그인/상세 주소 복귀/로그아웃을 확인합니다. 서버 Secret은 교체하지 않습니다.

LLM에게는 [최신 설치 지시문](../LLM_INSTALLATION.md)을 전달하세요. 신규 설치의 실제 마법사 흐름은 init → 브라우저 개발자 승인 → 터미널 자격 선택입니다. 처음부터 --json만 사용하면 승인 주소를 볼 수 없으므로 문서의 초기 인증 절차를 따릅니다. 자격 ID는 AUTH가 공개한 자격 ID이며 Discord 역할 숫자를 직접 넣는 자리가 아닙니다.

## 검증 및 발견

- 가이드의 이전 all-asset 보호 수정 af698f1이 별도 브랜치에만 남아 있었다. 현재 library API를 보존하여 통합하고 Vercel 정적 자산 공개 예외와 양쪽 version.json 공개 예외를 제거했다. PR: goyoung2/nakwol-portal#30, 배포 source bb411e7.
- 가이드 check/build 및 두 어댑터의 827경로 × 4방식 = 총 6,616 차단 검사 통과. 정상 세션 자산 제공 및 후속 중앙 조회 0회 fixture 확인.
- 운영 공식 protect verify: 가이드 각 16개, 덱 뷰어 실제 345자산 포함 1,384개, 비교 사이트 각 12개 통과. GET/HEAD/Range/잘못된 쿠키 검사.
- 덱 뷰어 배포 bcb4fd5b, source7bfe73f. 기존 Secret 유지. GitHub PR goyoung2/nslg-deck-viewer#1 병합.
- 비교 사이트 source91eb3e1, wrapper 테스트6개 통과(동시300자산 중앙조회0, 다른origin/client 거절, AUTH장애 차단).
- 가이드 배포 명령은 양쪽 배포에 성공한 뒤 deploy:check에서 인증 쿠키 환경변수가 없어 exit1. 배포 실패로 혼동하지 않는다. 브라우저 SSO/콘텐츠와 운영 게이트 검증은 별도로 통과. 인증된 version.json의 두 본문 비교는 미실시.
- 비멤버 실계정 로그인과 특정 회선 현장 검증은 이번 작업에서 수행하지 않았다. 테스트가 다루지 않은 과거 배포/원본 스토리지 전체를 안전하다고 표현하지 않는다.

## 문서 게시

README, LLM_INSTALLATION, CONNECT_SERVER_PROTECTION을 실제 CLI0.7.7/SDK0.3.4/AUTH0.2.7에 맞췄다. GitHub 기본 dev PR270 병합 및 LLM 문서 blob 일치를 확인했다. 이번 작업은 이미 게시된 npm0.7.7을 소비자에게 적용하며 새로운 npm 버전은 발행하지 않는다.
