# 상용 운영 계획 T03/T04 로컬 구현 기록

기준 commit: `1835a480e1f7625eb4095059bde92688dcc90695`.
브랜치: `feature/commercial-auth-foundation`. Connect/runtime 소스 버전: `0.8.0`.

## 구현

- Workers/Pages/Vercel static 어댑터가 공통 게이트 소스를 생성합니다. Vercel matcher는 전체 경로이며 기존 middleware/proxy/라우팅/API/SSR을 덮어쓰지 않습니다.
- AUTH origin 정규화, URL 기반 SDK 경로, SDK 로드 실패의 실제 재시도·계정 복구 UI를 적용했습니다.
- manifest 생성과 전체 파일 크기·해시 확인, origins 파일, Pages의 등록 프로젝트 한정 read-only 주소 발견을 추가했습니다.
- 401 본문 canary/hash 유출, 익명 304, 공개 리다이렉트, 불완전 본문을 검사합니다. 정상 인증 파일의 존재·해시도 확인해야 출시 판정을 통과합니다.
- 실제 요청 수와 논리 검사 수를 구분하고 배포/build/runtime/manifest digest를 연결합니다. 중앙에는 경로·본문·쿠키를 전송하지 않습니다.
- 자동 롤백에는 새 기준으로 검증한 이전 배포 증거가 필요합니다. 복구 후에도 manifest와 정상 세션 검사가 필요하며, 검증 자료가 없으면 `recovery-unverified`로 기록합니다.
- doctor/status의 기존 필드를 유지하며 schemaVersion/capabilities를 추가했습니다. 0.7.x 설치는 자동으로 0.8.0으로 전환되지 않습니다.

## 실행한 검증

| 검증 | 결과 |
| --- | --- |
| 전체 `npm run test:unit` | 244/244 통과 |
| `npm run typecheck` (CLI pack 포함) | 통과, 0.8.0 tarball 생성 |
| T03/T04 핵심 테스트 9개 파일 | 48/48 통과 (후속 회귀는 전체 결과에 포함) |
| Workers/Pages 실제 workerd fixture와 CLI 직접 요청 검사 | 통과 |
| 생성된 Vercel middleware + 실제 `@vercel/functions@3.9.9` | 비로그인 28개 GET/HEAD/Range/조건부 요청 차단 |
| Vercel 정상 member 세션 | 최초 `/me` 1회, 이후 자산 328개에서 추가 `/me` 0회 |
| 실제 로컬 HTTP 서버의 검증기 | 익명 차단·정상 인증 파일 해시·GET/HEAD/Range/캐시 검사 통과 |
| 독립 리뷰 | P1 1개 발견, RED→GREEN 회귀 수정 완료 |

초기 전체 검사에서 버전 안내 및 동적 import fixture 4개가 실패했습니다. 수정 후 문서의 Windows CRLF 비교 1개가 남아 줄바꿈 처리까지 수정했고 최종 244개가 통과했습니다. 실패 검사를 삭제하지 않았습니다.

리뷰에서 발견한 P1은 legacy 헤더 검사 보고서로 자동 롤백을 승인하는 경로였습니다. 이제 강한 baseline 증거를 요구하며, 복구 결과도 `.ok`만으로 성공 처리하지 않습니다. 대상 artifact ID와 새 복구 deployment ID를 구분합니다.

## 결정과 제한

- 출시·롤백 합격 기준이 강화되므로 minor 버전 0.8.0을 명시적으로 선택하도록 했습니다. 기존 0.7.x 훅은 유지됩니다.
- 주소 자동 발견은 Pages의 명시적으로 등록된 계정·프로젝트, 최대 100개 배포만 지원합니다. Workers/Vercel은 `unsupported`이며 주소 파일을 사용합니다. 발견이 불완전하면 출시 합격으로 처리하지 않습니다.
- 본문은 1 MiB까지 검사하고 더 크면 부분 검사입니다. 다른 origin 리다이렉트와 여러 단계 리다이렉트는 추적하지 않습니다. HTTP 실패만으로 주소 폐쇄를 추정하지 않습니다.
- root dependency 설치에서 기존 Wrangler 4.141.0과 workers-types 4.x의 peer 충돌이 확인되었습니다. 강제 설치하지 않았습니다. 실제 Vercel dependency는 격리된 테스트 폴더에 설치했고 root devDependency에도 정확한 버전을 기록했습니다. 기존 toolchain으로 전체 테스트·타입 검사는 통과했습니다.
- 정상 사용자의 자산 hot path, 5분 lease, 사이트 세션 만료, 보안 캐시 정책을 완화하지 않았습니다.

## 미수행

운영 배포, npm 게시, Git push, 실제 Discord 계정으로 세 플랫폼 OAuth, Vercel CDN의 최종 헤더·304·라우팅 검증은 수행하지 않았습니다. 따라서 계획의 T03 **세 플랫폼 실배포 수용 기준은 아직 완료가 아닙니다**. T05 이후의 정책 관리·세션·외부 개발자 운영 기능도 이번 범위에 포함하지 않았습니다.

설치·증거 스키마·실행 명령은 [보호 증거 안내](../PROTECTION_EVIDENCE.md), 복구 절차는 [배포 롤백 안내](../DEPLOYMENT_ROLLBACK.md)를 참고하세요.
