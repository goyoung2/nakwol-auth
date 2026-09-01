# NAKWOL Connect CLI v0.4

NAKWOL Connect CLI는 코딩 에이전트가 NAKWOL AUTH와 NAKWOL DATA를 한 번에 프로젝트에 연결하고, 현재 DATA API 계약까지 자동 발견하는 공식 도구입니다.

## LLM에게 시키는 말

```text
이 프로젝트에 NAKWOL Connect 붙여줘.
장수/전법 데이터가 필요하니 roster:read도 사용해.
공식 CLI로 설치하고 data describe --json으로 현재 DATA API를 읽은 뒤 doctor --json까지 통과시켜.
브라우저 구현은 가능하면 high-level data.accounts / data.roster / data.equipment / data.decks / data.snapshots helper를 사용하고, helper가 없는 경우에만 data.request()를 사용해.
```

에이전트가 실행할 명령:

```bash
npx --yes nakwol-connect init --scopes roster:read
npx --yes nakwol-connect data describe --json
npx --yes nakwol-connect doctor --json
```

최초 한 번은 브라우저에서 짧은 device authorization 승인이 필요할 수 있습니다. 그 이후에는 AUTH 앱 등록/재사용, DATA scope 등록, 프로젝트 코드 설치, `.nakwol-connect.json` 작성, 검증이 자동입니다. `data describe` 자체는 공개 OpenAPI를 읽으므로 device 승인이 필요 없습니다.

## DATA scope

```text
profile:read profile:write
roster:read roster:write
equipment:read equipment:write
decks:read decks:write
```

```bash
nakwol-connect data describe --json
nakwol-connect data status
nakwol-connect data set roster:read,decks:read
nakwol-connect data add equipment:read
nakwol-connect data remove decks:read
```

## 프로젝트 상태

v0.4도 비밀값이 없는 config version 2를 그대로 씁니다.

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

## OpenAPI discovery

NAKWOL DATA는 현재 앱 API를 `GET /openapi.json`에서 OpenAPI 3.1로 공개합니다. 보호된 operation에는 필요한 `x-nakwol-scope`가 들어 있습니다. 코딩 에이전트는 이 문서를 먼저 읽고 그 문서에 있는 path/method/request shape만 사용해야 합니다.

```bash
npx --yes nakwol-connect data describe --json
```

## 브라우저 코드

```js
const data = window.NAKWOL_CONNECT.data;
const contract = await data.describe();
const generals = await data.registry.generals();
const accounts = await data.accounts.list();
const decks = await data.decks.list(accountId);
```

High-level helper namespace:

```text
data.accounts.list/create
data.roster.generals.list/upsert/remove
data.roster.tactics.list/upsert/remove
data.equipment.list/create/update/remove
data.decks.list/get/create/update/replaceComposition/remove
data.snapshots.list/get/create
data.registry.summary/generals/tactics/equipment/equipmentTraits/stats/formations/warbooks
```

예:

```js
const deck = await data.decks.get(accountId, deckId);

await data.decks.update(accountId, deckId, {
  name: '연무대회 연구덱',
});
```

helper는 기존 DATA API의 `{ ok, data }` envelope와 `NakwolDataError`의 `code/status/payload`를 숨기지 않습니다. ID는 URL encoding되고 JSON write header/body는 runtime이 구성합니다. 현재 server에 없는 game-account update/delete는 SDK도 만들지 않습니다.

기존 low-level 호출은 계속 유효합니다.

```js
const custom = await data.request('/v1/game-accounts');
```

보호된 DATA 호출은 현재 앱 access token과 client ID를 자동으로 붙입니다. `data.describe()` / `data.openapi()`는 공개 discovery라 로그인 전에도 사용할 수 있습니다. CLI token, Discord secret, Cloudflare token은 브라우저나 프로젝트에 들어가지 않습니다. `data.hasScope()`는 UI용 hint이며 실제 권한은 DATA Worker가 판정합니다.

## doctor

`doctor --json`은 로컬 marker/config, AUTH 앱/redirect, DATA 앱 등록/scope뿐 아니라 DATA OpenAPI 3.1과 로컬 scope 선언까지 비교합니다. desired state와 다르면 `ok:false`와 non-zero exit로 종료합니다.

## 배포

npm 패키지는 Trusted Publishing OIDC로 배포합니다. 공개 패키지와 Worker fallback 배포는 항상 같은 버전을 유지합니다.
