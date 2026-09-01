# NAKWOL User Data Platform v1 — Implementation Plan

Status: implementation plan
Date: 2026-09-01
Design: `docs/superpowers/specs/2026-09-01-nakwol-user-data-platform-v1-design.md`
Repository: `goyoung2/nakwol-auth`
Base branch: `dev`

## 1. Goal

현재 production에서 검증된 AUTH + Connect + DATA 기반 위에 다음 세 제품 계층을 만든다.

1. **NAKWOL Data SDK** — REST path를 숨기는 고수준 개발자 API
2. **NAKWOL My Data** — 맹원이 자기 게임 계정/덱/보유 정보를 중앙에서 관리하는 공식 앱
3. **NAKWOL Data UI** — 소비자 서비스가 재사용하는 AccountPicker / DeckPicker / My Data launcher

최종 E2E 목표:

```text
사용자 A
  -> My Data에서 덱 X 생성
  -> 소비자 앱 1에서 DeckPicker로 X 선택
  -> 소비자 앱 2에서도 동일 deck ID X 조회
  -> 앱 2에서 "내 덱 관리" 클릭
  -> My Data가 별도 app-bound token으로 X 수정
  -> 앱 2가 변경 이벤트를 받고 X refresh
```

read-only consumer는 이 전체 흐름에서 `decks:write`를 가질 필요가 없어야 한다.

---

## 2. Non-negotiable boundaries

다음은 구현 중 변경하지 않는다.

- AUTH D1 / DATA D1 분리
- Discord secret은 AUTH에만 존재
- Authorization Code + PKCE(S256)
- exact redirect allowlist
- app-bound access token
- 다른 앱의 `sessionStorage` token 공유 금지
- DATA scope 최소 권한
- Registry reseed는 user data destructive mutation 금지
- pinned AUTH Web SDK v0.1 asset 수정 금지
- existing `data.request()` / OpenAPI discovery compatibility 유지
- Data Lab은 privileged diagnostics surface로 유지하고 My Data와 혼합하지 않음

---

## 3. Current verified baseline

2026-09-01 기준:

- AUTH 0.2.0 production
- Connect 0.4.0 production/npm
- DATA 0.9.0 / schema 3 production
- DATA Lab production CRUD smoke 최종 PASS

수동 E2E에서 실제 확인된 것:

- AUTH + DATA principal verification
- game account C/R
- Registry general/tactic/equipment reads
- general C/R/U/D
- tactic C/R/U/D
- equipment C/R/U/D
- deck C/R/U/D
- deck composition PUT
- cleanup/read-after-delete

이 과정에서 발견한 두 production mismatch는 이미 수정되었다.

- Data Lab canonical tactic selector projection mismatch
- DATA tactic write validator vs Registry storage projection mismatch

따라서 이 계획은 backend CRUD 재작성 계획이 아니다.

---

# Phase 1 — High-level NAKWOL Data SDK

## 4. Objective

현재 개발자가 다음처럼 쓰는 low-level 호출:

```js
await window.NAKWOL_CONNECT.data.request(
  `/v1/game-accounts/${accountId}/decks/${deckId}`
);
```

을 다음 형태로 사용할 수 있게 한다.

```js
await window.NAKWOL_CONNECT.data.decks.get(accountId, deckId);
```

## 5. Expected code surfaces

주요 후보:

- `src/assets/nakwol-connect-v1.js.txt`
- Connect runtime 관련 tests
- `CONNECT.md`
- `CONNECT_CLI.md`
- `packages/connect-cli/README.md`

필요하면 shared helper를 별도 source module로 분리하되 production served asset의 계약은 명확히 검증한다.

## 6. SDK namespace

### Accounts

```js
data.accounts.list()
data.accounts.create(input)
```

현재 server에 account PATCH/DELETE가 없으므로 SDK에 가짜 update/delete를 만들지 않는다.

### Roster generals

```js
data.roster.generals.list(accountId)
data.roster.generals.upsert(accountId, generalId, input)
data.roster.generals.remove(accountId, generalId)
```

### Roster tactics

```js
data.roster.tactics.list(accountId)
data.roster.tactics.upsert(accountId, tacticId, input)
data.roster.tactics.remove(accountId, tacticId)
```

### Equipment

```js
data.equipment.list(accountId)
data.equipment.create(accountId, input)
data.equipment.update(accountId, equipmentId, patch)
data.equipment.remove(accountId, equipmentId)
```

### Decks

```js
data.decks.list(accountId)
data.decks.get(accountId, deckId)
data.decks.create(accountId, input)
data.decks.update(accountId, deckId, patch)
data.decks.replaceComposition(accountId, deckId, composition)
data.decks.remove(accountId, deckId)
```

### Snapshots

```js
data.snapshots.list()
data.snapshots.get(snapshotId)
data.snapshots.create(accountId, deckId, input)
```

### Registry

기존 helper 유지 + 빠진 helper 추가.

```js
data.registry.summary()
data.registry.generals(options)
data.registry.tactics()
data.registry.equipment()
data.registry.equipmentTraits()
data.registry.stats()
data.registry.formations()
data.registry.warbooks()
```

## 7. SDK implementation rules

- 모든 user-owned ID/path segment는 `encodeURIComponent` 처리한다.
- JSON body가 있으면 `Content-Type: application/json`을 SDK가 자동 설정한다.
- existing `NakwolDataError` contract를 유지한다.
- server error `code/status/payload`를 숨기지 않는다.
- SDK가 scope를 client-side에서 보안 판정하지 않는다. `hasScope()`는 UX hint일 뿐이고 server가 최종 권한을 판정한다.
- low-level `request/fetch/openapi/describe`는 계속 유지한다.

## 8. Phase 1 tests

RED 먼저 추가한다.

검증 항목:

- 모든 namespace/method 존재
- 올바른 path/method/body 생성
- URL encoding
- Authorization/client ID는 기존 `dataRequest` 경로를 통해 자동 부착
- error propagation
- Registry helper compatibility
- low-level API compatibility

Phase 1 acceptance:

```text
Data SDK helper tests PASS
Connect tests PASS
root AUTH/Connect tests PASS
Repository Governance PASS
```

---

# Phase 2 — NAKWOL My Data foundation

## 9. Objective

사용자가 DATA Lab이 아닌 공식 사용자 UI에서 자기 데이터를 관리한다.

초기 surface:

```text
https://nakwol-data.sepsd21.workers.dev/my-data
```

전용 app:

```text
client_id = nakwol-my-data
```

## 10. App registration / scope seeding

AUTH 쪽에 전용 app registration migration을 추가한다.

예상 next migration:

```text
migrations/0007_my_data.sql
```

DATA 쪽에 scope seed migration을 추가한다.

예상 next migration:

```text
services/data/migrations/0005_my_data.sql
```

My Data desired scopes:

```text
profile:read
profile:write
roster:read
roster:write
equipment:read
equipment:write
decks:read
decks:write
```

migration은 UPSERT/INSERT OR IGNORE 계열의 non-destructive 형태를 사용한다.

기존 user-owned rows를 delete/truncate하지 않는다.

## 11. My Data route/module

예상 신규 module:

```text
services/data/src/my-data.ts
```

`services/data/src/index.ts`에서 route 등록.

UI는 DATA Lab 코드를 복사해 사용자용으로 변형하는 것이 아니라 별도 제품 surface로 구현한다.

Data Lab은 diagnostics/proof UI다.
My Data는 daily-use product UI다.

## 12. My Data MVP IA

### Header

- NAKWOL identity
- 현재 game account selector
- 계정/로그아웃 진입

### Overview

```text
내 게임 계정
내 장수 N명
내 전법 N개
내 장비 N개
내 덱 N개
```

### Game accounts

MVP:

- list
- create
- select

서버에 PATCH/DELETE가 없으므로 UI에 동작하지 않는 edit/delete를 만들지 않는다.

### Owned generals

- Registry search
- 보유 toggle/add
- breakthrough
- promotion
- favorite
- note
- delete

빠른 bulk entry가 가능해야 한다.

### Owned tactics

- canonical ownable tactics만 보유 등록 대상으로 노출
- search/filter
- breakthrough
- favorite
- note
- delete

### Equipment

- template 선택
- nickname
- locked
- favorite
- current supported traits
- delete

canonical applicability=0인 trait의 unsupported write를 UI가 "가능"처럼 보이지 않게 한다.

### Decks

- list
- create
- rename/metadata patch
- delete
- composition editor

composition editor:

```text
position 1
  general
  tactic 1
  tactic 2
  weapon
  mount

position 2
...

position 3
...
```

## 13. Deck-first onboarding

My Data 첫 화면에서 전체 roster 등록을 강제하지 않는다.

```text
[내 전체 보유 정보 등록]
[먼저 덱 만들기]
```

두 경로를 모두 제공한다.

DeckEditor의 general/tactic selector는 Registry를 직접 사용할 수 있어야 한다.

## 14. My Data tests

자동 검증:

- `/my-data` route 200
- pinned/approved AUTH SDK 사용
- `nakwol-my-data` client ID
- full expected DATA scopes seeded
- raw access token UI/log 미노출
- account/roster/tactics/equipment/decks high-level calls 존재
- empty state
- error state
- mobile/responsive baseline
- no Data Lab admin-only assumptions leaking into My Data

production manual matrix를 별도 작성한다.

예:

```text
M1 login/SSO
M2 account list/create
M3 general add/update/delete
M4 tactic add/update/delete
M5 equipment C/R/U/D
M6 deck create/composition/update/delete
M7 refresh persistence
M8 second tab/session behavior
M9 responsive/basic accessibility
```

---

# Phase 3 — NAKWOL Data UI v1

## 15. Objective

소비자 앱이 자기 picker/editor UI를 매번 만들지 않아도 된다.

최우선은:

1. `AccountPicker`
2. `DeckPicker`
3. `openMyData()`

## 16. Integration shape

Connect runtime이 다음 namespace를 제공하는 것을 목표로 한다.

```js
window.NAKWOL_CONNECT.ui.accountPicker
window.NAKWOL_CONNECT.ui.deckPicker
window.NAKWOL_CONNECT.ui.myData
```

예:

```js
const accountResult = await window.NAKWOL_CONNECT.ui.accountPicker.open();
if (accountResult.status !== 'selected') return;

const deckResult = await window.NAKWOL_CONNECT.ui.deckPicker.open({
  accountId: accountResult.account.id,
});
if (deckResult.status !== 'selected') return;

analyze(deckResult.deck);
```

## 17. UI implementation boundary

Picker는 consumer origin에 shared script/component로 렌더링한다.

초기 v1에서 cross-origin iframe을 기본으로 하지 않는다.

이유:

- consumer의 app-bound token을 그대로 사용 가능
- third-party cookie/iframe auth 문제 회피
- host style/theme integration 용이
- picker는 read-only이므로 consumer scope와 자연스럽게 일치

Write/edit는 My Data로 넘긴다.

## 18. DeckPicker behavior

필수 state:

- loading
- unauthenticated
- no game account
- no decks
- deck list
- selected
- cancelled
- API error
- scope denied

UI action:

```text
[덱 선택]
[내 덱 관리]
[새 덱 만들기]
```

`내 덱 관리` / `새 덱 만들기`는 My Data launcher를 사용한다.

## 19. My Data opener/return protocol

초기 target:

```js
const session = await ui.myData.open({
  section: 'decks',
  accountId,
  mode: 'create'
});

// after validated DATA_CHANGED from My Data
await data.decks.list(accountId);
```

보안:

- opener origin을 임의 string으로 신뢰하지 않는다.
- client ID의 registered redirect/homepage origin과 검증한다.
- `postMessage`는 `*` target origin을 쓰지 않는다.
- raw access token 전달 금지.
- My Data는 자기 `nakwol-my-data` token으로 write한다.

이 프로토콜이 복잡해질 경우 별도 short-lived return nonce를 AUTH/DATA에 저장하는 설계를 검토한다. v1 구현 전에 threat model test를 먼저 작성한다.

## 20. Data UI tests

- DeckPicker only needs read scope
- no hidden write calls
- no token leakage
- cancel is normal result
- empty deck -> My Data launcher
- DATA_CHANGED origin validation
- refresh after return
- two consumer client IDs do not share tokens
- existing Connect identity UI unaffected

---

# Phase 4 — Reference consumer E2E

## 21. Objective

공통 플랫폼은 실제 consumer 두 곳에서 같은 user data를 재사용해봐야 완성으로 본다.

최소 reference flow를 만든다.

Consumer A:

```text
decks:read
DeckPicker -> deck X -> display/analyze
```

Consumer B:

```text
decks:read
DeckPicker -> same deck X
```

검증:

- 동일 NAKWOL user
- 동일 game account
- 동일 `deck.id`
- 동일 current composition

## 22. Cross-service manual matrix

```text
C1 My Data에서 deck X 생성
C2 consumer A 로그인/SSO 후 X 표시
C3 consumer B 로그인/SSO 후 X 표시
C4 B에서 My Data 열어 X 수정
C5 B가 change event 후 refresh
C6 A 새로고침 후 수정된 X 표시
C7 A/B token이 서로 sessionStorage 공유하지 않음
C8 global logout 후 양쪽 app token invalidation
```

---

# Phase 5 — Full My Data UX polish

## 23. Objective

MVP 기능을 "실제로 맹원이 자기 데이터를 관리하기 편한 UI"로 만든다.

우선순위:

- fast roster bulk selection
- search/filter
- mobile use
- deck card summary
- recently used Registry items
- copy/duplicate deck
- clear unsaved-change handling
- optimistic UI는 server truth와 충돌하지 않는 범위에서만 사용

## 24. Potential DATA API additions

실사용에서 필요성이 확인된 뒤 별도 spec으로 추가한다.

후보:

- game account PATCH
- game account DELETE / archive
- deck duplicate endpoint (SDK-side composition copy로 충분한지 먼저 검토)
- snapshot-specific narrower write capability
- public/alliance snapshot read

특히 game account DELETE는 cascade semantics가 크므로 단순 CRUD completeness 목적으로 추가하지 않는다.

---

# Phase 6 — Import pipeline (future)

## 25. Screenshot importer

별도 feature로 진행.

pipeline:

```text
upload
 -> image preprocessing
 -> item recognition
 -> Registry candidate matching
 -> confidence display
 -> user review
 -> confirmed write
```

원칙:

- confidence 낮은 자동 결과를 silent write하지 않는다.
- Registry ID로 최종 canonicalize한다.
- duplicate-safe/idempotent import를 목표로 한다.

## 26. Video importer

스크롤 영상:

```text
frame sampling
 -> duplicate frame/item removal
 -> recognition
 -> consolidated candidate list
 -> user review
```

## 27. Game-native share payload research

OCR 전에 게임이 다음을 제공하는지 조사한다.

- deck share code
- clipboard string
- QR
- deep link
- public battle/deck URL

authoritative structured payload가 있다면 이미지 인식보다 우선한다.

---

# Release / PR strategy

## 28. Keep PRs small

권장 PR 흐름:

### PR A — Data SDK

```text
feature/data-sdk-v1 -> dev
```

runtime helper + tests + docs only.

### PR B — My Data app registration/foundation

```text
feature/my-data-foundation -> dev
```

AUTH/DATA app seed + `/my-data` shell + auth/bootstrap + read overview.

### PR C — My Data CRUD UI

```text
feature/my-data-crud -> dev
```

account/roster/tactics/equipment/decks.

### PR D — Data UI picker

```text
feature/data-ui-picker-v1 -> dev
```

AccountPicker + DeckPicker + launcher.

### PR E — consumer reference E2E

필요하면 consumer repo별 별도 PR.

각 feature는 정상 branch governance를 따른다.

```text
feature/* -> dev -> main -> stable
```

## 29. Do not batch unrelated runtime work

User Data Platform 작업에 다음을 섞지 않는다.

- AUTH protocol redesign
- Discord membership redesign
- unrelated Registry expansion
- siege-calculator unrelated feature
- equipment applicability inference
- formal component release descriptor 변경

---

# Verification strategy

## 30. Automated gates

각 단계에서 최소:

Repository root:

```bash
npm test
npm run typecheck
```

DATA:

```bash
cd services/data
npm test
npm run typecheck
npm run bundle
```

PR에서는 Repository Governance와 해당 component verify를 모두 확인한다.

## 31. Production verification

My Data/Data UI는 unit test만으로 완료 처리하지 않는다.

반드시 실제 browser + production DATA D1 E2E를 포함한다.

이 원칙은 DATA Lab 수동 smoke에서 이미 두 production-only mismatch를 발견한 경험을 기준으로 한다.

## 32. Data safety

production test data는:

- 명확한 Lab/test account 사용
- 가능한 row는 cleanup
- user real data destructive cleanup 금지
- snapshot처럼 delete가 없는 데이터는 자동 smoke에서 무분별하게 생성하지 않음

My Data 수동 테스트는 실제 사용자의 의도적 데이터이므로 별도 test cleanup 가정을 두지 않는다.

---

# Definition of Done — User Data Platform v1

다음이 모두 충족되면 v1 product loop가 닫힌 것으로 본다.

- [ ] High-level Data SDK로 current DATA 0.9 user CRUD를 사용할 수 있다.
- [ ] 기존 low-level `data.request()`가 유지된다.
- [ ] `nakwol-my-data` 공식 app/client가 존재한다.
- [ ] My Data에서 game account 선택/생성이 가능하다.
- [ ] My Data에서 general/tactic/equipment/deck 관리가 가능하다.
- [ ] My Data DeckEditor로 composition을 편집할 수 있다.
- [ ] AccountPicker가 consumer에서 재사용된다.
- [ ] DeckPicker가 consumer에서 재사용된다.
- [ ] read-only consumer는 `decks:read`만으로 선택할 수 있다.
- [ ] edit/manage action은 My Data의 own app-bound write token을 사용한다.
- [ ] My Data 변경 후 consumer가 안전하게 refresh할 수 있다.
- [ ] 서로 다른 두 consumer에서 같은 deck ID가 재사용됨을 production E2E로 확인한다.
- [ ] SSO는 재사용하지만 app token isolation은 유지된다.
- [ ] mobile/basic accessibility manual check가 PASS한다.
- [ ] 개발자 문서에 live deck vs snapshot 사용 기준이 명시된다.

---

# First implementation task

이 문서 승인 후 첫 코드 작업은 **Phase 1 High-level Data SDK**로 시작한다.

이유:

- My Data와 Data UI가 모두 같은 SDK를 재사용할 수 있다.
- raw REST 문자열을 My Data UI에 다시 퍼뜨리지 않는다.
- SDK contract를 먼저 고정하면 consumer/My Data 구현이 단순해진다.
- current backend가 이미 production CRUD 검증을 통과했으므로 가장 낮은 위험으로 다음 abstraction layer를 만들 수 있다.

첫 PR의 scope는 SDK wrapper + tests + developer docs로 제한한다.
