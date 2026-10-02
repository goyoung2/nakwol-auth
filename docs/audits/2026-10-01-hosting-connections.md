# 호스팅 연결 템플릿·마법사 구현 검증

기준: feature/commercial-auth-foundation / 41f86acf88fc6a0cfb1c23b1a124b082e3e5f6e3.
현재 결과는 로컬 구현이다. npm/push/운영 배포는 하지 않았다.

## 구현

- 기존 D04 마법사의 설치 단계와 CLI wizard에서 Secret 없는 hosting JSON을 생성한다.
- strict shared validator로 client/origin/provider/account/resource/team 및 명시적 모드를 검증한다.
- plan/connect가 기존 공식 required/member gate·wrangler/Vercel link와 비교한다.
- 기존 CI·custom hook·symlink·중복 SDK dependency는 쓰기 전에 거부한다.
- exact 로컬 SDK hook과 hosting 설정은 gate update 이후 보존한다. production dependency도 exact이면 지원한다.
- 기존 gitignore를 보존하고 private .nakwol/reports/ 제외 규칙을 마지막에 추가한다.
- Workers/Pages/Vercel API 조회는 GET 전용이며 프로젝트·과거 배포·custom domain·alias 목록을 검사한다.
- 기본 브랜치 workflow_dispatch가 실제 배포를 검사한다. normal cookie 없이는 releaseAccepted:false다.
- normal cookie가 있으면 actual serving ID의 전체 build manifest와 body hash를 확인한다.
  deny-all, deployment/origin 변동, API 장애는 성공으로 표시하지 않는다.
- 이미 reviewed automatic adapter가 있는 경우 initialize/release를 연결한다.
  AES-GCM state는 client/origin/provider/resource/account/team에 결합하며 원본 manifest bytes를 보존한다.
  다른 키/state 변조/lock/잘못된 회원 cookie는 배포하지 않는다.
- 기존 portable rollout 한 곳이 baseline/deploy/verify/recovery를 수행한다.
  복구 정상본을 다시 봉인하고 실패 release의 exit1은 유지한다.

## 검증 결과

증거 경로: `.wrangler/commercial/hosting-connections/` (로컬, ignored).

| 검증 | 결과 | 증거 |
| --- | --- | --- |
| SDK 전체 회귀 | 231/231 | sdk-final.log |
| hosting11 + managed8 | 19/19 | final-targets.log |
| D04 Worker setup +3adapter 실제 HTTP fixture | 10/10 | setup-worker.log |
| 실제 served browser JS 구문 + compiled AUTH hosting-schema route | 2/2 | surface-tests.log |
| 최종 pack/typecheck | exit0 | typecheck-final.log |
| 실제 tarball3provider gate install→hosting plan/connect→update→offline status | 모두 통과 | packed-hosting.log |
| 기존 tarball automate/npm-ci/build/HTTPS protect verify | 24probes 통과 | packed-smoke.log |
| 기존 tarball rollout + outage recovery | 246HTTPS probes; release-verified/recovery-verified; 실패 exit1 | packed-smoke.log |
| 실제 Chromium D04 입력·JSON 다운로드·전환·추가 origin·모바일·reload | 7flows, pageErrors0 | browser-results.json, hosting-mobile.png |

setup-worker 실행 wrapper는 combined60초 한계에 걸렸으나 child가 완료한 로그에는 10/10과 fail0,
전체 duration59672ms가 기록됐다. root 전체 test suite를 다시 통과했다고 주장하지 않는다.

initial release fixture의 outage 조건이 이전 정상 배포까지 실패시키는 오류는 테스트 fixture에서
새 candidate ID에만 실패를 적용하여 바로잡았다. 제품의 fail-closed 조건을 완화하지 않았다.

fresh reviewer가 실제 module syntax failure, hosting metadata 누락, 설치 명령 버전 선택,
production dependency connect→update 실패를 발견했다. 모두 수정했으며 마지막 검토에서
검토 범위의 남은 P1/P2가 없음을 확인했다. 해당 agent는 native account/npm/OAuth QA를 하지 않았다.

## 미완료·미검증

**이번 설치 기능은 native Workers/Vercel까지 구현했으나 전체 상용 운영 및 native 운영 검증은 아니다.**

- native Workers/Vercel deploy/rollback adapter 자동 생성: 후속 구현 완료. Pages native 쓰기는 미제공, 수동/custom adapter 지원.
- native account CI Secret/permissions/actual host APIs/production rollout/canary: 미검증.
- native GitHub CI baseline cache restore/save: 후속 구현 완료. 암호화 baseline만 전달하며 복구 후 실패 job에서도 저장. GitHub 운영 실행은 미실시.
- 동적 origin 추가: 후속 구현 완료, 새 preview도 전체 검사. 알려진 origin 제거·자동 삭제는 거부/미제공. candidate 유출이 남으면 recovery 실패.
- API inventory 밖 Worker zone routes/external storage/proxy origin: 명시적 등록·실제 게이트 적용 필요.
- 자동 GitHub PR merge native 운영, original T11 성능 budget/edgeCPU/수용 matrix 및 T12 전체 릴리스:
  이전 checkpoint의 미완료 상태를 그대로 유지한다.
- npm latest는 조회 시 0.7.1; 로컬0.14.0 후보는 게시하지 않았다. 공개 설치에는 npm 릴리스가 필요하다.
- AUTH의 새 wizard 운영 노출은 AUTH 배포가 필요하다. 기존 소비 사이트에 자동 반영했다고 보고하지 않는다.

실행 중 권한·세션·auth hot path 및 asset cache 계약은 수정하지 않았다. 이번 CLI 연결은 명시적 opt-in이며
기존 서비스의 중앙 설정/호스팅/Secret/DB를 변경하지 않는다. native read-only fixtures와 로컬 HTTP 성공을
실제 Cloudflare/Vercel 운영 성공으로 표현하지 않는다.

## Native 후속 구현

- Workers: exact wrangler4.119.0 version upload machine receipt→요청 계정의 version annotation 확인→현재 serving ID 비교→100% promote; exact 이전 version rollback.
- Vercel: exact vercel62.1.0 production skip-domain→project/team/operation/build/runtime/READY 확인→현재 serving ID 비교→promote; operation의 정확한 이전 production 배포 rollback.
- provider credential만 adapter/CLI로 전달하고 probe cookie/state key/GitHub/Discord 비밀은 제외한다. public JSON과 stderr에 토큰을 기록하지 않는다.
- .nakwol/hosting-adapter.mjs 생성, SHA256 검토 정책, private reports 및 살아있는 release parent lease 요구. 기본 수동 모드 유지.
- 자동 workflow는 trusted default-branch workflow_dispatch, production environment, concurrency, pinned actions 및 baseline.enc 단독 cache restore/save. 다른 배포 경로는 소유자가 통제해야 한다. native CAS를 가정하지 않는다.
- 새 origin을 익명 GET/HEAD/Range 검사에 추가한다. 제거되거나 candidate origin 유출이 복구 후 남으면 합격하지 않는다. production ID가 그대로인 업로드 실패에서도 알려진 새 origin을 검사한다.

### 후속 리뷰 수정

fresh reviewer review_native_hosting:
1. Wrangler config.account_id 우선순위에 따른 foreign-account upload 위험: preparation 및 upload 시작 전 일치 검사, CLI 호출0 테스트 추가.
2. 생성 안내가 자동 모드에서도 읽기 권한만 설명: mode별 쓰기 권한·초기화·release·cache 안내로 수정.
3. plan.files4/contents3 중간 회귀: adapterSource를 같은 생성 목록에 포함, targeted native2/2 재검증.

전체 SDK 첫 재검증245개 중3실패(위 native 생성2 및 concurrent fixture JSON truncate1)를 실제 기록했다.
concurrent fixture는 state를 temp+rename으로 바꿔 실제 경합 검사의 검증 조건을 유지하고 partial JSON 읽기를 제거했다.
최종 증거는 native-sdk-final.log / native-targets-final.log / native-packed-final.log / native-surface-final.log / native-browser-results.log다.
native API는 fixtures이며 실제 계정·GitHub CI·OAuth·production mutation은 하지 않았다. 고정 CLI 자식 프로세스도 provider CLI fixture다.

### 후속 최종 검증

| 항목 | 결과 | 증거 |
| --- | --- | --- |
| SDK 전체 회귀 | 245/245 통과 | native-sdk-final.log |
| native/hosting/portable 대상 | 47/47 통과 | native-targets-final.log |
| 이후 baseline origin 이력 보강 및 release 회귀 | 27/27 통과 | native-origin-history.log |
| 실제 tarball 설치·plan/connect/update | Workers 수동/자동, Pages 수동, Vercel 수동/자동5흐름 통과 | native-packed-final.log |
| 실제 로컬 브라우저 | 8흐름, pageErrors0, 375px overflow없음 | native-browser-results.log |
| built AUTH의 schema module 및 화면 JS | 2/2 통과 | native-surface-final.log |
| TypeScript 및 tarball build | exit0 | native-typecheck-final.log |

review_native_hosting 최종 대상 재검토: 남은 구체적 P1/P2 없음. 이후 추가한 baseline origin 이력 검사도27/27로 검증했다.
암호화 baseline에 기록된 origin을 다음 release의 API inventory에서 없애는 경우 배포 전에 중단한다.
검증용 browser-fixture 서버는 종료했다. npm 최신 버전 재조회0.7.1; publish/push/운영 배포 미실시.
