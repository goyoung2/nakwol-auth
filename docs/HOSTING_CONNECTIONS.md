# Cloudflare·Vercel 연결 템플릿과 설치 마법사

## 현재 상태

Connect **0.14.0 로컬 개발본**입니다. 2026-10-01 npm `latest`는 **0.7.1**입니다.
이번 기능은 아직 npm 및 운영 AUTH에 배포하지 않았습니다. 공개 전에는 검증한 tarball로 테스트하세요.

| 제공 기능 | 검증 범위 |
| --- | --- |
| 웹 `/developer/setup` 및 CLI 입력 마법사 | 실제 로컬 브라우저 및 패키지 실행 |
| Workers·Pages·Vercel 프로젝트/배포/별칭 조회 | 공식 API 응답 fixture, GET 전용 |
| 기본 수동 배포 + 전체 자산 직접 접근 검사 | HTTP fixture 및 패키지 실행 |
| Workers·Vercel native 업로드·승격·복구 adapter 생성 | API fixture, 고정 CLI 자식 프로세스 fixture |
| 암호화 정상본 및 CI 초기화·릴리스 template | 실제 SDK release/recovery fixture, 생성 파일 검사 |
| 실제 계정 권한·GitHub CI·운영 배포·canary | 미실시 |

자동 모드는 명시적 선택입니다. Cloudflare Pages의 native 쓰기는 제공하지 않으며 수동 검사 또는 검토된 custom adapter를 사용합니다.
다른 호스팅은 [portable adapter 계약](SAFE_AUTOMATIC_UPDATES.md)을 사용할 수 있습니다.

## 설치

1. 기존 마법사에서 서비스·주소·정책·디자인을 저장하고 `nakwol-setup.json`으로 공식 서버 게이트를 설치·빌드합니다.
2. 같은 마법사의 설치 단계에서 공개 호스팅 ID와 추가 HTTPS origin을 입력해 `nakwol-hosting.json`을 받습니다.
   CLI `protect hosting wizard`도 제공합니다. JSON·Git·브라우저 저장소에는 토큰·쿠키·Secret을 넣지 않습니다.
3. 기본 수동 모드는 검사 workflow만 생성합니다. Workers·Vercel 자동 모드는 adapter 경로를 비워 두세요.
   `.nakwol/hosting-adapter.mjs`가 생성됩니다. 다른 경로는 기존 reviewed automatic 연결이 있어야 합니다.
4. 자동 모드에서는 호스팅 Git 자동 배포·다른 CI·대시보드 동시 배포를 끄고 모든 변경을 같은 workflow로 직렬화해야 합니다.
   플랫폼 API의 원자적 compare-and-swap을 가정하지 않습니다. 통제하지 못하면 수동 모드를 사용하세요.

```bash
# npm 공개 후
npm install --save-dev --save-exact nakwol-connect@0.14.0
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting plan --hosting-file nakwol-hosting.json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting connect --hosting-file nakwol-hosting.json
npm install --package-lock-only --ignore-scripts
```

공개 전 tarball 테스트는 설치 후 exact 후보 버전과 tarball resolution을 보존한 lock을 검토하세요.
registry 기반 CI는 npm 게시 후 구성합니다. `connect`는 기존 workflow·custom gate hook·다른 버전의 SDK/provider CLI를 덮어쓰지 않습니다.

생성 파일은 `.nakwol/hosting.json`, `.nakwol/hosting-connection.md`, `.github/workflows/nakwol-hosting.yml`입니다.
자동 native 모드는 adapter도 생성합니다. exact `nakwol-connect`와 provider CLI(Workers `wrangler@4.119.0`, Vercel `vercel@62.1.0`)를 고정합니다.
package/lock/adapter/workflow를 검토·커밋하세요. `.nakwol/reports/`는 Git에서 제외합니다.
설정 상태 `configured-not-deployed`는 운영 적용이 아닙니다. 서비스 ID/origin/provider/required/member 및 계정/project/team 불일치는 거부합니다.

## Secret과 처음 연결

- 서버 호스팅에 기존 `NAKWOL_SESSION_SECRET`, `NAKWOL_SITE_CREDENTIAL`을 등록하세요. CLI는 이 값이나 DB를 변경하지 않습니다.
- GitHub `production` environment에 Workers는 `CLOUDFLARE_API_TOKEN`, Vercel은 `VERCEL_TOKEN`을 등록합니다.
  수동 검사는 조회 권한만, 자동 모드는 해당 계정/프로젝트의 업로드·배포·복구 권한도 필요합니다.
  Workers는 Workers Scripts 편집 및 inventory 조회에 필요한 계정 권한을 지정합니다. 다른 계정을 함께 허용할 필요는 없습니다.
- `NAKWOL_PROBE_SESSION`: 해당 사이트에 정상 로그인한 일반 member의 만료 가능한 쿠키입니다. 영구 master cookie나 관리자 우회가 아닙니다.
  자동 운영에는 필수이며 만료되면 로그인으로 갱신하세요. 수동 검사는 없을 경우 익명 검사만 수행하고 `releaseAccepted:false`입니다.
- 자동 운영의 `NAKWOL_RELEASE_STATE_KEY`: 무작위 32바이트 hex 키. 서버 세션 Secret·provider token과 구분합니다.

최초 initialize는 **현재 배포와 일치하는 소스·빌드·runtime**에서 실행합니다. 이전 버전 배포에 새 SDK를 빌드한 결과를 강제로 정상본으로 등록할 수 없습니다.
처음 연결하는 사이트는 먼저 공식 게이트의 정상 배포를 수동 검증한 뒤 initialize하세요.

## 운영 workflow

생성 workflow는 trusted 기본 브랜치의 `workflow_dispatch`만 허용합니다. PR 코드에 배포 자격증명을 주지 않습니다.
provider 프로젝트별 concurrency이며 모든 배포 경로를 자동 잠그지는 않습니다.

- 수동: `check`로 inventory를 조회하고 `verify`로 전체 자산을 검사합니다. 호스팅 쓰기는 없습니다.
- native 자동: 첫 dispatch의 `initialize=true`로 정상본을 생성합니다. 이후 `initialize=false`로 release합니다.
- owner-reviewed custom adapter: 해당 adapter의 정확한 credential/session 환경 이름과 CI state 전달을 연결하세요. 기본 생성 workflow는 읽기 전용 검사입니다.

```bash
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting check --json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting verify --json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting initialize --json
node node_modules/nakwol-connect/bin/nakwol-connect.mjs protect hosting release --json
```

native workflow는 `.nakwol/reports/hosting/baseline.enc`만 별도 pinned cache restore/save로 전달합니다.
AES-GCM으로 client/origin/provider/resource/account/team에 바인딩합니다. 원문 manifest/report·쿠키·Secret은 cache/artifact에 올리지 않습니다.
복구 성공 후 릴리스 job이 실패해도 봉인 정상본을 저장합니다. cache eviction 또는 키 변경 시 임의 정상본을 추측하지 않고 현재 정상 소스에서 initialize를 재수행하세요.

release는 이전 정상본의 member 접근·파일 해시·익명 차단을 재검사한 뒤 업로드합니다.
고정된 CLI는 단계별 후보만 업로드하고, API로 project/account와 operation/build/runtime를 확인한 뒤 현재 serving ID를 다시 비교하고 승격합니다.
Workers는 preview를 끄고 100% 버전만 배포합니다. Vercel은 production 후보를 `--skip-domain`으로 업로드한 뒤 승격합니다.
검증 실패 시 그 operation의 정확한 이전 배포만 복구합니다. 실패한 새 릴리스는 복구 성공 후에도 exit1입니다.

runner 중단·stale lock·외부 배포 경합은 자동 추정 복구하지 않습니다. 실제 serving ID와 실행 중인 job을 확인한 뒤 자신의 stale lock을 정리하고 정상 소스에서 initialize하세요.

## 우회 주소 및 한계

Vercel 신규 deployment URL도 검사 목록에 추가합니다. 알려진 origin을 목록에서 제거하면 수동 폐쇄 확인을 요구합니다.
복구 후에도 실패한 candidate URL이 공개 데이터를 반환하면 `recovery-failed`입니다. production alias 복구만으로 성공 처리하지 않습니다.
SDK는 배포를 자동 삭제하지 않습니다. 소유자가 문제 origin을 닫은 뒤 inventory와 모든 직접 경로를 다시 검증해야 합니다.
업로드 단계 실패로 production ID가 그대로여도 새로 생긴 origin을 검사 결과에 기록합니다.

Workers는 workers.dev/custom domain, Pages는 과거 deployment URLs/aliases/domains, Vercel은 project deployments/domains/aliases를 조회합니다.
분할 배포·불완전 pagination·API 실패는 거부합니다. Worker zone routes, 외부 R2/S3, 다른 project/proxy origin은 JSON origins에 추가하고 그 원본에도 게이트를 설치하세요.
JSON에 주소를 적는 것만으로 보호되지 않습니다. GitHub Pages에 Embed만 붙이는 방식은 서버 보호가 아닙니다.

HTML·JS/CSS·JSON·이미지·폰트·GET/HEAD/Range 보호는 유지합니다. lease/hot path/cache 정책은 이 기능으로 변경하지 않습니다.
자동 검사는 origin 최대100개, 파일당1MiB로 제한되며 초과 시 수동 검증이 필요합니다.
실제 계정 배포와 OAuth·GitHub 운영 CI는 별도 canary가 남아 있습니다. 구현·fixture 통과를 운영 검증으로 표현하지 않습니다.

참조: [Workers 배포 API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/),
[Vercel deploy](https://vercel.com/docs/cli/deploy), [Vercel promote 구현](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/promote/request-promote.ts).
