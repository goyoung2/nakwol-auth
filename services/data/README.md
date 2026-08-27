# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.7.0`
- Schema version: `2`
- Identity source: NAKWOL AUTH `/me`

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
- `GET /v1/registry/generals`, `/tactics`, `/equipment`, `/stats`, `/formations`, `/warbooks`

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

생성 시 `template_id`, 선택적 `nickname`, `locked`, `favorite`를 저장합니다. 장비 ID는 DATA가 `eqp_...` 형태로 생성하고, 생성된 인스턴스의 `template_id`는 변경할 수 없습니다. 모든 읽기·수정·삭제는 AUTH가 확인한 사용자가 소유한 game account 내부로 제한됩니다.

현재 확정 Registry에는 무기 97개와 탈것 37개의 템플릿은 있지만, 장비별 허용 옵션/특기 전체 매핑은 없습니다. 따라서 `stats` 또는 `traits`를 생성·수정 요청에 포함하면 `EQUIPMENT_OPTIONS_UNSUPPORTED`로 명시적으로 거부합니다.

## v0.7 live decks

- `GET /v1/game-accounts/:accountId/decks` — `decks:read`
- `POST /v1/game-accounts/:accountId/decks` — `decks:write`
- `GET /v1/game-accounts/:accountId/decks/:deckId` — `decks:read`
- `PATCH /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `DELETE /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition` — `decks:write`

덱 메타데이터는 `name`, 선택적 `season_id`, `status`, `visibility`, `note`, `is_primary`를 저장합니다. `status`는 `active`, `candidate`, `research`, `archived`, `visibility`는 `private`, `alliance`, `public`입니다.

구성 PUT은 1~3번 장수 위치와 각 장수의 1~2번 전법 슬롯, 무기·탈것 인스턴스를 **전체 교체**합니다. 모든 참조를 먼저 검증한 뒤 D1 batch로 교체하므로 하나라도 잘못되면 이전 구성이 유지됩니다.

연구/후보덱 설계를 위해 장수·전법을 실제 보유하지 않아도 구성할 수 있습니다. 단, 장수는 활성 Registry 항목이어야 하고 전법은 v0.5에서 확정한 canonical 장착 전법이어야 합니다. 무기·탈것은 같은 game account가 실제 소유한 장비 인스턴스만 연결할 수 있으며 슬롯 종류도 일치해야 합니다. 중복 장수·전법·장비 금지 같은 출처 미확정 게임 규칙은 DATA가 임의로 만들지 않습니다.

```json
{
  "generals": [
    {
      "position": 1,
      "general_id": "g:10001",
      "weapon_instance_id": "eqp_...",
      "mount_instance_id": null,
      "tactics": [
        { "slot": 1, "tactic_id": "t:20010" },
        { "slot": 2, "tactic_id": "t:20350" }
      ]
    }
  ]
}
```

## v0.7 immutable deck snapshots

- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots` — `decks:write`
- `GET /v1/deck-snapshots` — `decks:read`
- `GET /v1/deck-snapshots/:snapshotId` — `decks:read`

스냅샷 생성 시 기본 공개 메타데이터는 `alliance`이며 `public`도 선택할 수 있습니다. v0.7에서는 두 값 모두 **소유자만 조회 가능**하고 실제 cross-user 공유 endpoint는 열지 않습니다.

스냅샷 JSON은 `format_version: 1`의 불변 값으로 저장하며 생성 당시 다음 정보를 동결합니다.

- 게임 계정 nickname/server
- 덱 이름/status/visibility/note 등 메타데이터
- 장수 Registry ID/이름과 당시 보유 여부, 돌파, 승품
- 무기·탈것 ID/템플릿/이름과 당시 nickname/locked/favorite
- 전법 Registry ID/이름과 당시 보유 여부, 돌파

이후 live deck, Registry 이름, 보유 자산, 돌파/승품, 장비 상태가 바뀌어도 기존 snapshot JSON은 다시 계산하지 않습니다. live deck을 삭제해도 snapshot은 남고 `source_deck_id`만 `NULL`이 됩니다.

## Deferred

`deck_settings`의 진형/병서 모델, 장비 옵션/특기, cross-user snapshot 공유, snapshot 수정/삭제는 authoritative 규칙과 별도 API 설계가 확보될 때까지 v0.7 범위 밖입니다.
