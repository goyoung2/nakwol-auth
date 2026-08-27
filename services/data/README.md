# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.4.0`
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

사용자 장수 자산은 기존 schema 2의 `user_generals`를 사용하며 새 migration이 필요하지 않습니다.

- `GET /v1/game-accounts/:accountId/roster/generals` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`

`PUT`은 한 장수의 현재 상태를 멱등적으로 저장합니다. 생략한 값은 `breakthrough=0`, `promotion=0`, `favorite=false`, `note=null`로 취급합니다.

```json
{
  "breakthrough": 5,
  "promotion": 7,
  "favorite": true,
  "note": "주력"
}
```

`breakthrough`는 0~5 정수, `promotion`은 0 이상의 정수입니다. 현재 Registry에서 사용자 노출 대상으로 활성화된 장수만 새 보유 자산으로 등록할 수 있고, 모든 요청은 AUTH 사용자가 실제 소유한 game account에만 접근할 수 있습니다.
