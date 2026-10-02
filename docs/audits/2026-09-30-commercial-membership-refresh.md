# T07 중앙 Discord 역할 자동 갱신

기준 commit `ca19343edc09b29b954ea7254916100297c9eb0b`, branch `feature/commercial-auth-foundation`.

## 구현 범위

중앙 AUTH에서만 OAuth access/refresh token을 AES-GCM으로 암호화 저장한다. AAD에는 사용자·토큰 용도·키 버전을 결합한다. 별도 키를 사용하며 이전 키는 지정된 시각까지만 읽는다. 삭제는 재인증 필요 tombstone으로 남겨 예전24시간 정책으로 돌아가지 않게 한다.

사용자의 활성 요청은14분부터 역할 재확인을 시도하며 정상 역할 증거의 hard expiry는15분이다. 사용자별 진행 요청 공유와 D1 lease/CAS를 사용한다. 새 refresh token은 역할 조회 전에 보존하고 역할·세대 변경은 같은 트랜잭션에 묶는다. 실패/429는 기존 정상 역할을 지우지 않으며 만료된 증거로는 승인하지 않는다.

기존 사용자는 migration0017 최초 적용+30일까지만 legacy24시간 규칙을 사용한다. 환경변수로 기한을 줄일 수 있다. 자동 역할 확인은 명시적인 재인증 요청의 완료 증거가 아니다.

운영자 역할 강제 확인 API/버튼, 사용자 계정 페이지의 갱신 상태 안내, 서버 proof 만료 경계를 연결했다.

## 검증 근거

구현자 집중 시험: 새 Miniflare D1 역할 갱신, 시즌 접근, access support, account, 기존 server gate integration 및 타입 검사. 중복 실행된 시험 수를 전체 고유 시험 수로 합산하지 않는다.

부모의 실제 로컬 HTTP smoke (`.wrangler/commercial/t07/http-smoke.ts`, `http-smoke.log`): 실제 D1 + 중앙 `/me`, 정상200 → 역할 제거403, Discord fixture2회, 응답에 access/refresh secret 없음. Discord는 모의 upstream이며 운영 Discord 로그인을 실행한 결과가 아니다.

독립 리뷰의 지적: upstream member401 조기 무효화 복구, 같은DB객체를 공유하던 동시성 시험의 공백, credential 삭제와 서버 proof 발급 사이 SQL fence. 모두 수정했고 독립 재검토에서 APPROVE, 남은 P1/P2 없음 판정을 받았다. 실제 D1을 공유하는 서로 다른 Proxy로 중앙 lease를 검증하며, `membership-issuance-race.test.ts`에서 접근 판단 후 credential 삭제/역할 제거를 주입한다. client/origin/PKCE/site credential/family/deny 검사는 유지한다.

## 배포와 미검증

운영 배포·npm 게시·원격 migration·중앙 Secret 등록은 하지 않았다. 실제 Discord 및 운영 다중리전 동작은 별도 출시 검증 대상이다. UI 문구/버튼의 실제 브라우저 검증은 이번 API smoke와 구분한다. T08 제어 전파, D02 후속 관리 기능은 이번 범위에 포함하지 않는다.

## 최종 검증 실행 기록

- `typecheck-final.log`: TypeScript 오류 없음.
- `full-initial.log`: 302개 중300개 통과. 변경된 membership 조회에 맞지 않는 기존 source assertion/mock 두 곳을 수정했다.
- `full-final.log`: 실패 보고 없이 마지막 SSO 시험 앞에서 도구240초 제한으로 중단. 전체 통과 근거로 사용하지 않는다.
- `final-focused.log`: 새 역할 갱신·발급 경합·SSO 격리4개 통과.
- 동시 실행4개로 제한한 전체 재검증 결과는 `full-bounded.log`에 보존한다. 기존 실패 시험이나 검증 조건을 삭제하지 않았다.

최종 전체 결과: `npx tsx --test --test-concurrency=4 tests/worker/*.test.ts packages/connect-cli/test/*.test.mjs` **304/304 통과**, 약191.9초. CLI pack은 전체 실행 준비 단계에서 통과했다. 독립 최종 재검토 APPROVE. 변경된 UI는 API/소스 시험까지만 확인했고 실제 브라우저 조작은 이번 단계에서 하지 않았다.
