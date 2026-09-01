# NAKWOL User Data Platform v1 — Product & Architecture Specification

Status: direction approved in chat, implementation planning started
Date: 2026-09-01
Repository: `goyoung2/nakwol-auth`
Target base: `dev`

## 1. Purpose

NAKWOL은 이미 다음 기반을 production에서 보유한다.

- NAKWOL AUTH 0.2.0 — Discord OAuth, 중앙 SSO, PKCE, 앱별 access token, `/me`, Account Center, Identity UI
- NAKWOL Connect 0.4.0 — 앱 등록, scope 자동화, Universal Embed, DATA OpenAPI discovery
- NAKWOL DATA 0.9.0 / schema 3 — 게임 계정, Registry, 보유 장수/전법, 장비, 덱, 덱 스냅샷
- DATA Lab — production 사용자 계정으로 실제 DATA CRUD를 수동 E2E 검증하는 운영 도구

2026-09-01 DATA Lab 수동 production smoke에서 장수·전법·장비·덱의 C/R/U/D와 덱 composition PUT이 최종 PASS했다. 이 과정에서 Lab fixture 선택 오류와 production tactic write metadata projection 오류를 실제로 발견하고 수정·재배포했다.

즉 현재 병목은 더 이상 "DATA 저장소가 실제로 작동하는가"가 아니다.

현재 제품 병목은 다음 두 가지다.

1. **사용자(맹원)가 자기 게임 계정/장수/전법/장비/덱을 어디에서 자연스럽게 등록하고 관리하는가.**
2. **각 낙월 서비스 개발자가 그 공통 데이터를 얼마나 간단하고 안전하게 재사용하는가.**

이 문서는 이 문제를 해결하기 위한 NAKWOL User Data Platform v1의 제품/아키텍처 방향을 고정한다.

핵심 원칙은 한 문장이다.

> **사용자는 한 번 등록하고, 모든 낙월 서비스는 같은 데이터를 재사용한다.**

---

## 2. Problem statement

향후 다음과 같은 소비자 서비스가 존재한다고 가정한다.

- 덱 전적 확인 사이트
- 덱 분석 사이트
- 덱 연구/시뮬레이션 사이트
- 전투 리포트 분석기
- 덱 공유/추천 도구
- 공성/연무/전략 계산기

이 서비스들은 공통으로 사용자의 게임 데이터가 필요하다.

나쁜 구조는 각 서비스가 자기 입력 화면과 자기 저장소를 따로 갖는 것이다.

```text
덱 분석기     -> 사용자가 덱 다시 입력
전적 사이트   -> 사용자가 덱 다시 입력
연구 사이트   -> 사용자가 덱 다시 입력
다른 도구     -> 사용자가 또 입력
```

이 구조는 다음 문제를 만든다.

- 같은 사용자가 같은 데이터를 반복 입력한다.
- 서비스마다 데이터 shape이 달라진다.
- 수정 시 여러 서비스에서 다시 수정해야 한다.
- 장수/전법/장비 Registry 정합성이 서비스마다 달라진다.
- 개발자는 인증, 사용자 데이터 UI, CRUD를 매번 다시 구현한다.
- 장기적으로 낙월 서비스 간 데이터 연계 가치가 사라진다.

NAKWOL User Data Platform은 이 문제를 중앙 사용자 데이터 + 공통 SDK + 공통 UI로 해결한다.

---

## 3. Product decision

채택 구조는 세 계층이다.

### 3.1 NAKWOL My Data

사용자가 자신의 게임 데이터를 중앙에서 등록하고 관리하는 공식 사용자 앱.

역할:

- 게임 계정 선택/생성
- 보유 장수 관리
- 보유 전법 관리
- 장비 관리
- 덱 생성/수정/삭제
- 덱 composition 편집
- 향후 screenshot/video/share-code import 진입점

초기 구현은 NAKWOL DATA Worker의 공식 사용자 surface로 제공하는 것을 기본안으로 한다.

가칭 route:

```text
https://nakwol-data.sepsd21.workers.dev/my-data
```

전용 AUTH client를 사용한다.

```text
client_id: nakwol-my-data
```

My Data는 사용자가 자기 데이터를 직접 관리하는 공식 앱이므로 필요한 DATA write scope를 가질 수 있다.

### 3.2 NAKWOL Data SDK

개발자가 URL/path/header를 직접 조립하지 않고 사용자 DATA를 사용하는 고수준 API.

현재 `window.NAKWOL_CONNECT.data.request()`와 Registry helper는 유지한다.

그 위에 다음 형태의 high-level namespace를 추가한다.

```js
nakwol.data.accounts.list()
nakwol.data.accounts.create(input)

nakwol.data.roster.generals.list(accountId)
nakwol.data.roster.generals.upsert(accountId, generalId, input)
nakwol.data.roster.generals.remove(accountId, generalId)

nakwol.data.roster.tactics.list(accountId)
nakwol.data.roster.tactics.upsert(accountId, tacticId, input)
nakwol.data.roster.tactics.remove(accountId, tacticId)

nakwol.data.equipment.list(accountId)
nakwol.data.equipment.create(accountId, input)
nakwol.data.equipment.update(accountId, equipmentId, patch)
nakwol.data.equipment.remove(accountId, equipmentId)

nakwol.data.decks.list(accountId)
nakwol.data.decks.get(accountId, deckId)
nakwol.data.decks.create(accountId, input)
nakwol.data.decks.update(accountId, deckId, patch)
nakwol.data.decks.replaceComposition(accountId, deckId, composition)
nakwol.data.decks.remove(accountId, deckId)

nakwol.data.snapshots.list()
nakwol.data.snapshots.get(snapshotId)
nakwol.data.snapshots.create(accountId, deckId, input)
```

고수준 SDK는 기존 REST/OpenAPI 계약의 wrapper다. 별도의 데이터 모델을 새로 만들지 않는다.

### 3.3 NAKWOL Data UI

각 서비스가 공통으로 가져다 쓸 사용자 데이터 UI 컴포넌트.

초기 핵심 모듈:

- `AccountPicker`
- `DeckPicker`
- `MyDataLink` / `openMyData()`

후속 모듈:

- `GeneralPicker`
- `TacticPicker`
- `EquipmentPicker`
- `DeckEditor` 진입점
- `RosterManager` 진입점

개발자는 두 방식 중 선택할 수 있다.

```text
직접 UI 제작
  -> high-level Data SDK 사용

공통 NAKWOL UI 사용
  -> Data UI Picker/Launcher 사용
```

---

## 4. Target architecture

```text
                         NAKWOL AUTH
                 identity / SSO / app token
                            |
                            v
+-------------------- NAKWOL Connect --------------------+
|                                                        |
|     high-level Data SDK            shared Data UI      |
|                                                        |
+--------------------------+-----------------------------+
                           |
                           v
                      NAKWOL DATA
             Registry + user-owned game data
                           |
                           v
                         D1

           ^                                  ^
           |                                  |
           |                                  |
   NAKWOL My Data                    consumer services
   user-owned writes                 mostly read/use data
                                     - deck analysis
                                     - deck record
                                     - deck research
                                     - battle tools
```

중요한 경계:

- AUTH D1과 DATA D1은 계속 분리한다.
- 소비자 앱은 D1에 직접 접근하지 않는다.
- 소비자 앱은 Discord secret이나 Cloudflare credential을 받지 않는다.
- DATA 호출은 앱별 access token + client ID를 사용한다.
- 사용자의 중앙 데이터 수정 권한을 단순 조회 앱에 불필요하게 주지 않는다.

---

## 5. Actor model

### 5.1 Member / user

사용자는 NAKWOL 계정으로 로그인하고 자기 DATA를 소유한다.

사용자의 관점에서 데이터는 특정 서비스의 데이터가 아니다.

```text
"덱 분석기에 저장한 덱"
```

이 아니라

```text
"내 NAKWOL 덱"
```

이어야 한다.

한 서비스에서 생성하거나 My Data에서 수정한 덱은 다른 허가된 서비스에서도 같은 데이터로 보인다.

### 5.2 Consumer service developer

개발자는 필요한 scope만 선언한다.

예:

```text
덱 분석기
  profile:read
  decks:read

내 장비를 이용한 시뮬레이터
  profile:read
  roster:read
  equipment:read
  decks:read
```

개발자는 인증/token/header/D1을 직접 다루지 않고 Connect/Data SDK를 사용한다.

### 5.3 NAKWOL platform operator

운영자는 다음을 관리한다.

- AUTH app/client
- redirect allowlist
- DATA app scope
- shared SDK/UI release
- Registry seed/evidence
- My Data product surface
- Data Lab production diagnostics

Data Lab은 사용자용 My Data와 분리한다.

---

## 6. User data model and ownership

DATA는 두 종류의 데이터를 구분한다.

### 6.1 Registry

게임 세계의 공통 canonical 데이터.

예:

- 장수
- 전법
- 무기/탈것 template
- 장비 trait identity
- 진형
- 병서
- 스탯 타입

Registry는 사용자가 소유하지 않는다.

### 6.2 User-owned data

NAKWOL 사용자에게 귀속되는 데이터.

```text
NAKWOL user
  -> game account
      -> owned generals
      -> owned tactics
      -> equipment instances
      -> live decks
      -> immutable deck snapshots
```

한 사용자는 여러 게임 계정을 가질 수 있다.

모든 사용자 DATA access는 AUTH principal과 game account ownership을 기준으로 격리한다.

---

## 7. Central user experience — NAKWOL My Data

### 7.1 Standalone entry

사용자가 직접 My Data로 들어와 전체 데이터를 관리할 수 있어야 한다.

예상 구조:

```text
NAKWOL My Data

[게임 계정: 5서버 / 고영 ▼]

내 장수
  37명 등록됨
  [관리]

내 전법
  52개 등록됨
  [관리]

내 장비
  14개 등록됨
  [관리]

내 덱
  주력 1군
  공성덱
  연무덱
  [새 덱]
```

### 7.2 Service-driven entry

사용자는 My Data의 존재를 미리 알 필요가 없다.

덱 분석 사이트에서 처음 NAKWOL 덱을 요구할 때 다음 흐름이 가능해야 한다.

```text
[내 덱 불러오기]
       |
       v
DeckPicker
       |
       +-- 기존 덱 있음 -> 선택 -> 분석
       |
       +-- 덱 없음
             |
             +-- [새 덱 만들기]
                     |
                     v
                 My Data
                     |
                 저장 완료
                     |
                     v
              원 서비스에서 refresh
```

### 7.3 Progressive registration

사용자에게 첫 사용부터 전체 장수/전법/장비 등록을 강제하지 않는다.

지원해야 할 방식:

- 전체 보유 정보를 먼저 등록
- 덱 하나만 먼저 생성
- 서비스를 사용하면서 필요한 데이터만 점진적으로 추가

예:

사용자가 덱 편집 중 Registry 장수/전법을 사용했지만 owned roster에는 아직 없다면, 덱 자체는 현재 DATA 규칙이 허용하는 범위에서 저장할 수 있다.

"내가 보유한 모든 것을 먼저 입력해야 덱을 만들 수 있다"는 UX를 강제하지 않는다.

---

## 8. Shared UI contract

### 8.1 DeckPicker — v1 최우선 공통 UI

소비자 서비스에서 사용자의 live deck을 선택한다.

개발자 목표 API:

```js
const result = await nakwol.ui.deckPicker.open({
  accountId,
});

if (result.status === 'selected') {
  console.log(result.deck);
}
```

반환 예:

```js
{
  status: 'selected',
  deck: {
    id: 'dek_...',
    account_id: 'gac_...',
    name: '주력 1군',
    composition: { ... }
  }
}
```

취소는 예외가 아니라 정상 결과로 취급한다.

```js
{ status: 'cancelled' }
```

### 8.2 AccountPicker

여러 게임 계정이 있는 사용자가 현재 서비스에서 사용할 계정을 선택한다.

```js
const account = await nakwol.ui.accountPicker.open();
```

### 8.3 MyData launcher

Picker에서 데이터가 없거나 사용자가 수정하려 할 때 공식 My Data로 보낸다.

```js
await nakwol.ui.myData.open({
  section: 'decks',
  accountId,
  deckId,
});
```

### 8.4 Read UI와 Write UI의 권한 분리

이 설계의 핵심 보안/제품 결정이다.

단순 덱 분석기는 `decks:read`만 가져야 한다.

그 사이트의 DeckPicker에서 "덱 수정"을 누른다고 해서 소비자 앱에 자동으로 `decks:write`를 부여하지 않는다.

```text
consumer app
  decks:read
     |
     v
DeckPicker
     |
     +-- select -> consumer app
     |
     +-- manage/edit
            |
            v
       NAKWOL My Data
       own official token
       decks:write
```

즉 중앙 write UI는 `nakwol-my-data` client의 권한으로 동작한다.

소비자 앱 token을 My Data로 전달하지 않는다.

### 8.5 Cross-window return

My Data가 새 창/탭으로 열린 경우 저장 후 원 서비스에 변경 사실을 알릴 수 있어야 한다.

권장 초기 방식:

```text
consumer
 -> window.open(My Data)
 -> user edits with My Data's own SSO/app token
 -> My Data postMessage(DATA_CHANGED) to validated opener origin
 -> consumer refreshes DeckPicker/data query
```

`return_origin`/opener origin은 등록된 앱 origin/redirect allowlist와 일치하는지 검증해야 한다.

임의 open redirect를 만들지 않는다.

---

## 9. High-level Data SDK contract

### 9.1 Goals

- REST path 문자열 반복 제거
- HTTP method/body shape 반복 제거
- 일관된 error object
- 필요한 scope를 API 레벨에서 문서화
- coding agent가 쉽게 사용할 수 있는 안정된 namespace 제공
- OpenAPI와 같은 실제 server contract를 source of truth로 유지

### 9.2 Low-level compatibility

다음은 계속 지원한다.

```js
nakwol.data.request(path, options)
nakwol.data.fetch(path, options)
nakwol.data.openapi()
nakwol.data.describe()
```

고수준 SDK는 이를 제거하지 않는다.

### 9.3 Registry helpers

기존 helper를 유지/확장한다.

```js
nakwol.data.registry.summary()
nakwol.data.registry.generals({ includeHidden })
nakwol.data.registry.tactics()
nakwol.data.registry.equipment()
nakwol.data.registry.equipmentTraits()
nakwol.data.registry.formations()
nakwol.data.registry.warbooks()
```

### 9.4 Error contract

고수준 SDK는 server error code를 숨기지 않는다.

예:

```js
try {
  await nakwol.data.decks.get(accountId, deckId);
} catch (error) {
  error.name
  error.code
  error.status
  error.payload
}
```

`SCOPE_DENIED`, `GAME_ACCOUNT_NOT_FOUND`, `TACTIC_NOT_FOUND` 같은 server contract는 호출자가 필요하면 분기할 수 있어야 한다.

---

## 10. Consumer service patterns

### 10.1 Deck analysis site

필요 scope:

```text
profile:read
roster:read (선택)
equipment:read (선택)
decks:read
```

흐름:

```text
login
 -> account select
 -> deck picker
 -> current live deck fetch
 -> analysis
```

분석 결과는 기본적으로 해당 소비자 서비스의 derived data다. 공통 DATA에 무조건 저장하지 않는다.

### 10.2 Deck research site

사용자가 NAKWOL live deck을 불러온 뒤 연구용 변형을 만들 수 있다.

두 모드가 가능하다.

- local draft: 서비스 내부에서만 임시 변형
- save to My Data: 사용자가 명시적으로 자기 NAKWOL deck으로 저장

소비자 앱이 write scope를 갖지 않는다면 저장은 My Data editor로 넘긴다.

### 10.3 Deck record / match history site

과거 전적은 live deck을 그대로 참조하면 안 된다.

사용자가 오늘 live deck을 수정하면 과거 전적의 덱 구성까지 바뀐 것처럼 보이기 때문이다.

따라서 역사적 재현성이 필요한 서비스는 **immutable snapshot**을 사용해야 한다.

```text
live deck
   |
   +-- current analysis -> live deck OK
   |
   +-- match/history record -> immutable snapshot 권장
```

현재 snapshot create는 `decks:write`가 필요하다.

제3자 read-oriented record 서비스에 이 권한이 과도하다고 판단되면 향후 별도 `snapshots:write` 또는 더 세분화된 capability를 설계한다.

v1에서 scope를 무리하게 확장하지 말고 실제 첫 consumer 요구를 확인한 뒤 결정한다.

---

## 11. Data input strategy

게임사가 공식 user-data API를 제공하지 않는 현재 전제에서는 최초 데이터 유입은 사용자 입력이 기본이다.

하지만 "수동 입력"과 "한 항목씩 고통스럽게 입력"은 같은 말이 아니다.

### 11.1 v1 — optimized manual input

My Data에서 다음을 제공한다.

- 검색
- 카드/목록 bulk selection
- favorite/보유 여부 빠른 toggle
- Registry 기반 autocomplete
- 최근 사용 항목
- 덱 편집 중 즉시 선택

### 11.2 v1 — deck-first registration

사용자가 전체 roster를 입력하지 않고 바로 덱을 만들 수 있게 한다.

이는 onboarding 비용을 크게 줄인다.

### 11.3 future — screenshot import

예상 흐름:

```text
게임 장수/전법 화면 screenshot
 -> recognition
 -> canonical Registry matching
 -> 사용자 확인 화면
 -> confirmed rows만 DATA write
```

자동 인식 결과를 곧바로 canonical user data로 저장하지 않는다.

사용자 확인 단계를 둔다.

### 11.4 future — video import

스크롤 영상을 frame sampling/deduplication 후 인식하는 방식.

스크린샷 수십 장보다 입력 비용이 낮아질 가능성이 있다.

### 11.5 future — game share payload

게임이 덱 공유 문자열/URL/QR/clipboard payload를 제공하는지 조사한다.

공식/재현 가능한 payload가 존재하면 OCR보다 우선한다.

---

## 12. Security and permission principles

### 12.1 Minimum scopes

소비자 서비스는 필요한 최소 scope만 가진다.

분석만 하는 서비스에 write scope를 주지 않는다.

### 12.2 App-bound token isolation

각 앱은 자기 access token을 사용한다.

다른 앱의 `sessionStorage` token을 공유하지 않는다.

중앙 SSO session은 재사용할 수 있지만 app token은 새 app의 PKCE flow로 발급한다.

### 12.3 My Data is a separate app identity

My Data는 별도 `nakwol-my-data` client다.

consumer token을 재사용하지 않는다.

### 12.4 No direct D1 access

개발자/브라우저는 D1 credential을 받지 않는다.

### 12.5 Owner isolation

기본 사용자 DATA API는 현재 AUTH principal 소유 데이터만 읽고 쓴다.

cross-user/public sharing은 별도 계약으로 취급한다.

---

## 13. Live data vs snapshot semantics

이 구분은 모든 consumer 개발 문서에서 명시한다.

### Live deck

- 사용자의 현재 편집 상태
- 계속 수정 가능
- 분석기/연구도구의 현재 상태에 적합

### Deck snapshot

- 생성 시점의 불변 JSON
- 이후 live deck/Registry/장비 표시 변화에도 기존 snapshot은 변하지 않음
- 전적/대회 기록/공유 permalink/재현 가능한 분석 결과에 적합

서비스는 용도에 따라 올바른 타입을 선택해야 한다.

---

## 14. Current API gaps relevant to My Data

현재 DATA 0.9.0 기준:

- game account: Create/Read 존재, Update/Delete 없음
- owned generals: C/R/U/D 가능
- owned tactics: C/R/U/D 가능
- equipment: C/R/U/D 가능
- decks: C/R/U/D + composition replace 가능
- snapshots: Create/Read 가능, Update/Delete 없음
- snapshot `alliance/public` visibility metadata는 있으나 현재 조회는 owner-only

My Data v1을 만들기 위해 game account U/D를 즉시 필수로 만들지는 않는다.

MVP에서는 account 생성/선택으로 시작할 수 있다.

계정 삭제는 자식 user data의 파괴 semantics를 포함하므로 별도 destructive-data design 없이 급하게 추가하지 않는다.

---

## 15. Non-goals for v1

다음은 방향상 중요하지만 v1 core blocker가 아니다.

- 게임 클라이언트 자동 scraping/메모리 추출
- screenshot AI importer 완성
- video importer 완성
- public user profile 검색
- 타 사용자 roster 직접 조회
- alliance-wide data browser
- 완성형 공개 덱 공유 플랫폼
- 모든 consumer service의 derived analysis result를 DATA에 저장
- evidence 없는 장비 applicability 추론

먼저 수동 등록 + 중앙 재사용 경험을 완성한다.

---

## 16. Developer experience target

현재:

```js
await window.NAKWOL_CONNECT.data.request(
  `/v1/game-accounts/${accountId}/decks`
);
```

목표:

```js
const { data, ui } = window.NAKWOL_CONNECT;

const account = await ui.accountPicker.open();
const deck = await ui.deckPicker.open({ accountId: account.id });
const roster = await data.roster.generals.list(account.id);
```

개발자가 알아야 하는 것은 다음 정도로 제한한다.

- 어떤 데이터가 필요한가
- read/write 중 무엇이 필요한가
- 어떤 account/deck을 사용할 것인가

개발자가 몰라도 되는 것:

- Discord OAuth 구현
- PKCE 구현 세부
- access token 저장 방식
- Authorization header
- `X-NAKWOL-CLIENT-ID`
- D1 schema/credential
- Registry seed internals

---

## 17. User experience target

첫 사용:

```text
덱 분석 사이트 접속
 -> NAKWOL 로그인
 -> [내 덱 불러오기]
 -> 등록 덱 없음
 -> [새 덱 만들기]
 -> My Data에서 덱 생성
 -> 원 사이트에 변경 통지
 -> 새 덱 자동 refresh/선택
 -> 분석
```

다음 서비스:

```text
덱 전적 사이트 접속
 -> 중앙 SSO 재사용
 -> [내 덱]
 -> 이전에 등록한 같은 덱 즉시 표시
```

사용자가 데이터 플랫폼 자체를 이해하지 않아도 자연스럽게 재사용 경험을 얻는 것이 목표다.

---

## 18. Success criteria

v1 방향이 제품으로 성립했다고 판단하려면 최소 다음이 필요하다.

1. 사용자가 공식 My Data surface에서 게임 계정과 덱을 생성/수정할 수 있다.
2. 소비자 앱이 high-level SDK로 같은 데이터를 읽을 수 있다.
3. 소비자 앱이 공통 DeckPicker를 붙일 수 있다.
4. read-only consumer가 덱 수정 때문에 `decks:write`를 받을 필요가 없다.
5. Picker에서 My Data로 이동해 수정한 뒤 원 consumer가 변경을 감지하고 refresh할 수 있다.
6. 서로 다른 두 consumer 앱에서 동일 사용자의 동일 deck ID/data가 재사용되는 E2E가 검증된다.
7. app-bound token isolation, scope 최소화, exact redirect/origin 검증이 유지된다.
8. 기존 `data.request()`와 OpenAPI discovery가 계속 동작한다.

---

## 19. Product naming / terminology

이 문서에서는 다음 용어를 기준으로 사용한다.

- **NAKWOL DATA** — 중앙 DATA API / D1 / Registry / user-owned data backend
- **NAKWOL My Data** — 사용자가 자기 데이터를 관리하는 공식 앱
- **NAKWOL Data SDK** — 개발자용 high-level DATA wrapper
- **NAKWOL Data UI** — 서비스가 재사용하는 Picker/Launcher UI
- **consumer service/app** — 덱 분석기, 전적 사이트 등 DATA를 사용하는 낙월 앱
- **live deck** — 현재 수정 가능한 사용자 덱
- **deck snapshot** — 시점이 고정된 불변 덱 데이터

---

## 20. Decision summary

NAKWOL DATA의 다음 단계는 더 많은 CRUD endpoint를 무작정 추가하는 것이 아니다.

다음 제품 계층을 완성하는 것이다.

```text
사용자 입력/관리
   NAKWOL My Data
          |
          v
      NAKWOL DATA
          |
          +--------------------------+
          |                          |
          v                          v
   high-level Data SDK         shared Data UI
          |                          |
          +------------+-------------+
                       |
                       v
                 consumer services
```

이 구조를 User Data Platform v1의 공식 방향으로 채택한다.
