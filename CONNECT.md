# NAKWOL Connect v0.3

NAKWOL Connect는 낙월 서비스가 AUTH와 DATA를 공통 방식으로 연결하도록 하는 공식 integration layer입니다.

## 가장 쉬운 방법

코딩 에이전트나 개발자는 OAuth나 DATA 헤더를 직접 구현하지 않습니다.

```bash
# AUTH만
npx --yes nakwol-connect init

# AUTH + DATA
npx --yes nakwol-connect init --scopes roster:read,decks:read

# 항상 검증
npx --yes nakwol-connect doctor --json
```

최초 한 번은 브라우저에서 짧은 device approval이 필요할 수 있습니다. 이후 AUTH 앱 등록/재사용, DATA scope 등록, 프레임워크별 코드 삽입, config 작성, doctor가 자동입니다.

## Universal Embed

CLI가 다음 형식을 자동 관리합니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="deck-lab"
  data-data-origin="https://nakwol-data.sepsd21.workers.dev"
  data-data-scopes="decks:read,roster:read">
</script>
```

인증:

```js
window.NAKWOL_CONNECT.user
window.NAKWOL_CONNECT.login()
```

DATA:

```js
await window.NAKWOL_CONNECT.data.registry.generals();
await window.NAKWOL_CONNECT.data.registry.tactics();
```

DATA client가 사용자 access token과 client ID를 자동으로 붙입니다.

## High-level DATA SDK

일반 앱은 가능하면 `/v1/...` REST path를 직접 조합하지 않고 high-level helper를 사용합니다. helper는 기존 `data.request()`와 같은 `{ ok, data }` 응답 envelope와 `NakwolDataError`를 그대로 반환합니다.

```js
const data = window.NAKWOL_CONNECT.data;

const accounts = await data.accounts.list();
const generals = await data.roster.generals.list(accountId);
const tactics = await data.roster.tactics.list(accountId);
const equipment = await data.equipment.list(accountId);
const decks = await data.decks.list(accountId);
const deck = await data.decks.get(accountId, deckId);
```

쓰기 예:

```js
await data.roster.generals.upsert(accountId, generalId, {
  breakthrough: 5,
  promotion: 3,
  favorite: true,
});

await data.decks.replaceComposition(accountId, deckId, {
  generals: [/* current DATA composition contract */],
});
```

지원 namespace:

```text
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

현재 DATA API에 없는 game-account PATCH/DELETE는 SDK도 제공하지 않습니다. 모든 ID path segment는 SDK가 URL encoding하고, JSON write는 `Content-Type: application/json`을 자동 설정합니다.

기존 low-level API도 호환성 때문에 계속 지원합니다.

```js
await data.request('/v1/game-accounts');
await data.fetch('/v1/game-accounts');
await data.describe();
await data.openapi();
```

## 보안 경계

- Discord Client Secret은 AUTH Worker에만 존재합니다.
- Connect CLI token은 사용자 홈 session에만 있고 브라우저/프로젝트에 들어가지 않습니다.
- DATA scope 관리 시 DATA Worker가 매 요청 AUTH에 앱 owner/operator 권한을 확인합니다.
- AUTH D1과 DATA D1은 서로 직접 접근하지 않습니다.
- runtime DATA 요청은 별도로 AUTH `/me`를 통해 사용자 app token을 검증합니다.
- `data.hasScope()`는 UX hint일 뿐이며 실제 권한 판정은 DATA Worker가 수행합니다.

## 관리 UI

- Apps: `https://nakwol-auth.sepsd21.workers.dev/admin/apps`
- Developers: `https://nakwol-auth.sepsd21.workers.dev/admin/developers`
