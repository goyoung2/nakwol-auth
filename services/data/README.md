# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.5.0`
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

장수와 전법 API 모두 AUTH가 확인한 사용자가 실제 소유한 game account만 읽고 쓸 수 있습니다.
