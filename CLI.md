# NAKWOL Connect CLI v0.2.0

NAKWOL Connect CLI는 사람이 OAuth 코드를 직접 넣는 도구가 아니라 **코딩 LLM/에이전트가 프로젝트를 분석하고 NAKWOL 로그인 연동을 끝까지 수행하게 하는 설치기**입니다.

## LLM에게 시킬 말

새 프로젝트에서 다음 정도면 충분합니다.

```text
이 프로젝트에 NAKWOL Connect를 붙여줘.
아래 명령을 실행하고 프로젝트 분석, 앱 등록, 코드 수정, doctor 검증까지 끝까지 수행해.
파일 위치를 나에게 묻지 말고 프로젝트 구조를 직접 분석해.

npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

첫 사용이거나 CLI 세션이 만료됐으면 CLI가 브라우저 승인 URL과 8자리 코드를 표시합니다. 사람은 그 URL에서 **NAKWOL 로그인 → 이 CLI 허용**만 누르면 됩니다. CLI는 승인되는 동안 계속 poll하고, 승인 후 나머지 작업을 자동으로 진행합니다.

## 누가 앱을 등록하는가

앱 등록은 Cloudflare 대시보드가 아니라 **NAKWOL AUTH Worker의 Connect Control Plane API**가 수행합니다.

```text
Coding LLM
  ↓
NAKWOL Connect CLI
  ↓ HTTPS
nakwol-auth Worker
  ↓
D1 applications / application_settings
```

따라서 LLM은 D1 schema, Cloudflare 계정, Discord Client Secret을 알 필요가 없습니다.

## 개발자 권한

- `owner`: Connect 전체 운영
- `operator`: Connect 전체 운영
- `developer`: CLI 사용 + 자신이 만든 앱만 관리
- Discord `admin`: 전체 운영 권한과 동등

`developer`는 현재 낙월 맹원인 동안만 CLI를 사용할 수 있습니다. 맹원 상태를 잃으면 CLI token이 남아 있어도 서버에서 권한을 거부합니다.

운영자는 다음 화면에서 developer 권한을 관리합니다.

```text
https://nakwol-auth.sepsd21.workers.dev/admin/developers
```

기존 앱 관리 화면은 그대로입니다.

```text
https://nakwol-auth.sepsd21.workers.dev/admin/apps
```

## 명령

### `init`

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

수행 순서:

1. 저장소 루트 탐색
2. 프레임워크 감지
3. 기존 `.nakwol-connect.json` 확인
4. 필요 시 device authorization
5. 중앙 앱 생성 또는 기존 앱 조회
6. Redirect URI 등록
7. 안전한 위치에 Connect loader 자동 삽입
8. `.nakwol-connect.json` 저장
9. `doctor` 수준의 로컬 검증

기본 접근 정책은 `member`입니다.

### Production URL 지정

CLI는 production URL을 추측하지 않습니다.

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init \
  --url https://battle-map.pages.dev/
```

또는 이미 초기화된 프로젝트에서:

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz add-url \
  https://battle-map.pages.dev/
```

### `login`

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz login
```

브라우저 승인형 CLI 세션을 만듭니다. Cloudflare API Token이나 Discord Secret을 입력하지 않습니다.

### `status`

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz status
```

현재 프로젝트의 client ID/framework/원격 앱 상태를 확인합니다.

### `doctor`

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz doctor
```

다음을 검사합니다.

- `.nakwol-connect.json`
- 설치 대상 파일
- `/connect/v1.js`
- 해당 Client ID
- 해당 redirect URI
- NAKWOL AUTH origin

### `sync`

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz sync
```

현재 프로젝트 설정과 중앙 앱 설정을 동기화합니다.

### `remove`

로컬 연동만 제거:

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz remove
```

원격 앱도 disabled 처리:

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz remove --remote
```

## 자동 감지

현재 자동 감지 대상:

- Next.js App Router
- Next.js Pages Router
- SvelteKit
- Vue + Vite
- React + Vite
- Create React App
- generic Vite
- 일반 HTML

일반 HTML/Vite/React/Vue는 `index.html`, CRA는 `public/index.html`, SvelteKit은 `src/app.html`을 수정합니다.

Next.js는 안전하게 `<body>` 위치를 판별할 수 있을 때 `next/script`를 삽입합니다. 자동 수정이 안전하지 않으면 `PATCH_UNSAFE`와 수정 힌트를 반환하므로 코딩 LLM이 직접 수정한 뒤 `doctor`를 다시 실행하면 됩니다.

## 로컬 상태

프로젝트에는 비밀이 없는 파일만 생성됩니다.

```text
.nakwol-connect.json
```

예:

```json
{
  "version": 1,
  "clientId": "battle-map",
  "framework": "react",
  "redirectUris": ["http://localhost:5173/"],
  "integration": "universal-embed"
}
```

CLI bearer token은 프로젝트 밖에 저장됩니다.

```text
~/.nakwol/connect/session.json
```

가능한 플랫폼에서는 파일 권한을 현재 사용자만 읽도록 제한합니다.

## Agent/Machine endpoints

새 프로젝트용 contract:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/agent
```

등록된 앱용 contract:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/agent/{client_id}
```

LLM discovery:

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
```

CLI manifest:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
```

## 보안 경계

- Cloudflare API Token은 CLI/LLM에 제공하지 않음
- Discord Client Secret은 중앙 Worker에만 존재
- device code와 CLI token은 D1에 SHA-256 hash만 저장
- device 승인은 10분 안에 한 번만 소비 가능
- CLI token은 30일 만료
- developer 권한 해제 시 발급된 CLI token도 revoke
- project config에는 credential을 기록하지 않음
- production URL은 자동 추측하지 않음
