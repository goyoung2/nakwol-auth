# NAKWOL Connect CLI v0.3

NAKWOL Connect CLI는 코딩 에이전트가 NAKWOL AUTH와 NAKWOL DATA를 한 번에 프로젝트에 연결하는 공식 도구입니다.

## LLM에게 시키는 말

```text
이 프로젝트에 NAKWOL Connect 붙여줘.
장수/전법 데이터가 필요하니 roster:read도 사용해.
공식 CLI로 설치하고 doctor --json까지 통과시켜.
```

에이전트가 실행할 명령:

```bash
npx --yes nakwol-connect init --scopes roster:read
npx --yes nakwol-connect doctor --json
```

최초 한 번은 브라우저에서 짧은 device authorization 승인이 필요할 수 있습니다. 그 이후에는 AUTH 앱 등록/재사용, DATA scope 등록, 프로젝트 코드 설치, `.nakwol-connect.json` 작성, 검증이 자동입니다.

## DATA scope

```text
profile:read profile:write
roster:read roster:write
equipment:read equipment:write
decks:read decks:write
```

```bash
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

## 프로젝트 상태

v0.3은 비밀값이 없는 config version 2를 씁니다.

```json
{
  "version": 2,
  "clientId": "deck-lab",
  "framework": "vite",
  "redirectUris": ["https://deck-lab.pages.dev/"],
  "integration": "universal-embed",
  "dataOrigin": "https://nakwol-data.sepsd21.workers.dev",
  "dataScopes": ["decks:read", "roster:read"]
}
```

version 1 config도 읽을 수 있으며 다음 `init`/`sync`/`data set` 때 v2로 업그레이드됩니다.

## 브라우저 코드

```js
const generals = await window.NAKWOL_CONNECT.data.registry.generals();
const tactics = await window.NAKWOL_CONNECT.data.registry.tactics();
```

DATA client가 현재 앱 access token과 client ID를 자동으로 붙입니다. CLI token, Discord secret, Cloudflare token은 브라우저나 프로젝트에 들어가지 않습니다.

## doctor

`doctor --json`은 로컬 marker/config, AUTH 앱/redirect, DATA 앱 등록/scope를 비교합니다. 셋 중 하나라도 desired state와 다르면 `ok:false`와 non-zero exit로 종료합니다.

## 배포

npm 패키지는 Trusted Publishing OIDC로 배포합니다. 공개 패키지와 Worker fallback 배포는 항상 같은 버전을 유지합니다.
