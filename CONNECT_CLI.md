# NAKWOL Connect CLI v0.2

NAKWOL Connect CLI는 사람이 OAuth 코드를 직접 붙이지 않고, Codex/Claude Code/Gemini CLI 같은 코딩 에이전트가 프로젝트를 분석해서 NAKWOL AUTH를 설치하도록 만든 공식 도구입니다.

## LLM에게 시키는 말

```text
이 프로젝트에 NAKWOL Connect 붙여줘.
공식 NAKWOL Connect CLI를 사용하고 설치 후 doctor까지 실행해.
```

npm publish 전 현재 명령:

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/package.tgz -- nakwol-connect init
```

설치 확인:

```bash
npm exec --yes --package=https://nakwol-auth.sepsd21.workers.dev/connect/cli/package.tgz -- nakwol-connect doctor --json
```

npm에 `@nakwol/connect`를 publish한 뒤에는 같은 기능을 다음처럼 실행합니다.

```bash
npx @nakwol/connect init
npx @nakwol/connect doctor --json
```

## 최초 인증

로컬 CLI session이 없으면 CLI가 자동으로 device authorization을 시작합니다.

1. CLI가 짧은 승인 코드와 NAKWOL Connect 승인 URL을 출력합니다.
2. 브라우저가 열리면 NAKWOL ID로 로그인합니다.
3. operator 또는 developer 권한을 확인한 뒤 `이 CLI 연결 허용`을 누릅니다.
4. CLI가 자동으로 계속 진행합니다.

CLI token은 사용자 홈의 `~/.nakwol/connect-cli-session.json`에만 저장되며 프로젝트에는 들어가지 않습니다.

## 개발자 권한 관리

운영자 화면:

```text
https://nakwol-auth.sepsd21.workers.dev/admin/developers
```

- `operator`: 모든 Connect 앱/개발자를 관리
- `developer`: 자기 소유 앱만 생성/수정
- 일반 member: 앱 사용만 가능

## 프로젝트에 남는 정보

CLI는 프로젝트 루트에 `.nakwol-connect.json`을 만듭니다.

```json
{
  "version": 1,
  "clientId": "battle-map",
  "framework": "react",
  "redirectUris": ["http://localhost:5173/"],
  "integration": "universal-embed"
}
```

비밀값은 없습니다. 저장소에 commit해도 됩니다.

CLI가 삽입하는 코드는 `NAKWOL-CONNECT:START` / `NAKWOL-CONNECT:END` marker로 감싸져 있어서 `sync`와 `remove`가 자기 코드만 안전하게 관리합니다.

## 명령

```text
init                 프레임워크 감지 → 중앙 앱 등록/재사용 → 프로젝트 설치 → 검증
doctor               로컬/중앙 연결 검사. 실패 시 non-zero exit
status               현재 프로젝트의 로컬/중앙 상태
add-url <URL>        정확한 Redirect URI 추가
sync                 중앙 앱 설정과 로컬 marker/config 동기화
remove               로컬 Connect 코드와 config 제거. 중앙 앱은 보존
```

공통 옵션:

```text
--json
--url <URL>
--name <NAME>
--client-id <ID>
--access-policy <public|member|admin>
--no-open
--auth-origin <URL>
```

개발자는 `public` 또는 `member` 앱을 만들 수 있습니다. `admin` 접근 정책은 operator만 설정할 수 있습니다.

## LLM 발견 경로

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
```

코딩 에이전트는 가능하면 수동 OAuth 구현 대신 공식 CLI를 사용해야 합니다.
