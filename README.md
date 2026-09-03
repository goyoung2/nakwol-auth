# NAKWOL Platform Core

낙월(落月) 서비스들이 **로그인과 공통 게임 데이터를 같은 방식으로 재사용**할 수 있도록 만든 중앙 플랫폼입니다.

새 서비스에서 Discord OAuth를 다시 구현하거나 각 프로젝트마다 별도 로그인 체계를 만들 필요 없이, **NAKWOL AUTH + NAKWOL Connect**를 붙여 사용합니다.

- **NAKWOL AUTH** — Discord 기반 중앙 로그인/SSO, 앱별 access token, `/me`, Account Center
- **NAKWOL Connect** — 새 프로젝트에 AUTH/DATA를 연결하는 공식 CLI 및 브라우저 integration layer
- **NAKWOL DATA** — 장수·전법·장비·덱 등 낙월 서비스가 공유하는 사용자 게임 데이터

## NAKWOL Connect로 새 서비스 연결하기

가장 쉬운 시작점은 공개 안내 페이지입니다.

**https://nakwol-auth.sepsd21.workers.dev/connect**

NAKWOL Connect CLI의 실제 npm 패키지명은 **`nakwol-connect`**이며 현재 배포 버전은 **0.4.0**입니다.

프로젝트 루트에서 다음처럼 직접 실행합니다.

```bash
npx --yes nakwol-connect init
npx --yes nakwol-connect doctor --json
```

DATA도 함께 쓰는 경우 필요한 scope만 선언합니다.

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

### 코딩 에이전트에게 그대로 줄 지시문

```text
이 프로젝트에 NAKWOL Connect 로그인을 붙여줘.
NAKWOL Connect의 공식 CLI는 npm 패키지 `nakwol-connect`이고,
프로젝트 루트에서 `npx --yes nakwol-connect ...` 형태로 실행한다.
Discord OAuth를 직접 구현하지 말고 이 CLI가 생성·관리하는 AUTH 연동을 사용해.
현재 서비스의 실제 production URL을 callback으로 등록하고 로그인/로그아웃/현재 사용자 표시까지 연결해.
브라우저 코드나 저장소에는 Discord Client Secret, Cloudflare secret, Connect CLI token을 넣지 마.
작업이 끝나면 `npx --yes nakwol-connect doctor --json`이 통과하는지 검증해.
CLI 사용법이나 현재 DATA 계약이 더 필요하면 `npx --yes nakwol-connect --help`와
`npx --yes nakwol-connect data describe --json`을 먼저 확인해.
```

이렇게 적어두면 코딩 에이전트가 `공식 CLI`라는 표현만 보고 별도 도구를 추측할 필요가 없습니다. **패키지 식별자, 실행 방법, 검증 명령**이 지시문 자체에 모두 들어 있습니다.

## 현재 구성

### NAKWOL AUTH

- 현재 production runtime: **AUTH 0.2.0**
- formal component release/tag: **`auth-v0.2.0` — released 2026-08-31**
- origin: `https://nakwol-auth.sepsd21.workers.dev`
- Discord OAuth, NAKWOL ID, membership, Authorization Code + PKCE(S256), 앱별 access token, `/me`, SSO, Web SDK를 담당합니다.
- `/account`: 일반 사용자의 NAKWOL Account Center
- `/lab`: 권한이 있는 운영자/개발자를 위한 Auth Lab
- Web SDK v0.2.0은 Compact Identity Menu를 제공합니다.

### NAKWOL Connect

- 현재 CLI/distribution: **Connect 0.4.0**
- npm package: **`nakwol-connect@0.4.0`**
- 앱 등록/재사용, callback 등록, AUTH/DATA 자동 연동, doctor, DATA OpenAPI discovery를 담당합니다.
- 최초 한 번은 브라우저에서 device authorization 승인이 필요할 수 있습니다.

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

## 보안 경계

- 외부 서비스는 Discord Client Secret을 보유하지 않습니다.
- Connect CLI token은 브라우저 코드나 프로젝트 저장소에 넣지 않습니다.
- 앱은 AUTH/DATA 공개 API와 SDK만 사용하며 D1에 직접 접근하지 않습니다.
- AUTH D1과 DATA D1은 분리합니다.
- DATA scope는 필요한 권한만 최소로 요청합니다.
- 게임 규칙이나 장비 적용 가능성을 근거 없이 추론하지 않습니다.

상세 인증 계약은 [WEB_SDK.md](./WEB_SDK.md), DATA 구조는 [DATA.md](./DATA.md), Connect 운영은 [CONNECT.md](./CONNECT.md)를 참고합니다.