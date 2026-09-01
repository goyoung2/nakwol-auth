# NAKWOL Platform Core

낙월(落月) 서비스들의 중앙 인증·SSO와 공통 게임 데이터 기반입니다. AUTH와 DATA는 같은 저장소에서 계약을 함께 관리하지만 Worker, D1, migration, deployment lifecycle은 분리합니다.

## 현재 구성

### NAKWOL AUTH

- 현재 production runtime: **AUTH 0.2.0**
- formal component release/tag: **`auth-v0.2.0` — released 2026-08-31**
- formal release target stable SHA: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- final AUTH v0.2 deploy workflow: `33373705515` — success
- final AUTH v0.2 Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- final production smoke workflow: `33373908231` — success
- initial AUTH 0.2 production baseline remains historical evidence: stable `2ea002dca18cbb064be089167326cd311b315dd5`, deploy `33350989974`, Worker Version `f6160a7a-e886-4d3b-a7fe-cb63c1bfc5a4`, combined smoke `33351486056`
- origin: `https://nakwol-auth.sepsd21.workers.dev`
- Discord OAuth, NAKWOL ID, membership, Authorization Code + PKCE(S256), 앱별 access token, `/me`, SSO, Web SDK를 담당합니다.
- Web SDK v0.1.0 pinned URL은 immutable로 유지됩니다.
- Web SDK v0.2.0은 Compact Identity Menu를 추가합니다.
- `/account`: 일반 사용자의 NAKWOL Account Center
- `/lab`: 권한이 있는 운영자/개발자를 위한 안전한 Auth Lab
- Auth Lab **V1–V12 release matrix는 completed** 상태이며, V8-B 실제 Discord 역할 변경만 외부 역할관리 권한 의존 항목으로 release **waiver**가 승인되었습니다. V8-A는 fresh membership refresh와 접근정책 변화를 자동 검증합니다.
- `auth-v0.2.0` formal release 이후 `ops/release.json`은 다시 disabled neutral 상태로 disarm되었습니다.

### NAKWOL Connect

- 현재 CLI/distribution: **Connect 0.4.0**
- `nakwol-connect@0.4.0`은 npm에 게시된 상태입니다.
- 앱 등록, AUTH/DATA 자동 연동, doctor, DATA OpenAPI discovery를 담당합니다.

```bash
npx nakwol-connect init
npx nakwol-connect doctor --json
npx nakwol-connect data describe --json
```

### NAKWOL DATA

- 현재 production runtime: **DATA 0.9.0**
- schema **3**
- origin: `https://nakwol-data.sepsd21.workers.dev`
- OpenAPI 3.1 discovery: `/openapi.json`
- 사용자 영구 자산(장수/전법/장비), 덱/스냅샷 및 Registry를 담당합니다.
- DATA는 NAKWOL AUTH `/me`로 caller identity를 검증하며 AUTH D1을 직접 읽지 않습니다.

DATA scopes:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

## 현재 repository 상태

AUTH v0.2.0 release 후 release-control cleanup과 back-propagation까지 완료되었습니다.

- `stable`: `5fa4a0365462519089ddeae1d49ff2de3c5d4452`
- `main`: `598c05f371f328494c565a7f7d463ef09271320f`
- `dev`: `4c4337a2ef8146b34f579d12773bf43c33464401`
- 세 long-lived branch의 현재 tree SHA: `444fd9a5ec963d5970d560de90e3782314881fe7`

커밋 SHA는 squash/promotion history 때문에 다르지만 현재 파일 트리는 동일합니다. 새 작업은 기본 브랜치 `dev`에서 `feature/*`, `fix/*`, `chore/*`, `docs/*` 브랜치를 만들어 진행합니다.

## 다음 제품 작업

AUTH v0.2.0 자체의 release blocker는 없습니다. 다음 제품 단계는 별도 작업으로 **`siege-calculator` Identity Menu / seamless SSO 연동**을 진행하는 것입니다. Account Center에서 새 탭으로 서비스를 열었을 때 목적지 앱의 `sessionStorage` token이 없는 경우 목적지 앱 PKCE를 자동 시작하고 기존 중앙 AUTH session을 재사용하는 흐름이 후속 UX 범위입니다.

## 경계 원칙

- 앱은 AUTH/DATA 공개 API와 SDK만 사용하며 D1에 직접 접근하지 않습니다.
- AUTH D1과 DATA D1은 분리합니다.
- AUTH는 DATA scope를 추측하거나 복제하지 않습니다.
- DATA Registry reseed는 UPSERT 중심이며 사용자 소유 데이터를 DELETE/TRUNCATE하지 않습니다.
- 게임 규칙이나 장비 적용 가능성을 근거 없이 추론하지 않습니다.
- production smoke는 D1 read-only 조회와 HTTP/패키지 실행 검증만 수행하며 테스트용 device request를 production에 생성하지 않습니다.

상세 인증 계약은 [WEB_SDK.md](./WEB_SDK.md), DATA 구조는 [DATA.md](./DATA.md), Connect 운영은 [CONNECT.md](./CONNECT.md)를 참고합니다. 오래된 개별 문서의 버전 표기가 이 README 또는 실제 package/CI/production evidence와 충돌하면 현재 package/CI/production evidence를 우선 확인합니다.
