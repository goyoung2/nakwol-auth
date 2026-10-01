# 낙월 인증기 로컬 업데이트 보고서 및 향후 계획

작성일: 2026-10-01 (한국 시간)

## 1. 요약

이번 작업은 **Cloudflare·Vercel 연결 템플릿과 설치 마법사**, 그리고 명시적으로 선택한 사이트의 **검증 후 배포·실패 복구 연결**을 구현한 작업입니다.
로컬 구현과 검증은 완료했지만 실제 호스팅 계정·GitHub 운영 CI에서의 검증 및 공개 배포는 남아 있습니다.
전체 상용 서비스 개발이 끝났다는 뜻은 아닙니다.

| 항목 | 확인한 상태 |
| --- | --- |
| 저장소 | `goyoung2/nakwol-auth` 로컬 작업 사본 |
| 브랜치 | `feature/commercial-auth-foundation` |
| 구현 HEAD | `5789302aaa54f5ec79eeb3333fbddafdd5805629` |
| 보고서 작성 전 작업 트리 | 깨끗함 |
| 로컬 SDK 버전 | `nakwol-connect@0.14.0` |
| npm 공개 latest | `0.7.1` — 보고서 작성 시 registry 재조회 |
| GitHub push / npm 게시 / AUTH 운영 배포 | 이번 작업에서 실시하지 않음 |
| 기존 운영 사이트 변경 | 이번 작업에서 실시하지 않음 |

이 보고서는 구현 HEAD를 기준으로 작성했습니다. 보고서 자체의 커밋은 이후 HEAD가 됩니다.

## 2. 로컬 변경 내용

### 2.1 설치·연결 마법사

- 기존 `/developer/setup`의 설치 단계에 호스팅 연결 설정을 추가했습니다.
- Cloudflare account/Worker 또는 Pages 이름, Vercel project/team 및 추가 직접 접근 주소를 입력합니다.
- Secret 없는 `nakwol-hosting.json`을 다운로드하며, CLI `protect hosting wizard`도 제공합니다.
- 서비스 ID·HTTPS origin·호스팅·계정·프로젝트·required/member 설정이 기존 게이트와 일치하는지 검사합니다.
- 기본은 **수동 배포 + 검사**입니다. 자동 모드는 배포 경로를 통제하겠다는 명시적 선택이 필요합니다.
- 기존 CI·사용자 정의 gate hook·다른 버전 의존성·위험한 심볼릭 링크를 임의로 덮어쓰지 않습니다.

### 2.2 제공하는 호스팅별 기능

| 호스팅 | API 조회·직접 접근 검사 | 공식 배포·복구 adapter 생성 |
| --- | --- | --- |
| Cloudflare Workers Static Assets | 제공 | 제공 |
| Cloudflare Pages 정적 빌드 | 제공 | 미제공; 수동 또는 기존 reviewed adapter |
| Vercel 공식 정적 게이트 설치 | 제공 | 제공 |
| 기타 호스팅 | 공통 게이트·portable adapter 계약 사용 | 해당 환경에 맞는 reviewed adapter 필요 |

Workers는 고정된 Wrangler로 버전을 업로드한 뒤 요청 계정의 artifact 및 현재 배포를 확인하고 100% 승격합니다.
Vercel은 고정된 CLI로 production 후보를 `--skip-domain` 업로드하고 project/team·작업 ID·빌드·runtime·준비 상태를 확인한 뒤 승격합니다.
SDK가 Discord OAuth나 중앙 비밀값을 각 사이트에 복사하지 않습니다.

### 2.3 정상본·배포·복구

- `protect hosting initialize`: 현재 실제 배포와 일치하는 빌드를 정상 member 접근 및 익명 차단으로 검사한 뒤 정상본을 봉인합니다. 호스팅 배포는 하지 않습니다.
- `protect hosting release`: 이전 정상본을 재검증하고 후보를 배포·검사합니다. 실패하면 그 작업의 정확한 이전 배포만 복구합니다.
- 정상본은 AES-GCM으로 client/origin/provider/resource/account/team에 바인딩합니다.
- native 자동 workflow는 기본 브랜치의 수동 실행, production environment, 프로젝트별 concurrency 및 암호화 정상본 단독 cache restore/save를 생성합니다.
- 복구 성공 후에도 실패한 새 릴리스는 실패 상태와 exit1을 유지합니다.
- provider CLI와 SDK 버전을 고정하고, probe 쿠키·state key·GitHub/Discord 비밀을 배포 adapter의 자식 프로세스에 넘기지 않습니다.

현재 자동 연결은 **배포·검증·복구 실행 경로**를 제공하는 것입니다.
SDK 버전 선택, PR 생성·검사·병합, 모든 외부 사이트 업데이트가 무인 운영으로 검증됐다는 뜻은 아닙니다.
기존 안전한 자동 업데이트 코어의 GitHub 운영 검증도 별도로 남아 있습니다.

### 2.4 우회 주소 검사

- 과거 deployment URL, preview, custom domain, alias 및 명시적으로 등록한 외부 origin을 검사합니다.
- 배포 중 새 Vercel 주소가 생기면 검사 목록에 추가합니다.
- 이전 정상본에 기록된 origin이나 이미 알려진 origin이 사라지면 자동으로 검사에서 제외하지 않습니다.
- production 주소가 복구됐어도 실패한 candidate 주소가 데이터를 공개하면 복구 합격으로 처리하지 않습니다.
- 배포를 자동 삭제하지 않습니다. 삭제·주소 폐쇄는 소유자가 검토하고 재검증해야 합니다.

## 3. 보안 조건과 운영상의 제한

이번 변경은 로그인 시 역할 판정, 세션 lease, 자산 요청의 인증 처리 경로 및 캐시 정책을 변경하지 않았습니다.
서버 게이트의 required/member 및 HTML·JS/CSS·JSON·이미지·폰트·GET/HEAD/Range 보호 조건을 유지합니다.

다만 다음 운영 조건이 필요합니다.

1. 자동 모드에서는 호스팅 Git 자동 배포, 다른 CI, 대시보드 동시 배포를 통제해야 합니다. 플랫폼 API의 원자적 compare-and-swap을 가정하지 않습니다.
2. API로 조회할 수 없는 Worker zone route, 외부 R2/S3, 다른 프로젝트·proxy origin은 명시적으로 등록하고 그 원본에도 게이트를 적용해야 합니다.
3. 자동 검사는 origin 최대100개 및 파일당1MiB로 제한됩니다. 초과하면 수동 검증이 필요합니다.
4. 정상 member 검사 쿠키는 만료 가능한 사용자 세션입니다. 만료 시 갱신해야 하며 영구 관리자 우회 쿠키를 쓰지 않습니다.
5. CI cache가 지워지거나 state key가 바뀌면 현재 정상 소스에서 initialize를 재수행해야 합니다. stale lock·불확실 배포를 임의로 정상 처리하지 않습니다.

## 4. 검증 결과

아래는 이전 개발 단계에서 실행한 로그를 이번 보고서 작성 시 다시 확인한 결과입니다.
문서 작성만을 위해 전체 테스트를 다시 실행하지 않았습니다. 서로 겹치는 테스트 묶음은 합산하지 않습니다.

| 검증 | 결과 | 증거 파일 |
| --- | --- | --- |
| SDK 전체 회귀 | 245/245 통과 | `native-sdk-final.log` |
| native/hosting/portable 대상 | 47/47 통과 | `native-targets-final.log` |
| 이후 origin 이력 보강 및 release 회귀 | 27/27 통과 | `native-origin-history.log` |
| tarball 설치→게이트 설치→plan/connect→update→status | 5개 모드 통과 | `native-packed-final.log` |
| 로컬 Chromium 입력·다운로드·전환·모바일·초기화 | 8개 흐름, pageErrors0 | `native-browser-results.log` |
| built AUTH schema module 및 화면 JavaScript | 2/2 통과 | `native-surface-final.log` |
| TypeScript 검사 및 패키지 생성 | exit0 | `native-typecheck-final.log` |

증거 위치: `.wrangler/commercial/hosting-connections/` — 로컬 private 기록이며 Git에서 제외합니다.
추적 가능한 상세 설명은 [구현 검증 기록](audits/2026-10-01-hosting-connections.md)에 있습니다.

별도 reviewer가 발견한 계정 불일치 업로드 위험, 자동 모드 권한 안내 오류, adapter 파일 생성 회귀를 수정했습니다.
최종 검토 범위에 남은 구체적 P1/P2는 없었습니다.
SDK 첫 재검증의 실패 및 concurrent fixture의 부분 JSON 읽기 오류도 기록하고 수정했습니다.

**실제 Cloudflare/Vercel 계정의 쓰기·복구, GitHub 운영 CI, OAuth 왕복, 운영 canary는 이 검증에 포함되지 않습니다.**
provider API와 고정 CLI 자식 프로세스 검사는 fixture 기반입니다. 전체 AUTH 테스트 및 상용 성능 수용 검증을 모두 통과한 것으로 해석하면 안 됩니다.

## 5. 변경 커밋과 주요 파일

| 커밋 | 내용 |
| --- | --- |
| `17074fc` | 호스팅 마법사·검사 템플릿·봉인 정상본 연결 |
| `443ed0a` | 설치 문서 및 당시 구현 범위 기록 |
| `5789302` | Workers/Vercel native 배포·복구·CI 연결 및 검증 보강 |

주요 변경 파일:

- `packages/connect-cli/src/hosting-connection.mjs`: plan/connect/inventory 및 workflow 생성
- `packages/connect-cli/src/hosting-wizard.mjs`, `src/developer-setup-page.ts`, `src/assets/nakwol-developer-setup.js.txt`: 설치 화면과 CLI 입력
- `packages/connect-cli/src/hosting-native.mjs`, `hosting-upload.mjs`: 호스팅 업로드·승격·복구
- `packages/connect-cli/src/hosting-state.mjs`, `hosting-release.mjs`: 정상본 암호화·초기화·release
- `packages/connect-cli/src/portable-rollout.mjs`: 공통 검증·복구 및 origin 이력 유지
- `scripts/hosting-connection-smoke.mjs`, 관련 테스트: 실제 패키지 설치와 보안 회귀
- README 및 [호스팅 연결 안내](HOSTING_CONNECTIONS.md): 설치·Secret·운영·복구 설명

## 6. 향후 계획

아래 순서는 향후 작업 제안이며, 이번 보고서 작성에서 배포를 실행하지 않습니다.

| 순서 | 작업 | 완료 판단 기준 |
| --- | --- | --- |
| 1 | 실제 Workers·Vercel 테스트 프로젝트에서 운영 연결 검증 | 실제 API 권한·고정 CLI·업로드·승격·정확한 이전 배포 복구 확인; 외부 프로젝트 쓰기0 |
| 2 | 생성 GitHub workflow의 실제 실행 검증 | initialize→release→실패 복구→다음 release, 암호화 cache 전달·유실·키 오류·쿠키 만료·동시 실행 확인 |
| 3 | 운영 전 보안·사용성 수용 검사 | 익명 직접 URL GET/HEAD/Range 차단; 일반 member의 로그인·이동·새로고침·로그아웃·재로그인 확인; 실패 candidate 우회 주소까지 검사 |
| 4 | 성능 및 상용 릴리스 잔여 항목 해결 | 기존 T11 성능 budget·edge CPU·수용 matrix 재검증, 기존 미충족 항목 해결; fixture 성공으로 대체하지 않음 |
| 5 | npm 및 AUTH 공개 | 기존 릴리스 검증 절차 통과 후 검증용 npm tag로 배포하고 검증; stable latest 전환 및 AUTH 마법사 배포 |
| 6 | 소유한 서비스에 제한 적용 후 순차 확대 | 기존 clientId·정책·Secret 보존; update·재빌드·재배포·보호 검사 완료, 관찰 기간 동안 반복 로그인·로딩 회귀 없음 |
| 7 | 외부 개발자 온보딩 및 유지보수 | 호스팅별 설치·필수 권한·Secret·쿠키 갱신·오류 진단·수동 복구 안내를 검증된 공개 버전과 함께 제공 |

운영 배포는 검증된 커밋과 패키지로 고정하고, 이전 정상본 및 복구 경로를 먼저 확보합니다.
릴리스 수락은 비로그인 차단과 정상 member 접근을 함께 통과해야 합니다. 401만 반환하는 사이트를 합격으로 처리하지 않습니다.

## 7. 기존 사용자에게 필요한 조치

후속 실제 배포 시험은 [실제 호스팅 배포·복구 검증 진행 기록](audits/2026-10-01-live-hosting-release.md)에 별도로 기록했습니다. 아래는 최초 로컬 보고 시점의 상태이며, 후속 시험 배포를 AUTH·npm·기존 서비스의 운영 업데이트로 해석하지 않습니다.

지금은 로컬 개발만 반영했으므로 기존 사용자가 즉시 해야 할 조치는 없습니다.
npm 게시만으로 기존 서버 게이트가 자동 변경되지 않습니다.

공개 후 새 기능을 쓰려는 서비스 운영자는:

1. 검증된 exact SDK 버전과 lockfile로 업데이트합니다.
2. 공식 게이트를 update하고 다시 빌드·배포합니다.
3. 마법사에서 수동 검사 또는 통제 가능한 자동 모드를 선택합니다.
4. 필요한 Secret을 호스팅과 GitHub environment에 각각 등록합니다.
5. 자동 모드는 정상 배포와 일치하는 소스에서 initialize한 뒤 release합니다.
6. 모든 직접 접근 주소의 익명 차단 및 일반 member 사용 흐름을 확인합니다.

외부 개발자가 이미 만든 별도 adapter는 공식 생성 코드로 자동 교체되지 않습니다. reviewed 계약을 유지하거나 변경분을 검토하여 이전해야 합니다.
