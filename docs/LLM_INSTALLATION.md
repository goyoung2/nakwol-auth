# LLM으로 NAKWOL Connect 설치·업데이트하기

설치 안내 기준: Connect **0.7.8**, Web SDK **0.3.4**, AUTH **0.2.8**. 사용 전에 [CLI manifest](https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json), `/sdk/manifest.json`, `/api/health`와 npm 게시 상태를 확인하세요. 저장소 소스 버전만으로 운영 적용을 판단하지 않습니다.

## 외부 개발자의 최초 설치 마법사

Node.js 20 이상과 설치할 웹 프로젝트가 필요합니다. AUTH 운영자가 `/admin/developers`에서 개발자 계정을 허용해야 앱을 등록할 수 있습니다. Discord 서버의 관리자 권한과 Connect 개발자 권한은 별개입니다.

설치 진입점은 프로젝트 루트의 `wizard`입니다. 단계별 질문과 설명으로 앱 연결부터 서버 보호·배포·검증까지 안내합니다. 기존 `init` 명령도 계속 지원합니다.

```sh
npx --yes nakwol-connect@0.7.8 wizard
```

1. 마법사에서 호스팅·운영 주소·빌드 폴더·정책을 선택하고 안내를 확인합니다. 앱 연결 적용을 선택하면 CLI가 프로젝트를 감지하고 브라우저에 개발자 연결 승인 화면을 엽니다. 표시된 승인 주소와 코드를 확인하고 본인 계정으로 승인합니다. `--no-open`은 자동 열기만 끕니다.
2. 앱이 등록되면 대화형 터미널에서 공개된 가입 자격을 번호로 선택합니다. 여러 번호는 쉼표로 구분하고 `any` 또는 `all`을 선택합니다. Enter는 기존 조건 유지이며 새 앱은 기본 member 조건입니다.
3. CLI가 Embed와 `.nakwol-connect.json`을 만들고 진단합니다. required 사이트는 서버 보호를 배포하기 전 `ok:false`/exit 1일 수 있습니다. JSON/출력의 실패 항목을 확인하고 등록된 clientId를 보존한 채 다음 단계로 진행합니다.
4. [호스팅별 서버 보호 설치](CONNECT_SERVER_PROTECTION.md)에 따라 빌드 → `protect install` → 재빌드 → 서버 Secret 등록 → 배포를 진행합니다. 실제 로그인과 보호 자산 표시까지 확인하면 설치가 완료됩니다.

**LLM·CI 실행 주의:** TTY가 아니거나 `--json`이면 번호 선택이 생략됩니다. `--json`은 최초 인증의 승인 주소·코드 출력도 숨기므로, 개발자 인증이 없는 최초 init은 일반 출력으로 실행하세요. 비대화형 실행에서 자격을 지정하려면 일반 출력의 `qualifications list`로 목록을 확인한 뒤 `--qualifications 실제AUTH자격ID --qualification-match any`를 사용합니다. 사용자가 브라우저에서 직접 승인하며 토큰을 채팅에 복사하지 않습니다.

**AUTH 주소를 통일하세요.** 기존 설치는 `.nakwol-connect.json`의 `authOrigin`을 보존하고 Embed의 스크립트 주소·`data-auth-origin`, 서버 게이트, SDK, 앱 등록과 CLI 인증에 같은 origin을 사용합니다. 서로 다른 AUTH 도메인은 중앙 SSO 쿠키를 공유하지 않습니다. CLI 우선순위는 `--auth-origin` → `NAKWOL_AUTH_ORIGIN` → 프로젝트 설정 → 기본 주소입니다. 환경변수로 다른 주소가 선택되지 않았는지 확인하세요. 주소 이전이 필요한 보호 사이트는 아래 지시문의 절차로 SDK와 게이트를 함께 변경합니다.

**웹 설치 스튜디오:** https://nakwol-auth.sepsd21.workers.dev/developer/install 에서 호스팅별 안내·명령·LLM 지시문을 준비할 수 있습니다. Vercel 백업 서버의 웹 마법사를 열어도 신규 설치는 Cloudflare AUTH를 안내합니다. 신규 기본 인증 주소는 `https://nakwol-auth.sepsd21.workers.dev`이며 Vercel은 운영자 관리 백업입니다. 자동 장애 전환은 아직 제공하지 않습니다. 사이트 자체의 호스팅은 Vercel·Netlify 등이어도 됩니다.

LLM은 `wizard --plan --url 실제주소 --provider 호스팅 --assets 빌드폴더 --project-name 호스팅프로젝트 --json`으로 읽기 전용 계획을 받을 수 있습니다. `--json`·`--offline`·`--plan`은 `--apply`와 같이 전달해도 등록·설치를 실행하지 않습니다. 실제 적용은 일반 출력의 `wizard --apply` 또는 계획에 표시한 기존 명령으로 진행하세요.

## 아래 지시문을 코딩 에이전트에게 복사하세요

사이트 소스를 연 상태에서 전달합니다. 알고 있다면 마지막에 운영 URL과 호스팅을 적으세요.

```text
이 프로젝트에 공식 NAKWOL Connect를 설치하거나 기존 연동을 업데이트해 줘.
먼저 다음 공식 문서를 읽고 실제 설치 상태와 비교해:
https://github.com/goyoung2/nakwol-auth/blob/dev/docs/LLM_INSTALLATION.md
https://github.com/goyoung2/nakwol-auth/blob/dev/docs/CONNECT_SERVER_PROTECTION.md
https://github.com/goyoung2/nakwol-auth/blob/dev/packages/connect-cli/GATE_SPEC.md

1. 조사
- 저장소 지침, Git 변경 상태, package.json/lockfile, .nakwol-connect.json,
  기존 Worker/middleware, 빌드·배포 명령, 운영 URL과 이전 배포 URL을 확인해.
- 기존 clientId·콜백·정책·Secret을 보존해. 기존 앱을 새로 만들거나
  init을 반복해서 다른 인증 구현을 덧붙이지 마.
- 공식 npm 패키지 nakwol-connect와 nakwol-connect/server를 사용해.
  Discord OAuth/PKCE나 서버 인증·쿠키 암호화를 직접 구현하지 마.

2. 보안과 로그인
- 기본은 auth=required + access_policy=member. member의 기본은 시즌3와 기존 추가 역할이야. 사용자 지정 자격을 선택하면 그 조건으로 대체해.
  역할 ID를 사이트에 하드코딩하지 마. guest는 Discord 로그인 사용자이며
  비로그인 공개를 뜻하지 않아. admin은 AUTH 운영자 정책이야.
- 최신 공개 CLI가 자격 명령을 지원하는지 확인하고 qualifications list로 운영자가 공개한
  자격을 조회해. 설치 시 init --qualifications ID,ID --qualification-match any/all을 사용해.
  ID는 AUTH 자격 ID이며 Discord 역할 ID가 아니야. 임의 자격을 만들어 넣지 마.
  옵션 생략은 기존 조건 유지야. 설치 후 qualifications status/set/reset과 AUTH의
  /developer/apps?client_id=앱ID에서 본인 서비스 조건을 수정할 수 있다고 안내해.
  자격 설정 실패를 무시하고 설치 완료라고 하지 마. 등록된 앱 ID로 재시도해.
- Embed는 로그인 UI일 뿐이야. 보호 HTML/JS/CSS/JSON/이미지/폰트/다운로드/API는
  서버에서 승인한 뒤에만 제공해. 직접 URL, GET/HEAD/Range도 보호해.
- 이미 낙월에 로그인했다면 중앙 SSO를 재사용하되 B사이트의 권한은 별도로 확인해.
  확인 중에 로그인 실패/로그인 필요 문구를 번갈아 표시하지 마.
- 로그인 후 원래 경로·쿼리·해시로 돌아오고, 거절되면 재로그인/계정 복구가 가능해야 해.
- Secret은 서버 환경에만 등록하고 소스·브라우저·채팅·로그에 노출하지 마.
  기존 세션 Secret을 업데이트 때 임의로 교체하지 마. Discord 봇 토큰은 필요 없어.

3. 호스팅에 맞게 연결
- Cloudflare Workers Static Assets/Pages 정적 빌드는 공식 protect install을 사용해.
  기존 Worker·SSR·API 로직과 충돌하면 덮어쓰지 말고 공통 게이트 어댑터로 연결해.
- Vercel/Netlify/기타 서버는 createGate를 가져와 모든 보호 경로에 연결해.
  --provider vercel 자동 설치 기능이 있다고 가정하지 마.
- GitHub Pages에서는 서버 게이트를 실행할 수 없어. 보호 콘텐츠의 서버 호스팅 이전이
  필요하다고 설명하고, Embed만 붙여 보호 완료라고 하지 마.
- authOrigin은 https://nakwol-auth.sepsd21.workers.dev 처럼 끝에 / 없이 지정해.
  기존 프로젝트가 다른 AUTH origin을 사용하면 임의로 기본 주소로 바꾸지 마.
  Embed·SDK·서버 게이트·CLI 설정을 동일한 AUTH origin으로 유지해.
  이전을 요청받으면 protect install --auth-origin 새주소와 기존 provider/assets/url로
  Embed와 게이트를 함께 갱신하고, 콜백·개발자 승인·빌드·배포·로그인을 확인해.
  사이트 callback은 실제 등록된 루트 URL을 사용해. 복수 배포 origin은 각각 등록하고
  해당 사이트용 게이트 설정을 사용해. 하나의 origin 바인딩을 임의로 넓히지 마.

4. 업데이트와 성능
- 현재 설치·npm 게시·운영 게이트 버전을 구분해. 0.6.x에서 0.7.x는 명시적으로 전환해.
- 공식 0.7.8 게이트의 유효한 최대 1시간 authorization lease 동안은 로컬 암호 검증만 해.
  이미지마다 /me나 D1/KV/R2를 호출하는 자체 구현을 추가하지 마.
- 중앙 권한 회수는 최대 1시간 추가 지연, Discord 역할 정보는 최대 24시간에
  lease가 추가될 수 있음을 보고해. AUTH 장애 시 만료된 승인을 연장하지 마.
- AUTH만 배포해도 소비자 게이트가 갱신된다고 하지 마. 패키지 갱신 → 빌드 →
  사이트 배포 → 운영 버전·접근 검증까지 구분해.
- 자동 업데이트를 요청한 경우 MANAGED_GATE_UPDATES.md에 따라 protect automate를 검토해.
  exact dependency와 lockfile을 커밋하고 기존 CI를 보존해. 자동 병합·배포·롤백이
  저절로 켜지는 기능으로 설명하지 마. 사용자가 금지한 자동 배포를 추가하지 마.

5. 완료 검증
- init/sync가 보호 미완료로 exit 1을 반환하면 JSON의 실제 실패 항목을 읽어.
  앱 등록/파일 생성은 남아 있을 수 있어. 모든 실패를 무시하거나 init을 반복하지 마.
- 공식 설치는 doctor --json, protect status --json,
  protect verify --expect-runtime installed --json을 실행해.
- 수동 어댑터는 protect verify --provider custom --url 실제주소
  --paths 실제보호경로목록 --expect-runtime 실제설치버전 --json으로 검사해.
  custom 검사는 열거한 경로만 확인해. doctor의 설치 메타데이터 경고를 숨기지 마.
- 이전 배포·별도 도메인·원본 스토리지 우회도 확인해. 삭제는 별도 승인 범위로 다뤄.
- 실제 브라우저에서 로그인 SDK 로딩 → 정상 계정 SSO → 원래 상세 주소 복귀 →
  본문/이미지/데이터 표시 → 로그아웃 후 차단을 확인해.
  비멤버 계정을 구할 수 없으면 그 검증은 미실시로 보고해.
- 401 차단만 확인하고 로그인도 정상이라고 보고하지 마. 404/503/리다이렉트를
  비로그인 보호 검사 성공으로 처리하지 마.
- 변경 파일, 버전, branch/commit/dirty, 수행한 검사, 배포 여부와 미검증 항목을 보고해.
  배포 권한이 이미 주어졌다면 운영 적용까지 진행해.

DATA가 필요한 경우만 data describe --json으로 현재 API를 확인하고 최소 scope를 요청해.
내 서비스의 운영 URL: [기입 또는 프로젝트 설정에서 확인]
호스팅: [기입 또는 프로젝트 설정에서 확인]
작업: [신규 설치 / 기존 업데이트]
```

## 사람이 확인할 설치 순서

| 상황 | 필요한 작업 | 완료 기준 |
|---|---|---|
| 새 Workers/Pages 정적 사이트 | init → 빌드 → protect install → 재빌드 → Secret 등록 → 배포 | doctor·차단·실제 로그인 통과 |
| 기존 공식 게이트 | protect update → 빌드 → 배포 | 설치/운영 버전 일치와 회귀 검증 |
| 기존 자체 게이트 | 공식 createGate 연결 및 호스팅 어댑터 검사 | 모든 보호 경로 차단과 실제 로그인 |
| GitHub Pages | 서버 실행 가능한 호스팅으로 보호 콘텐츠 이전 | 이전 공개 주소까지 별도 처리 |

`dist`, 프로젝트 이름, 운영 브랜치는 예시를 그대로 사용하지 말고 실제 값을 확인하세요.
호스팅별 명령은 [서버 보호 설치](CONNECT_SERVER_PROTECTION.md), 장기 운영은 [관리형 업데이트](MANAGED_GATE_UPDATES.md)를 따릅니다.

## 공통 게이트 업데이트 예시

이미 공식 설치 메타데이터가 있는 일반 업데이트 모드에서 실행합니다. `protection.updateChannel=managed`인 사이트는 아래 관리형 절차로 의존성을 먼저 갱신하세요. 자체 어댑터에 이 명령을 강제로 적용하지 않습니다.

```sh
npx --yes nakwol-connect@0.7.8 protect update
npm run build
# 기존 사이트의 승인된 배포 절차 실행
npx --yes nakwol-connect@0.7.8 protect status --json
npx --yes nakwol-connect@0.7.8 protect verify --expect-runtime installed --json
npx --yes nakwol-connect@0.7.8 doctor --json
```

관리형 모드는 [protect automate 설정](MANAGED_GATE_UPDATES.md)을 사용합니다. 이미 managed인 사이트는 먼저 exact dependency와 lockfile을 함께 업데이트합니다. npm의 루트 프로젝트에서는 `npm install --save-dev --save-exact nakwol-connect@0.7.8` 후 `npm run nakwol:gate`와 빌드를 실행합니다. `npx`로만 새 버전을 실행하면 package.json의 고정 버전과 불일치하여 갱신이 거절됩니다. CI는 `npm ci`로 재현하고 사이트 배포 후 위 검사를 실행합니다. 생성된 PR 검사는 배포를 대신하지 않습니다. 관리자 보고와 자동 롤백도 각각 별도 연결이 필요합니다.

## 접속이 막힐 때

| 현상 | 먼저 확인할 것 |
|---|---|
| 로그인 실패 문구, 버튼 무반응 | SDK 요청 200 및 JavaScript Content-Type, AUTH 주소의 중복 `//sdk/` |
| 로그인 후 다시 처음 화면 | 콜백 주소·쿠키·Secret·세션 교환 응답·원래 주소 복원 |
| 403 | 저장된 자격 또는 기본 member/추가 역할/운영자 차단·수동 허용 상태 |
| 503 | 서버 Secret과 만료 lease의 AUTH 재검증 실패 |
| 새 버전인데 그대로 | 로컬 패키지·lockfile·빌드 출력·실제 배포의 버전 차이 |

계정 복구는 공식 로그인 화면의 **계정 확인·접속 문제 해결**을 사용합니다. 역할 새로 확인은 관리자 차단이나 비활성 앱을 해제하지 않습니다.
