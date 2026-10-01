# 실제 호스팅 배포·복구 검증 진행 기록

상태: **테스트 프로젝트 운영 검증 일부 완료. AUTH 운영 배포·npm 공개 전.**

이 기록은 `LOCAL_UPDATE_REPORT_2026-10-01.md`의 향후 순서1~3을 실제 계정에서 실행한 결과입니다. 기존 서비스에 새 SDK가 적용됐다는 의미는 아닙니다.

## 실제 적용 범위

- 새 합성 Workers/Vercel 프로젝트만 배포했습니다. HTML1, JS4, CSS3, JSON4, PNG300, 폰트2, 다운로드1의315파일을 사용했습니다.
- 중앙 AUTH에는 이 테스트 사이트의 member 앱만 등록했습니다. 운영 AUTH 코드·원격 migration·기존 소비 사이트·npm latest는 변경하지 않았습니다.
- GitHub CI는 별도의 비공개 테스트 저장소에서 생성된 workflow를 실행했습니다. 쿠키·Secret·원문 정상본은 공개 소스에 넣지 않았습니다.
- 현재 중앙 AUTH와 연결된 실제 브라우저 시험은 기존 v2 세션 경로입니다. 신규 server-session 프로토콜 전체의 운영 검증으로 확대 해석하지 않습니다.

## 검증 결과

| 대상 | 결과 | 실행 근거 |
| --- | --- | --- |
| Workers native 실제 업로드·승격·정확한 이전 버전 복구 | 통과 | private `worker-native-release-after-canonical-fix.log` 및 이전 복구 기록 |
| Workers 생성 CI initialize | 통과 | run36869751455 / 최신 SDK run36873320905 |
| Workers 생성 CI 연속 release·동시 실행 직렬화 | 통과 | run36870219422 / 36870224209 |
| Workers 잘못된 runtime 후보 거부·이전 배포 복구 | 통과 | run36873606256: `ok=false`, `recovery-verified`, `recoveryVerified=true` |
| Workers 복구된 암호화 정상본으로 다음 release | 통과 | run36874342240: `release-verified`, `releaseAccepted=true` |
| Workers 잘못된 state key | 안전 중단 | run36875528935: 봉인 상태 거부, 전후 serving ID 동일 |
| Workers 정상본 cache 유실 | 안전 중단 | run36876078344: ENOENT, 전후 serving ID 동일. 기존 cache를 삭제하지 않고 시험 namespace를 분리한 뒤 원래 workflow로 복원 |
| Workers 만료·회수된 실제 회원 probe | 안전 중단 | run36876269479: `baseline-rejected`, 전후 serving ID 동일. 정상 probe 복원. 두 조건이 함께 있으므로 순수 만료만의 운영 증거로 표현하지 않음 |
| Vercel 실제 회원 쿠키·315파일·우회 주소 release | 통과 | private `vercel-real-release.log`: `release-verified` |
| Vercel 생성 CI initialize | 통과 | run36873525118 |
| Vercel 생성 CI release | 통과 | BLOCKED 시험 주소 폐쇄 후 run36886422971: `release-verified`, `releaseAccepted=true`; 현재 정상본 `dpl_2WkBMo8CHpf9RUex33MpgQJmKo3a` |
| Vercel 세션 키 오류 후보·정확한 이전 배포 복구 | 부분 통과 | run36887415420: API는 이전 정상본으로 복구했으나 최초 증명의503으로 `recovery-failed`. 후속 직접 회원200/익명401 및 run36888590564 전체 initialize 통과. 자동 복구 검증 통과로 표현하지 않음 |
| 실제 Chromium Workers→Vercel 중앙 SSO·새로고침 | 통과 | 각 사이트 이미지300개 로딩. 사이트별 logout204/revoke confirmed 뒤 중앙 SSO 재연결300개 로딩 |
| 실제 사이트 익명·잘못된 쿠키·타 사이트 쿠키 직접 접근 | 통과 | `live-browser-session-security.json`:70/70, GET/HEAD/Range 및 HTML/JS/CSS/JSON/이미지/폰트/다운로드 |

실행 근거 파일은 `.wrangler/commercial/live-canary/`의 private 기록입니다. 서로 중복되는 테스트 수는 합산하지 않습니다.

Vercel BLOCKED 시험 후보 `dpl_5ecSRqoLgFcRA8W9tZqpqFMWdwAk`는 SDK가 아닌 공급자 안내 페이지를 반환했습니다. 사용자의 계속 진행 지시에 따라 이 후보만 폐쇄했습니다. 삭제200·API404·이전 이미지 주소404를 확인했고, 당시 정상 배포는 전후 동일했습니다. 근거는 private `closed-blocked-candidate-proof.json`입니다.

새 오류 시험 후보 `dpl_8NPnWZLLat1ir8G1Ry7vp6VSMdFm`은 세션 키를 제거한 합성 배포입니다. 정상 배포는 복구됐고 시험 hook도 원래대로 복원했습니다. Hobby의 최근 production 빌드 제한 때문에 다음 안전 release에 앞서 이 후보 폐쇄 여부를 확인하고 있습니다. 이 후보는 아직 삭제하지 않았으며 실패 기록·소스도 보존합니다. 유료 전환이나 복구 제한 우회는 수행하지 않았습니다.

## 실제 시험에서 수정한 결함

| 커밋 | 원인과 수정 |
| --- | --- |
| `7f0aacc` | Vercel 설정의 공급자 정규화 필드까지 의미 기반 JSON hash로 비교. 기존 raw hash 호환 유지 |
| `0c01e7b` | 인증된 자산 canonical redirect를 같은 origin 안에서 최대5회 추적. 외부 origin에 쿠키 전달 금지, 최종 전체 bytes/SHA 검증 유지 |
| `45f0955` | 전체 테스트의 파일 단위 병렬 실행이 Miniflare 검증을 과부하시키므로 직렬화. 각 시험 내부300개 동시 요청은 유지 |
| `9f8ec75` | 실제 Workers version API의 최상위 annotations 계약에 맞춤 |
| `1e03ab0` | 실제 Vercel promote/rollback의 빈201 응답을 해당 API에만 허용한 뒤 정확한 serving ID 확인 |
| `212c31a` | 복구 직후 edge 전파 지연: 안전한 익명 차단과 정확한 배포/operation/origin 유지 시 전체 증명을 최대3회 재검사. 노출·불완전 증명·경합은 재시도로 합격시키지 않음 |
| `64c7a6d` | Hobby의 직전 production 복구 제한을 현재 team plan과 최근 READY 이력으로 업로드·승격·복구 전에 점검. 유료 전환·과거 배포 삭제 없음 |
| `e134045` | verify/deploy workflow의 고정 CLI0.7.1 확인을 후보 package version 기준으로 수정 |
| `9005853` | 봉인 report 복원 시 불필요한 JSON 들여쓰기를 제거. 실제 compact3577078bytes가 pretty4292290bytes로 늘어나 읽기 제한을 넘던 결함 |
| `c67ea91` | report 읽기 상한4MiB를 기존 봉인 상태 상한8MiB와 일치시킴. 모든 증명 필드 보존,8MiB 초과 거부. 이는 로컬 증명 memory budget 변경이며 인증 정책 완화가 아님 |

마지막 크기 수정은 실패 재현 후 대상29/29, 봉인·release6/6 및 reader 초과 거부 추가1/1을 확인했습니다. native Hobby 대상6/6, edge/보호/rollout 대상38/38도 통과했습니다. 독립 리뷰에서 해당 변경 범위의 남은 P1/P2는 발견되지 않았습니다. 이전 SDK248/248·직렬 Worker227/227은 이전 source snapshot의 근거이며 현재 전체 회귀 재실행으로 표시하지 않습니다.

## 성능·보안 정책

이번 실제 호스팅 수정은 lease TTL, member 조건, 쿠키 검증, asset hot path와 캐시 정책을 변경하지 않았습니다.

추가 focused bounded warm 시험은 동시300/모듈10/중앙100ms/이미지50KiB/warmup10/측정30에서 gate p95442.78ms, baseline397.70ms, 차이45.08ms, warm 중앙 호출0입니다. 이전122.73ms 초과 결과도 보존합니다. baseline 조건 차이가 있어 인증 코드 개선의 효과로 설명하지 않습니다.

108조합·실제 edge CPU·3지역·Firefox/Safari/모바일·일반 회원2계정·DB/Discord/quota 관측은 완료하지 않았습니다. focused 수치로 T11이나 상용 릴리스 전체를 승인하지 않습니다.

2026-10-02 후속 작업에서 전체108조합을 warmup10/측정30 및7개 상태로 순차 실행하기 시작했습니다. private `t11-matrix-current/progress.json`에 완료 조합을 기록합니다. SDK 인증 코드와 TTL은 수정하지 않았습니다. 초기 완료7조합은 warm 중앙 호출0을 유지했지만, 동시6/모듈1/중앙100ms/이미지200KiB에서 gate p951262.13ms·baseline537.86ms·차이724.27ms로100ms 예산을 초과했습니다. 중앙500ms/이미지10KiB도 차이240.45ms로 초과했습니다. 실패 수치를 보존하며, 이 로컬 수치를 실제 edge CPU나 SDK 원인 확정으로 바꾸어 설명하지 않습니다. 전체 행렬 합격 전입니다.

## 운영 사전검사 후속 수정 — 2026-10-02

- AUTH 실제 계정의 읽기 전용 credential/Worker 사전검사 run36887652694가 통과했습니다. 운영 Worker 코드는 배포하지 않았습니다.
- `production-smoke.yml`의 과거 CLI0.4 고정 및 후보 소스와 운영본을 비교하던 오류를 수정했습니다. 별도 stable checkout과 운영 manifest를 사용하며, 배포 후 후보 검사는 기존 `deploy.yml`에 유지합니다.
- 버전별 SDK 원본과 alias는 import 상대 경로가 다릅니다. 실제 `src/sdk.ts`의 변환을 반영한 전체 bytes 비교를 유지합니다. 잘못된 초기 비교의 실패 run36889092376/36889728732도 보존합니다.
- 다운로드한 CLI tarball의 name/version을 검증하고 동일한 파일을 실행합니다. required/member, Embed가 서버 보호를 대신하지 않는 계약, 익명 account/lab API401, DATA0.9 검사를 유지합니다.
- 독립 리뷰에서 DB 미존재 시 사전검사가 새 DB를 만들 수 있는 P2를 발견했습니다. `ensure-d1 --existing-only`로 생성 전에 중단하도록 수정했습니다. 실제 스크립트의 경계 테스트 RED→GREEN3/3, 기존 운영 회귀 검사1/1을 확인했습니다. 추가 리뷰에서 해당 변경의 남은 P1/P2는 없었습니다.
- 수정한 실제 운영 baseline smoke run36890111874는 통과했습니다. 이는 현재 운영 CLI0.7.1/browser SDK0.3.2가 정상이라는 근거이며 새 CLI0.14.0·server-session 운영 배포 근거는 아닙니다.

## 남은 순서

1. 새 Vercel 오류 시험 후보의 폐쇄 여부를 결정하고, 자동 복구 검증 및 복구 후 다음 release를 완료합니다. 최초 정상 CI release와 복구 정상본의 전체 initialize는 통과했습니다.
2. 일반 회원2계정 검증을 완료합니다. 만료/회수된 실제 probe의 CI 거부 결과는 위에 기록했습니다.
3. T11 전체 행렬 및 예산 초과 원인을 확인하고 남은 수용 항목을 해결합니다. 운영 baseline smoke의 과거 버전 계약 수정은 완료됐습니다.
4. 검증된 source를 feature→dev→main→stable로 승격하고 검증용 npm tag 및 AUTH 운영 배포를 진행합니다. 이후 latest·소유 서비스에 단계 적용합니다.

현재 npm0.14.0 공개·AUTH 운영 배포·기존 서비스 업데이트 완료로 보고하지 않습니다.
