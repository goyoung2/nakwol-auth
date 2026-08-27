# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.8.0`
- Schema version: `3`
- Identity source: NAKWOL AUTH `/me`
- Release record: `docs/releases/2026-08-27-nakwol-data-v0.8.md`

## Local

```bash
npm install
npm test
npm run typecheck
npm run bundle
npm run migrate:local
npm run dev
```

## Authentication

```http
Authorization: Bearer <token>
X-NAKWOL-CLIENT-ID: my-app
```

브라우저 `Origin`은 DATA가 AUTH `/me` 호출에 전달하므로 등록되지 않은 앱 Origin은 AUTH에서 거부됩니다. 게임 데이터 endpoint는 `data_application_scopes`에 명시적 scope가 없으면 기본 거부됩니다.

## Foundation endpoints

- `GET /api/health`, `GET /api/schema`, `GET /v1/me`
- `GET/POST /v1/game-accounts`
- `GET /v1/registry/summary`
- `GET /v1/registry/generals`, `/tactics`, `/equipment`, `/equipment-traits`, `/stats`, `/formations`, `/warbooks`

## v0.4 owned generals

- `GET /v1/game-accounts/:accountId/roster/generals` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`

`PUT`은 한 장수의 현재 상태를 멱등적으로 저장합니다. `breakthrough`는 0~5, `promotion`은 0 이상의 정수입니다. 활성화된 Registry 장수만 새 보유 자산으로 등록할 수 있습니다.

## v0.5 owned tactics

- `GET /v1/game-accounts/:accountId/roster/tactics` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`

전법 돌파는 0~5 정수입니다. 새 보유 자산은 authoritative Registry에서 실제 전법 보유 아이템과 연결되는 정식 레코드만 허용합니다. 현재 판정은 `enabled=1`, `class=5`, `learn=1`, `get=3`, `copy=0`, `chip>0`을 만족하고 어떤 장수의 `unique_tactic_id`로도 참조되지 않아야 합니다. 현 Seed에서는 이 조건을 만족하는 전법이 146개이며 chip도 146개 모두 1:1로 유일합니다.

## v0.6 equipment instances

- `GET /v1/game-accounts/:accountId/equipment` — `equipment:read`
- `POST /v1/game-accounts/:accountId/equipment` — `equipment:write`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`

장비 ID는 DATA가 `eqp_...` 형태로 생성합니다. `template_id`는 생성 후 변경할 수 없고, `nickname`, `locked`, `favorite`는 수정 가능합니다. 모든 읽기·수정·삭제는 AUTH가 확인한 사용자가 소유한 game account 내부로 제한됩니다.

## v0.7 live decks and immutable snapshots

- `GET/POST /v1/game-accounts/:accountId/decks`
- `GET/PATCH/DELETE /v1/game-accounts/:accountId/decks/:deckId`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition`
- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots`
- `GET /v1/deck-snapshots`
- `GET /v1/deck-snapshots/:snapshotId`

구성 PUT은 1~3번 장수 위치와 각 장수의 1~2번 전법 슬롯, 같은 game account의 무기·탈것 인스턴스를 전체 교체합니다. 모든 참조를 먼저 검증한 뒤 D1 batch로 교체하므로 하나라도 잘못되면 이전 구성이 유지됩니다.

연구/후보덱 설계를 위해 장수·전법을 실제 보유하지 않아도 구성할 수 있습니다. 장수는 활성 Registry, 전법은 v0.5 canonical 장착 전법이어야 합니다. 출처가 확정되지 않은 중복 사용 규칙은 DATA가 임의로 만들지 않습니다.

스냅샷은 `format_version: 1` JSON으로 생성 당시 덱/장수/전법/장비 상태를 동결합니다. live deck을 삭제해도 snapshot은 유지되고 `source_deck_id`만 NULL이 됩니다. v0.7/v0.8 snapshot 조회는 visibility와 무관하게 owner-only입니다.

## v0.8 equipment special-option Registry

Schema 3은 장비 특기/이펙트의 **정체성**과 무기/탈것 **적용 가능 근거**를 분리합니다.

Canonical identity source는 한국 클라이언트 `Data/Scenario2001/equipment.lua`를 한국어 번역과 결합해 만든 frozen artifact입니다.

- source repository: `goyoung2/nslg-warroom`
- source path: `viewer/enemy-decks/gear-catalog.json`
- source blob: `c1f94bc603be73c7498aa7258ba5b68cb8c32536`
- `equipment_skill`: 106개
- `equipment_effect`: 74개
- unresolved localization: 0개
- stable IDs: `ets:<native_id>`, `ete:<native_id>`

Registry 조회:

- `GET /v1/registry/equipment-traits` — `equipment:read`

각 항목은 `canonical`/`observed`/`unresolved` evidence state와 weapon/mount applicability evidence를 분리해서 반환합니다. runtime 전투 리포트에서 관측됐다는 이유만으로 가능한 조합 전체를 확정하지 않습니다.

## v0.8 evidence-gated trait mutation

`POST`/`PATCH` equipment 요청에서 `traits`를 사용할 수 있습니다.

```json
{
  "traits": [
    { "slot": 1, "trait_id": "ets:56" },
    { "slot": 2, "trait_id": "ete:54" }
  ]
}
```

규칙:

- 최대 2개, slot은 1 또는 2이며 중복 slot은 금지합니다.
- 같은 trait ID가 두 슬롯에 들어가는 것은 authoritative 금지 규칙이 없어 DATA가 임의로 차단하지 않습니다.
- trait identity가 enabled + `canonical`이어야 합니다.
- 대상 장비 종류(`weapon`/`mount`)에 대한 applicability도 `canonical`이어야 실제 저장할 수 있습니다.
- 모든 trait을 먼저 검증한 후 D1 batch로 전체 교체합니다.
- PATCH에서 `traits` 생략은 기존 값 유지, `traits: []`는 전체 제거입니다.
- 장비 조회 응답과 deck snapshot에는 trait ID/kind/name/description이 포함됩니다.

초기 v0.8 supplement에는 **canonical applicability가 0개**입니다. 이는 API가 잘못된 조합을 허용하지 않도록 의도적으로 닫아 둔 상태입니다. 별도 authoritative 근거가 추가되어 applicability가 canonical로 승격되기 전까지 production trait mutation은 `EQUIPMENT_TRAIT_UNVERIFIED_FOR_TYPE`으로 거부됩니다.

기본 능력치 옵션은 아직 열지 않습니다. `game_stat_types` 281개는 일반 게임 속성 사전이며 장비 옵션 전용 사전이 아니므로 `stats` 입력은 계속 `EQUIPMENT_OPTIONS_UNSUPPORTED`입니다.

## v0.8 snapshot extension

v0.8 snapshot은 기존 장비 상태에 더해 생성 당시 장비 trait의 다음 값을 JSON에 동결합니다.

- slot
- trait ID
- kind (`skill`/`effect`)
- name
- description

이후 live 장비 trait 변경이나 Registry 이름/설명 변경이 있어도 기존 snapshot JSON은 다시 계산하지 않습니다.

## Deferred

- 281개 generic stat에서 실제 장비 기본 능력치 옵션 subset/수치 범위 확정
- weapon/mount canonical applicability 보강
- 승품 재료 Registry
- `deck_settings` 진형/병서 모델
- cross-user snapshot 공유와 snapshot 수정/삭제
