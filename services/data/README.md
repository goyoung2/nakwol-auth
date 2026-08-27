# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.6.0`
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

`PUT` 예시:

```json
{
  "breakthrough": 5,
  "favorite": true,
  "note": "주력"
}
```

전법 돌파는 0~5 정수입니다. 새 보유 자산은 authoritative Registry에서 실제 전법 보유 아이템과 연결되는 정식 레코드만 허용합니다. 현재 판정은 `enabled=1`, `class=5`, `learn=1`, `get=3`, `copy=0`, `chip>0`을 만족하고 어떤 장수의 `unique_tactic_id`로도 참조되지 않아야 합니다. 현 Seed에서는 이 조건을 만족하는 전법이 146개이며 chip도 146개 모두 1:1로 유일합니다.

## v0.6 equipment instances

- `GET /v1/game-accounts/:accountId/equipment` — `equipment:read`
- `POST /v1/game-accounts/:accountId/equipment` — `equipment:write`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`

생성 시 `template_id`, 선택적 `nickname`, `locked`, `favorite`를 저장합니다. 장비 ID는 DATA가 `eqp_...` 형태로 생성하고, 생성된 인스턴스의 `template_id`는 변경할 수 없습니다. 모든 읽기·수정·삭제는 AUTH가 확인한 사용자가 소유한 game account 내부로 제한됩니다.

```json
{
  "template_id": "w:10001",
  "nickname": "주력 무기",
  "locked": true,
  "favorite": true
}
```

현재 확정 Registry에는 무기 97개와 탈것 37개의 템플릿은 있지만, 장비별 허용 옵션/특기 전체 매핑은 없습니다. 따라서 `stats` 또는 `traits`를 생성·수정 요청에 포함하면 `EQUIPMENT_OPTIONS_UNSUPPORTED`로 명시적으로 거부합니다. 확정 자료가 생기기 전까지 281개 스탯 전체를 장비 옵션으로 간주하지 않습니다.

장수·전법·장비 API 모두 AUTH가 확인한 사용자가 실제 소유한 game account만 읽고 쓸 수 있습니다.
