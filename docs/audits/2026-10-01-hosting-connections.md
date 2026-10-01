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

**전체 상용 운영이나 native 자동 업데이트 완료는 아니다.**

- native deploy/rollback adapter 자동 생성: 미구현. automatic은 기존 reviewed adapter가 있어야 한다.
- native account CI Secret/permissions/actual host APIs/production rollout/canary: 미검증.
- GitHub CI baseline cache 전송 자동 설치: 미구현. owner-controlled trusted state 전달이 필요하다.
- 동적 origin 추가·provider-scoped closure 처리: 미구현. 기존 fixed-origin portable 계약은 유지한다.
- API inventory 밖 Worker zone routes/external storage/proxy origin: 명시적 등록·실제 게이트 적용 필요.
- 자동 GitHub PR merge native 운영, original T11 성능 budget/edgeCPU/수용 matrix 및 T12 전체 릴리스:
  이전 checkpoint의 미완료 상태를 그대로 유지한다.
- npm latest는 조회 시 0.7.1; 로컬0.14.0 후보는 게시하지 않았다. 공개 설치에는 npm 릴리스가 필요하다.
- AUTH의 새 wizard 운영 노출은 AUTH 배포가 필요하다. 기존 소비 사이트에 자동 반영했다고 보고하지 않는다.

실행 중 권한·세션·auth hot path 및 asset cache 계약은 수정하지 않았다. 이번 CLI 연결은 명시적 opt-in이며
기존 서비스의 중앙 설정/호스팅/Secret/DB를 변경하지 않는다. native read-only fixtures와 로컬 HTTP 성공을
실제 Cloudflare/Vercel 운영 성공으로 표현하지 않는다.
