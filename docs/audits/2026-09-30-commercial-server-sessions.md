# T06 서버 세션 갱신 검증

기준: `27ab4bd7538df2ce2e01af8dce73c26081ec64b7`, `feature/commercial-auth-foundation`.

## 구현

- 중앙 서버 전용 code exchange/refresh/revoke, 앱·origin별 credential 발급/회수와 감사 기록.
- 중앙 SSO family에 결합된 안정 handle과 generation CAS. 만료·회수·deny는 갱신을 거부한다.
- 공식 `nakwol-connect/server`에 AES-GCM handle/proof, 서버 PKCE/state 콜백, single-flight 갱신 추가.
- Workers/Pages/Vercel 어댑터는 같은 session 모듈을 배포한다. 0.10.0 후보이며 credential 설정 시에만 활성화한다.
- 유효 lease의 300개 이미지 요청은 중앙 호출 0회. 1시간 이후에도 서버 갱신으로 계속 이용한다.
- idle/absolute 정책 축소를 DB에 영구 반영한다. 이후 확대해도 이미 만료된 세션을 살리지 않는다.
- Embed는 로컬 status를 사용하고 중복 브라우저 인증을 생략한다. 로컬 로그아웃과 명시적 전체 로그아웃을 구분한다.

## 실행 근거

- 중앙 전용 실제 workerd/D1 테스트 6개: 300 동시 HTTP 갱신, 오래된 세대, 응답 유실, code 일회성, credential/family 회수, deny 경합, 관리 권한.
- 런타임 관련 29개: 300개 자산/동시 갱신, 두 모듈 인스턴스의 31초 지연·응답 역전, 키 회전, app/origin 결합, GET/HEAD/Range, 장애 차단.
- 재개 후 통합/Embed 6개 통과: `.wrangler/commercial/t06/resume-focused.log`.
- 통합은 실제 중앙 D1와 generated Pages runtime을 연결한다. A/B SSO, query/hash 복귀, 1시간 경과 갱신, 300 이미지 0회, 로컬 회수, 정책 축소 후 확대를 확인한다.
- 실제 Chrome + HTTPS localhost A/B + 실제 AUTH workerd/D1: 비로그인 callback401과 로그인 링크, 중앙 SSO 쿠키를 가진 A→B 자동 연결, 경로/query/hash 보존, 양쪽 `서버 세션 준비 완료` 확인. B 로그아웃204 후 status401, A는200 유지. 이미지: `output/playwright/t06-site-a.png`, `t06-site-b.png`.
- 재방문 브라우저 네트워크는 사이트 HTML200, 로컬 status200, SDK 정적 모듈만 요청하며 중앙 `/me`·브라우저 token 요청이 없다.

## 발견과 수정

- 기존 전용 시험의 Node→D1 프록시 300개 전송 시간 초과는 실제 workerd HTTP 시험으로 대체해 경합을 검증했다.
- stale generation의 proof 만료 시 최신 세대로 복구하며 성공한 서버 갱신은 중앙 idle도 연장한다.
- 정책을 줄였다가 다시 늘리는 사이 방문하지 않은 세션의 만료 부활을 차단했다.
- 독립 리뷰에서 발견한 전체 로그아웃 옵션 누락을 수정하고 회귀 시험을 추가했다. 최종 재리뷰 에이전트는 사용량 제한으로 실행되지 못했다.

## 경계와 다음 단계

운영 배포, 원격 migration, npm publish, 실제 Discord OAuth는 수행하지 않았다. 브라우저는 합성 회원과 SSO fixture를 사용했다. 운영 사이트에 자동 반영되지 않는다.

기존 proof 회수 반영 상한은 local lease 최대300초다. T08의 bounded-control35초는 미구현이다. 역할 신선도는 기존24시간이며 T07 자동 역할 갱신은 다음 단계다. DATA bearer는 서버 쿠키에서 생성하지 않는다. UI credential 발급 편의 기능과 후속 D02 등은 별도다.

전체 테스트 결과는 `.wrangler/commercial/t06/full-final.log`, 타입 검사는 `typecheck-final.log`에 기록한다. 초기 전체 실행의 governance 임의 포트 오류와 중앙 프록시 시간 초과는 `full-initial.log`에 보존했다.

재개 후 전체 실행: 300개 중299개 통과. 남은1개는 300 HTTP 응답의 본문을 모두 도착한 뒤 읽던 시험의 `Body is unusable` 오류였다. 각 응답이 도착하면 즉시 본문을 읽도록 수정하고 중앙 전용 시험을 재실행했다. 이 변경은 운영 코드와 승인 조건을 바꾸지 않는다. 최종 집중 결과는 `central-final.log`에 기록한다. 타입 검사 통과.

최종 실패 항목 재검증: `concurrency-final.log` 1/1 통과(300 동시 갱신, 약18.4초). 전체299개 통과 + 수정 항목1개 통과이며 수정 후 전체300개를 다시 실행하지는 않았다. 중앙 전용 전체 재실행은 도구60초 제한으로 중단되어 최종 근거에 사용하지 않는다.
