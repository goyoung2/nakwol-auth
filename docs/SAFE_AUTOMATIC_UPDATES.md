# 안전한 SDK 자동 업데이트

## 상태와 적용 범위

**Connect 0.14.0 로컬 후보 기능입니다. npm 게시·운영 배포를 의미하지 않습니다.**
이미 설치한 사이트에 자동으로 켜지지 않습니다. 기본 `protect automate`는 기존처럼
패치 PR과 검사만 생성합니다. 자동 모드는 사이트 소유자가 배포 연결을 검토한 뒤
명시적으로 선택합니다. 서버 게이트의 요청 처리, 권한 lease, 로그인·캐시 정책은 바꾸지 않습니다.

자동화는 두 단계입니다.

1. `protect update-pr`: 엄격하게 제한한 SDK 패치 PR을 **검증한 HEAD에 한해서 원자적으로 병합**.
2. `protect rollout`: 기존 사이트 CI에 연결하여 이전 정상본 확인 → 배포 → 검사 → 실패 시 복구.

병합 성공은 운영 적용 성공이 아닙니다. 배포 job 연결도 별도로 필요합니다.
`configured-not-deployed`, `patch-merged`, `release-verified`, `recovery-verified`를 구분합니다.
복구 성공이어도 새 릴리스와 CI는 실패입니다.

## 여러 호스팅을 지원하는 방법

업데이트 코어는 호스팅 API를 직접 호출하지 않습니다. 소유자가 검토한 Node `.mjs`
어댑터를 JSON subprocess로 호출합니다. provider 이름으로 기능을 추정하지 않습니다.
이 계약은 Cloudflare Workers/Pages, Vercel, Netlify, 자체 서버 CI에 연결할 수 있습니다.
**각 호스팅용 배포 어댑터가 자동으로 생성되거나 운영 검증된 것은 아닙니다.**
정적 게이트 생성기의 지원 범위와 배포 어댑터의 지원 범위도 서로 다릅니다.

| 환경 | 연결할 기존 배포 절차 | 최초 연결에서 확인할 것 |
| --- | --- | --- |
| Cloudflare Workers | 프로젝트의 Worker 배포·이전 버전 복구 | 계정·Worker 식별, 실제 serving deployment ID, workers.dev/custom domain, 복구 후 새 deployment ID |
| Cloudflare Pages | 프로젝트의 Pages 배포·정상 production 복구 | production 대상과 preview 구분, 이전 deployment URL과 별칭의 보호 |
| Vercel | 프로젝트의 배포·promotion·rollback | project/team 식별, production 별칭과 deployment URL, preview 우회 차단 |
| Netlify/자체 서버/기타 | 소유자가 운영하는 배포와 이전 artifact 복구 | immutable artifact 식별, 모든 origin, 외부 직렬화, 비교 후 변경, 복구 가능 여부 |
| 공개 정적 파일만 제공하는 호스팅 | 서버 게이트를 실행할 호스팅으로 이동하거나 원본 보호 프록시 설치 | SDK 업데이트만으로 공개 원본을 보호할 수 없음 |

현재 코어는 **배포 전후 동일한 HTTPS origin 집합**을 요구합니다. 매번 새 preview
주소가 생기거나 origin 목록을 완전히 확인할 수 없는 연결은 자동 모드로 전환하지 않습니다.
이전 공개 배포·스토리지·별칭을 숨기기만 한 목록은 완전한 목록이 아닙니다.
새 주소 추가/기존 주소 폐쇄의 자동 증명 및 네이티브 provider 연결은 별도 구현 범위입니다.

## 어댑터 계약 v1

stdin으로 JSON 한 개를 받고 stdout으로 JSON 한 개를 반환합니다. shell 문자열이나
stderr를 실행하거나 보고서에 복사하지 않습니다. Node 22를 사용합니다. 어댑터는
신뢰한 소유자 코드이며 sandbox가 아닙니다. import한 코드와 도구도 CI에서 고정·검토해야 합니다.
SDK가 고정하는 SHA-256은 진입 `.mjs` 파일의 hash입니다.

모든 요청의 공통 필드:

```json
{"schemaVersion":1,"action":"current","provider":"custom-host","resourceId":"my-site"}
```

모든 응답의 공통 필드:

```json
{
  "schemaVersion": 1,
  "provider": "custom-host",
  "resourceId": "my-site",
  "origins": ["https://my-site.example/"],
  "inventoryComplete": true
}
```

| action | 추가 요청 | 추가 응답/필수 동작 |
| --- | --- | --- |
| `capabilities` | 없음 | `serializedDeployments`, `compareBeforeWrite`, `rollback` 모두 true. 실제 구현 가능한 경우만 선언 |
| `current` | 없음 | 실제 serving `deploymentId`, 이 도구가 변경했으면 `operationId`도 조회 |
| `deploy` | `operationId`, `expectedDeploymentId`, `buildHash`, `runtimeVersion` | 현재 배포를 비교한 뒤 정확한 빌드 배포. 확정된 serving ID와 같은 operation receipt 반환 |
| `rollback` | 위 필드와 `targetDeploymentId` | 현재 배포가 이 작업의 배포일 때만 검증된 이전 artifact 복구. 복구 후 serving ID와 operation receipt 반환 |

`deploymentId`/`resourceId`/provider는 1~200자의 영문·숫자·`_ . -` 식별자입니다.
operation ID는 SDK가 생성합니다. 시작 시점의 ID와 복구 시점의 ID가 같다고 가정하지 않습니다.

어댑터 구현 조건:

- 사이트의 **모든** 변경 경로를 같은 배포 lock 아래 직렬화합니다. 수동 대시보드 변경,
  push 자동 배포, 다른 CI까지 포함합니다. 한 Actions job의 `concurrency`만으로 충분하지 않을 수 있습니다.
- 변경 직전 `expectedDeploymentId`를 비교합니다. 비교·변경 사이 경합도 호스팅 lock/CAS로 막습니다.
- operation ID로 변경 결과를 추적합니다. timeout 뒤에도 `current`가 확정 결과를 보고할 수 있어야 합니다.
- 배포/복구 재시도는 idempotent하게 처리합니다. 임의의 최신 배포를 성공 결과로 반환하지 않습니다.
- 이전 정상 artifact를 보존하고 새 빌드와 혼동하지 않습니다. DB migration/Secret/권한 정책을 같이 바꾸지 않습니다.
- stdout에는 공개 식별자만 반환합니다. credentials를 반환하지 않습니다. 256 KiB 응답 제한, 호출당 120초 timeout이 있습니다.
- timeout 시 SDK는 child 종료를 시도합니다. 외부 배포나 자식이 만든 별도 프로세스까지 취소되었다고 가정하면 안 됩니다.
  확정 receipt 없이 다른 배포를 되돌리지 않으며 `deployment-indeterminate`로 중단할 수 있습니다.

## 최초 연결

지원된 게이트가 정상인 사이트에서 기존 clientId·Secret·member 정책을 보존합니다.
후보 패키지를 직접 설치해 시험하거나 정식 게시 후 검증된 exact 버전을 선택합니다.
아래 명령은 이미 설치한 로컬 CLI를 사용하며 `@latest`를 호출하지 않습니다.

1. 이전 정상 배포의 정확한 소스/lock/build에서 `protect manifest`를 만듭니다.
2. 정상 member의 **그 사이트용 일반 세션 쿠키**로 `protect verify`를 실행합니다.
   관리자 권한이나 게이트를 우회하는 특수 인증을 만들지 않습니다.
3. `releaseAccepted:true`와 현재 serving deployment ID를 확인합니다.
   정상본 manifest/report를 신뢰한 CI의 비공개 저장소/artifact에 보관합니다.
4. 어댑터 소스, 연관 도구, origin inventory, 배포 lock과 복구를 직접 검토·시험합니다.
5. `.nakwol-connect.json`의 `protection.automatic`을 추가합니다.

```json
{
  "enabled": true,
  "provider": "custom-host",
  "resourceId": "my-site",
  "serializedDeployments": true,
  "adapterFile": "ops/nakwol-deploy.mjs",
  "adapterSha256": "검토한 파일의 SHA-256 64자",
  "credentialEnv": ["SITE_HOSTING_TOKEN"],
  "sessionCookieEnv": "NAKWOL_VERIFY_COOKIE",
  "previousManifest": ".nakwol/baseline/manifest.json",
  "previousReport": ".nakwol/baseline/verified.json"
}
```

경로는 저장소 내부의 실제 일반 파일이며 symlink를 허용하지 않습니다. 쿠키와 호스팅
credentials는 CI secret/environment에만 둡니다. 중앙 AUTH에 호스팅 토큰을 보내지 않습니다.
어댑터에는 명시한 호스팅 환경 변수와 실행에 필요한 OS 환경만 전달합니다. GitHub token,
검사 쿠키, `SESSION_SECRET`, Discord Secret, Node 주입 변수는 호스팅 child로 넘기지 않습니다.
대소문자 별칭과 중복 이름도 거부합니다. 다른 이름에 중앙 Secret을 넣지 않도록 소유자가 검토해야 합니다.
보고서/manifest에 보호 경로나 canary가 있을 수 있으므로 공개 artifact·공개 저장소에 올리지 않습니다.

정상본 증거를 PR이 만든 artifact에서 가져오면 안 됩니다. CI는 검증된 배포의 비공개
baseline만 복원합니다. 정상본 ID가 달라졌거나 증거가 약하면 배포 전에 중단합니다.

## 패치 PR 자동 병합 선택

새 자동화 설정에서는 다음 명령으로 추가 workflow를 생성합니다.

```sh
npm exec -- nakwol-connect protect automate --auto-merge --environment production
npm install --package-lock-only --ignore-scripts
```

기존 Dependabot/workflow가 있으면 덮어쓰지 않고 중단합니다. 설정 담당자가 기존 CI와
문서의 계약을 수동으로 합치고 `protection.automation.autoMerge:true`를 명시해야 합니다.
이 명령은 배포 job과 호스팅 계정을 연결하지 않습니다.

GitHub 조건:

- 같은 저장소의 `dependabot[bot]`가 만든 default branch 대상 PR만 허용합니다.
- package.json/package-lock.json 두 파일만 바뀌고, exact stable SDK 버전의 같은 major/minor
  patch 증가만 허용합니다. lockfile v3, npm tarball URL·SHA512 integrity를 실제 registry와 비교합니다.
- 스크립트·정책·다른 패키지·transitive dependency 변경, minor/major는 수동 검토입니다.
- `NAKWOL gate update check` workflow의 실제 성공 run/HEAD/check suite/GitHub Actions app/job을 확인합니다.
- classic branch protection에서 strict required `check`와 해당 app, enforce admins를 요구합니다.
  review bypass allowances가 있거나 rulesets만 있어 이 API 증명을 얻지 못하면 중단합니다.
- SQUASH 병합이 가능해야 합니다. 다른 필수 검사·리뷰를 우회하거나 자동 승인하지 않습니다.

`NAKWOL_UPDATE_GITHUB_TOKEN` repository secret을 별도로 연결합니다. 해당 저장소에만
Administration **read**, Actions **read**, Checks **read**, Contents **write**, Pull requests **write**가
필요합니다. 기본 `GITHUB_TOKEN`은 branch protection 조회의 Administration 권한을 제공하지 않습니다.
GitHub App installation token을 연결하거나 만료·갱신을 관리하는 fine-grained token을 사용합니다.
생성 workflow는 이 secret을 소비합니다. App token 생성/갱신은 소유자의 CI 연결 단계입니다.
호스팅 credentials는 이 병합 job에 넣지 않습니다.

권한 있는 `workflow_run` job은 신뢰한 `github.sha`만 checkout하고 `npm ci --ignore-scripts`를
실행합니다. PR 코드·캐시·artifact를 가져와 실행하지 않습니다. actions는 full SHA로 고정합니다.
GitHub API의 `mergePullRequest(expectedHeadOid)`로 검증한 HEAD만 한 번 병합합니다.
이후 다른 커밋도 자동 승인되는 PR-wide auto-merge를 켜지 않습니다.

다른 필수 검사/리뷰가 아직 끝나지 않았다면 병합이 거부됩니다. 조건이 충족되면 해당
workflow를 다시 실행합니다. 현재 별도의 주기적 재시도나 리뷰 자동 승인은 없습니다.
병합 뒤 기존 배포 Actions를 트리거하려면 소유자가 연결한 App/token과 배포 trigger도 확인합니다.
기본 GITHUB_TOKEN의 push는 새 Actions 실행을 만들지 않는 경우가 있으므로 이 경로를 가정하지 않습니다.

## 배포 CI 연결

신뢰한 default branch의 배포 job에서 다음 순서를 기존 호스팅 절차에 연결합니다.
외부 전체 직렬화 및 baseline 보관을 먼저 준비하며 `cancel-in-progress:false`로 진행 중인 복구를 끊지 않습니다.

```sh
npm ci
npm run build
npm run nakwol:gate
# 비공개 정상본 manifest/report를 정해 둔 경로에 복원
npm exec -- nakwol-connect protect manifest --deployment-id build-only --output-file .nakwol/candidate.json
npm exec -- nakwol-connect protect rollout --candidate-manifest .nakwol/candidate.json --output-file .nakwol/reports/release.json --json
```

`protect rollout`이 어댑터의 deploy를 호출하므로 **별도 자동 배포를 동시에 실행하지 않습니다.**
검사 쿠키가 만료되면 실패로 멈춥니다. 장기 관리자 쿠키를 영구 보관하지 말고 일반 서비스
세션의 수명 안에서 probe 세션을 갱신합니다.

검사 내용: 전체 manifest 파일의 익명 GET/HEAD/Range/잘못된 쿠키/캐시·조건부 요청 차단,
runtime 일치, primary origin의 정상 세션 GET 원본 크기·SHA256 일치입니다.
인증 쿠키는 다른 origin에 전달하지 않습니다. 원격 검사 원본은 파일당 최대 1 MiB이므로
그보다 큰 candidate 파일은 배포 전에 거부하고 수동 릴리스 검토를 요구합니다.

성공하면 보고서의 `verification`과 `manifestFile`이 가리키는 bound manifest를 다음
baseline으로 함께 보존합니다. rollout 보고서 전체를 `previousReport`로 사용하지 않습니다.
복구 성공이면 `recoveryVerification`과 `.recovery-manifest.json`을 실제 이전 소스/lock과
함께 보존합니다. 복구가 새 deployment ID를 만든 경우 새 ID를 baseline으로 사용합니다.
baseline 승격은 사이트의 신뢰한 CI 저장소가 담당하며 SDK가 기존 증거를 덮어쓰지 않습니다.

## 실패와 운영 판단

| 결과 | 의미/조치 |
| --- | --- |
| `baseline-rejected` / `journal-failed`(배포 전) | 정상본·probe·기록을 확인. 호스팅 변경 없음 |
| `release-verified` | 익명 차단과 정상 파일 전달 모두 검증. 비공개 baseline 승격 |
| `recovery-verified` | 새 릴리스 실패, 이전 정상 artifact 회복 및 재검증. CI exit 1 유지 |
| `deployment-conflict` / `recovery-conflict` | 다른 변경을 발견. 다른 배포를 덮어쓰지 않고 운영자 조치 |
| `deployment-indeterminate` / `recovery-indeterminate` / `recovery-failed` | 확정 receipt/복구 검증 부족. 성공 표시 금지, 운영자 확인 |

배포 후 journal 쓰기가 실패해도 확인 가능한 이 작업의 배포는 복구를 시도합니다.
`journalPersisted:false`는 기록 보관 장애입니다. 반환 결과/CI stderr·exit를 함께 관찰해야 합니다.
CI 전체 프로세스 강제 종료·호스팅 장기 장애까지 이 로컬 프로세스가 자동 회복했다고
간주하면 안 됩니다. 외부 운영 알림과 호스팅 복구 경로를 유지합니다.

기존 Cloudflare `protect release-check`/rollback 계약은 유지합니다. 이 새 상태 머신은
`protect rollout`에만 적용됩니다. 기존 관리 화면의 보고·알림 연결은 별도로 설정합니다.
실제 Discord 로그인/SSO/권한 회수 UX, 네이티브 호스팅 자격 권한 및 이전 공개 주소 폐쇄는
각 사이트의 최초 연결·canary에서 검증해야 합니다.

## 공식 API 근거

- [GitHub 보안: workflow_run과 untrusted code](https://docs.github.com/en/actions/reference/security/secure-use)
- [branch protection 조회와 Administration read](https://docs.github.com/en/rest/branches/branch-protection#get-branch-protection)
- [GraphQL MergePullRequestInput의 expectedHeadOid](https://docs.github.com/en/graphql/reference/pulls)
- [GitHub 토큰에 따른 workflow trigger](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

패키지 시험·독립 리뷰 근거는 [구현 감사](audits/2026-10-01-safe-automatic-updates.md)에 기록합니다.
