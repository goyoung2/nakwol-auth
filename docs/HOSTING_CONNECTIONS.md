# Cloudflare·Vercel 연결 템플릿과 설치 마법사

## 현재 제공 범위

Connect **0.14.0 로컬 후보**입니다. 2026-10-01 npm 조회의 latest는 **0.7.1**이며,
이 기능은 아직 npm과 운영 AUTH에 배포하지 않았습니다. 후보를 사용하려면 검증한
tarball을 프로젝트에 설치하세요. 공개 후에는 exact 버전과 lock을 함께 사용합니다.

| 기능 | 현재 상태 |
| --- | --- |
| 기존 `/developer/setup`에서 hosting JSON 다운로드 | 구현·로컬 브라우저 검증 |
| CLI 입력 마법사 및 plan/connect | 구현·패키지 실행 검증 |
| Workers·Pages·Vercel API의 프로젝트/배포/별칭 조회 | 구현·API fixture 검증, GET 전용 |
| 전체 빌드 자산의 비로그인 차단 및 정상 회원 해시 검사 | 기존 verifier 재사용·HTTP 검증 |
| 기존 reviewed automatic adapter의 initialize/release 연결 | 구현·실제 child 및 HTTP fixture 검증 |
| native 배포·복구 adapter 자동 생성, 호스팅 운영 연결 | **미구현** |
| GitHub 실제 Secrets·CI·OAuth·운영 canary | **미검증** |

**호스팅 검사 템플릿 생성과 자동 배포 완성을 구분합니다.** 기본 생성 workflow는
호스팅을 변경하지 않습니다. automatic은 이미 검토된 `protection.automatic` adapter가
있는 사이트를 연결하며, hosting JSON만으로 새 adapter를 생성하거나 활성화하지 않습니다.

## 설치 순서

1. 기존 설치 마법사에서 서비스·주소·정책·디자인을 저장하고 `nakwol-setup.json`을 받습니다.
2. 공식 게이트를 설치하고 정상 빌드하세요. 아직 설치 전이면 `protect plan/install --setup-file`을 사용합니다.
3. 설치 단계에서 공개 호스팅 식별자와 추가 HTTPS origin을 입력한 뒤 `nakwol-hosting.json`을 받습니다.
   토큰·쿠키·Secret은 JSON이나 브라우저 저장소에 넣지 않습니다.
4. 터미널에서는 `protect hosting wizard`로 같은 JSON을 작성할 수 있습니다. TTY가 없는 CI는 파일을 사용합니다.
5. 아래 명령을 실행한 뒤 변경 내용을 검토합니다. CLI는 기존 연결 CI를 덮어쓰지 않습니다.

```bash
# 공개 후: npm install --save-dev --save-exact nakwol-connect@0.14.0
# 공개 전: npm install --save-dev --ignore-scripts /path/to/verified/nakwol-connect-0.14.0.tgz
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting plan --hosting-file nakwol-hosting.json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting connect --hosting-file nakwol-hosting.json
# connect가 exact package 버전 및 로컬 gate hook을 고정합니다.
# tarball 설치의 file: dependency는 plan/connect 전 후보의 exact 버전으로 검토해 지정하고,
# 미게시 CI 테스트는 tarball resolution을 보존한 lock을 사용합니다. 공개 registry CI는 게시 후 구성합니다.
npm install --package-lock-only --ignore-scripts
```

생성 파일: `.nakwol/hosting.json`, `.nakwol/hosting-connection.md`,
`.github/workflows/nakwol-hosting.yml`. `.nakwol-connect.json`에 연결 정보를 저장하며
게이트 업데이트가 이를 보존합니다. 기존 `.gitignore` 규칙은 보존하고
`.nakwol/reports/`를 마지막에 추가하여 private 검사 기록을 Git에서 제외합니다. 설정은 `configured-not-deployed`입니다.
기존 package scripts와 다른 CI는 보존하며 custom gate hook은 자동 변경하지 않습니다.

Cloudflare account ID/Worker 또는 Pages 이름은 기존 `wrangler.nakwol.json`과 일치해야 합니다.
Vercel project/team ID는 연결된 `.vercel/project.json`과 다르면 거부합니다.
서비스 ID, origin, provider 및 required/member 설정이 다르면 연결하지 않습니다.

## CI Secret과 배포

- 서버 호스팅: `NAKWOL_SESSION_SECRET`, `NAKWOL_SITE_CREDENTIAL`을 기존 절차로 등록합니다.
- GitHub `production` environment: Cloudflare는 `CLOUDFLARE_API_TOKEN`, Vercel은 `VERCEL_TOKEN`을 등록합니다.
  이 기본 workflow는 지정 프로젝트 API를 **읽기만** 합니다. 배포 권한은 요구하지 않습니다.
- 정상 해당 사이트 member 쿠키: `NAKWOL_PROBE_SESSION`. 없으면 비로그인 검사만 수행하고
  `releaseAccepted:false`입니다. 쿠키가 있으면 실제 모든 파일의 해시를 확인하며, 로그인 실패는 exit1입니다.
- `NAKWOL_PROBE_SESSION`은 일반 회원의 만료 가능한 세션입니다. 운영자 우회나 영구 master cookie가 아닙니다.

기존 공식 CLI의 수동 호스팅 배포를 사용합니다. `.nakwol/hosting-connection.md`에 호스팅별
명령을 생성하지만 실행하지 않습니다. workflow_dispatch는 기본 브랜치만 허용하고,
CI concurrency는 같은 프로젝트의 검사 작업을 직렬화합니다. **다른 배포 job까지 자동 잠그지는 않습니다.**

```bash
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting check --json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting verify --json
```

`check`의 inventory는 차단 증거가 아닙니다. `verify`가 현재 deployment ID와 origin 목록을
검사 전후 비교합니다. 정상 쿠키 없이 CI가 초록이라고 로그인 성공/출시 합격으로 해석하면 안 됩니다.
HTTP response는 파일당 1 MiB, origin은 100개까지 검사합니다. 초과하면 자동 완전 검증으로 표시하지 않습니다.

## 기존 자동 연결의 봉인 정상본

이미 owner-reviewed adapter hash/resource/origins/credentials 및 외부 직렬화를 구성한
사이트만 automatic을 선택합니다. 모든 배포 job과 대시보드 변경 경로를 같은 직렬화
계약으로 통제해야 합니다. 플랫폼의 원자적 compare-and-swap을 가정하지 않습니다.

자동 연결의 `sessionCookieEnv`와 `credentialEnv`는 기존 policy의 정확한 이름을 사용합니다.
검사용 `NAKWOL_PROBE_SESSION`만 등록해도 별도 이름의 release probe를 대신하지는 않습니다.
무작위 32바이트 hex `NAKWOL_RELEASE_STATE_KEY`를 CI Secret으로 추가합니다.

```bash
# 현재 실제 배포와 일치하는 소스·빌드에서 최초 정상본 생성 (호스팅 변경 없음)
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting initialize --json
# trusted serialized CI에 봉인 파일을 복원한 뒤 빌드된 후보 배포
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting release --json
```

`.nakwol/reports/hosting/baseline.enc`는 AES-GCM으로 client/origin/provider/resource/account/team에
바인딩합니다. adapter의 `previousManifest`·`previousReport`도 `.nakwol/reports/hosting/` 안에
두어야 release가 추출할 수 있습니다. 봉인 파일만 trusted default-branch CI 저장소로 전달하세요.
원문 manifest/report, 쿠키, Secret을 공개 artifact에 올리지 않습니다. CI cache 전송은 소유자가 연결합니다.

release는 기존 portable rollout을 그대로 사용합니다. 현재 정상본의 실제 member 접근과
비로그인 차단을 재확인한 후에만 deploy하며, 검증 실패 후 정확한 operation만 복구합니다.
복구 결과를 다시 봉인하지만 새 릴리스의 exit1은 유지합니다. 키·state 변조, 잘못된 사이트,
lease lock 및 stale deployment ID는 배포를 막습니다. 원본 manifest bytes를 보존하여 proof hash를 재검증합니다.

runner가 중단되어 lock이나 stale state가 남으면 자동으로 지우거나 history에서 정상본을 추측하지 않습니다.
실제 serving ID를 확인하고, 실행 중인 job이 없음을 확인한 후 자신의 stale lock을 정리하고
현재 정상 소스·normal member 쿠키로 initialize를 다시 수행하세요. 기록 없이 임의 복구하지 않습니다.

## 조회 범위와 우회 주소

Workers는 단일 100% deployment, workers.dev/custom domains를 조회하고 preview URL이 켜져 있으면 거부합니다.
Pages는 production ID, 과거 deployment URLs/aliases/custom domains를 페이지별 조회합니다.
Vercel은 project/team, production ID, deployment URLs, project domains와 aliases를 페이지별 조회합니다.
조회 실패·분할 배포·불완전 pagination은 완전 inventory로 표시하지 않습니다.

Worker zone routes, 외부 R2/S3, 다른 project, proxy origin은 이 API 범위 밖입니다.
JSON `origins`에 추가하고 그 origin 자체에도 서버 게이트를 적용해야 합니다.
SDK는 주소를 적었다는 이유로 보호됐다고 주장하거나 이전 배포를 삭제하지 않습니다.
직접 URL·HTML·JS/CSS·JSON·이미지·폰트·GET/HEAD/Range 보호 조건은 그대로 유지됩니다.

지원 밖 호스팅은 기존 공통 server gate와 [portable adapter 계약](SAFE_AUTOMATIC_UPDATES.md)을 사용합니다.
GitHub Pages에 Embed만 붙이는 방식은 보호 콘텐츠를 서버에서 차단할 수 없습니다.

API 참조: [Cloudflare Workers deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/),
[Cloudflare Pages](https://developers.cloudflare.com/api/resources/pages/),
[Vercel project-scoped aliases](https://github.com/vercel/sdk/blob/main/docs/sdks/aliases/README.md).
