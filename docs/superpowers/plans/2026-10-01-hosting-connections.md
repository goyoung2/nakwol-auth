# Cloudflare·Vercel 업데이트 연결과 설치 마법사

기준 HEAD41f86ac. 승인된 상용 설계/T12와 안전한 자동 업데이트 코어의 후속 구현.
사용자 요청: Cloudflare·Vercel 연결 템플릿과 마법사를 완성하고 npm 공개 상태를 확인.
registry 조회: latest0.7.1(2026-10-01). 로컬 후보0.14.0은 미게시. 이 작업은 운영
계정 변경·npm publish·shared branch push를 포함하지 않는다.

## 구현 계약

- 기존 D04 마법사의 설치 단계에서 호스팅 식별자·수동/자동 모드·필수 조건을 입력하고
  Secret 없는 별도 hosting JSON을 다운로드한다. 기존 setup schema/API/앱/정책은 유지한다.
- CLI connect는 공식 required/member 게이트와 앱/origin/provider 바인딩을 검증한다.
  기존 CI/adapter는 덮어쓰지 않는다. 검토할 adapter/workflow와 Secret 안내를 생성한다.
- Cloudflare Workers 및 Vercel의 실제 API·로컬 고정 CLI를 사용한다. SDK에
  중앙 Discord Secret을 넣지 않으며 호스팅 credentials는 사이트 CI에만 둔다.
- automatic은 owner가 모든 변경을 동일 workflow로 통제하고 host Git 자동 배포를 끈
  경우만 opt-in 가능하다. GitHub concurrency와 로컬 operation lease를 요구한다.
  플랫폼이 원자적 CAS를 제공한다고 주장하지 않는다. 외부 직접 변경은 지원 조건 위반이며
  현재 ID를 변경 직전에 다시 비교하고 충돌·불확실 결과를 성공으로 표시하지 않는다.
- Worker는 version upload 후 명확한 100% promotion, Vercel은 production skip-domain
  artifact 후 promotion. Pages는 수동 배포 검사 또는 기존 custom adapter로 지원한다. Secret/DB migration은 없다.
- baseline 생성은 read-only initialize, normal member cookie 전체 proof와 실제 serving ID 확인.
  baseline은 client/origin/resource에 바인딩한 AES-GCM으로 봉인하여 CI cache에 보존한다.
  미검증·위조·다른 사이트 baseline/만료 쿠키에서는 배포하지 않는다.
- release는 기존 portable rollout 한 곳에서 검사·복구한다. 신규 origin은 모두 추가 검사하고,
  origin 제거는 성공으로 인정하지 않고 수동 폐쇄 검토를 요구한다.
  실패한 deployment도 검사 목록에 유지하며 자동 삭제하지 않는다. 새 주소가 유출되면 복구도 실패 처리한다.
- 정상본 승격·복구 결과를 봉인한다. 실패한 새 릴리스는 복구 후에도 exit1이다.
  cache 저장 실패/runner 종료/호스팅 장애는 자동 정상 표시하지 않는다.
- 기본은 수동; PR 검사와 native read-only check만 가능한 모드도 제공한다.
  범용 호스팅은 기존 adapter 계약을 유지한다. unsupported를 가짜 완료로 표시하지 않는다.

## 작업

1. [x] hosting schema·connect/plan·안전한 generated CI 및 암호화 baseline.
2. [x] native CF Workers/Vercel adapters·경합/rollback/preview 보호; Pages는 수동/custom adapter.
3. [x] 공통 rollout의 origin 추가·제거 거부·CLI release 연결.
4. [x] 기존 웹 마법사·Secret 안내·JSON/명령 다운로드 및 브라우저 검증.
5. [x] SDK 회귀·tarball 실행·types·fresh review 수정·문서·commit·checkpoint.

## 검증

잘못된 client/origin/provider/식별자/secret JSON/기존 CI/약한 baseline/키 변조·만료 쿠키는
변경0. native API에서는 다른 project/분할 Worker 배포/미완전 origin/다른 commit/경합을
거부한다. 실제 child CLI upload receipt, JSON API fixture, 전체 HTTP verify를 연결한다.
추가 preview 노출과 5xx/항상401은 복구; 이 작업 아닌 deployment는 삭제·덮어쓰기하지 않는다.
native account production/OAuth/live GitHub는 별도 canary 없이는 verified라고 표현하지 않는다.

## Rulings

Ruling: host API에 문서화된 atomic compare-and-swap을 가정하지 않는다. 자동 mode는
owner-controlled single workflow와 모든 write 경로의 외부 직렬화 계약 아래 제공한다.
이를 구성하지 못하면 manual mode를 유지한다. 비용: 대시보드 직배포를 병행할 수 없다.
Ruling: D04 중앙 setup document는 바꾸지 않고 공개 hosting JSON을 별도 export한다.
hosting token/CI key/cookie는 JSON·중앙 DB·browser storage에 저장하지 않는다.
Ruling: 동적 preview origin은 고정 집합보다 검사 범위를 넓혀 처리한다. 제거를 HTTP404만으로
closed라 추정하지 않고 제거 자체를 거부한다. provider-scoped 자동 폐쇄는 이번 설치 기능에서 제외한다. opaque custom adapters도 알려진 origin을 임의로 빼지 못한다.


## 실제 구현 결과와 범위 차이

- 구현: 마법사·hosting JSON·GET inventory·private 정상본·native Workers/Vercel adapter 자동 생성·CI encrypted cache restore/save.
- 신규 deployment origin은 모두 검사하며 제거는 거부한다. 자동 삭제 기능은 제공하지 않는다. 정상 alias 복구 후 candidate 주소가 유출되면 recovery 실패다.
- Pages native 쓰기와 provider-scoped 자동 폐쇄/삭제는 제외했다. Pages 및 다른 호스팅은 수동 검사 또는 reviewed custom adapter를 사용한다. 이 설치 마법사 작업에서 플랫폼 삭제를 묵시적으로 활성화하지 않는다.
- 초기 검사 템플릿 단계는 17074fc 및443ed0a로 고정했다. 후속 native 구현의 증거는 audit2026-10-01-hosting-connections.md를 따른다.
- 실제 계정 권한·GitHub CI·OAuth·canary·npm publish·AUTH/소비 사이트 배포는 미실시다. fixture 및 로컬 브라우저 검증은 운영 증거가 아니다.
- 상용 전체 T11/T12 성능·운영 수용 한계는 이 작업으로 해소하지 않았다.
