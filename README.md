# NAKWOL Platform Core

낙월(落月) 서비스들의 중앙 인증·SSO와 공통 게임 데이터 기반입니다. AUTH와 DATA는 같은 저장소에서 계약을 함께 관리하지만 Worker, D1, migration, deployment lifecycle은 분리합니다.

## 현재 구성

### NAKWOL AUTH

- 현재 production runtime: **AUTH 0.2.0**
- formal component release/tag: **아직 생성하지 않음 — Auth Lab V1–V12 완료 후 생성**
- deployed stable SHA: `2ea002dca18cbb064be089167326cd311b315dd5`
- origin: `https://nakwol-auth.sepsd21.workers.dev`
- Discord OAuth, NAKWOL ID, membership, Authorization Code + PKCE(S256), 앱별 access token, `/me`, SSO, Web SDK를 담당합니다.
- Web SDK v0.1.0 pinned URL은 immutable로 유지됩니다.
- Web SDK v0.2.0은 Compact Identity Menu를 추가합니다.
- `/account`: 일반 사용자의 NAKWOL Account Center
- `/lab`: 권한이 있는 운영자/개발자를 위한 안전한 Auth Lab
- production deploy와 통합 smoke는 성공했으며, formal `auth-v0.2.0` release는 실제 로그인/SSO/브라우저 V1–V12 검증을 마칠 때까지 보류합니다.

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

## 경계 원칙

- 앱은 AUTH/DATA 공개 API와 SDK만 사용하며 D1에 직접 접근하지 않습니다.
- AUTH D1과 DATA D1은 분리합니다.
- AUTH는 DATA scope를 추측하거나 복제하지 않습니다.
- DATA Registry reseed는 UPSERT 중심이며 사용자 소유 데이터를 DELETE/TRUNCATE하지 않습니다.
- 게임 규칙이나 장비 적용 가능성을 근거 없이 추론하지 않습니다.
- production smoke는 D1 read-only 조회와 HTTP/패키지 실행 검증만 수행하며 테스트용 device request를 production에 생성하지 않습니다.

상세 인증 계약은 [WEB_SDK.md](./WEB_SDK.md), DATA 구조는 [DATA.md](./DATA.md), Connect 운영은 [CONNECT.md](./CONNECT.md)를 참고합니다. 오래된 개별 문서의 버전 표기가 이 README 또는 실제 package/CI/production evidence와 충돌하면 현재 package/CI/production evidence를 우선 확인합니다.
