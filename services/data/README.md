# NAKWOL DATA

NAKWOL ID에 귀속되는 삼국지 천하결전 영구 게임 자산과 덱 정보를 관리하는 독립 Cloudflare Worker/D1 서비스입니다.

- Worker: `nakwol-data`
- D1: `nakwol-data`
- Service version: `0.1.0`
- Schema version: `1`
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

브라우저 `Origin`은 DATA가 AUTH `/me` 호출에 전달하므로 등록되지 않은 앱 Origin은 AUTH에서 거부됩니다.

## Foundation endpoints

`GET /api/health`, `GET /api/schema`, `GET /v1/me`, `GET/POST /v1/game-accounts`, `GET /v1/registry/generals`, `GET /v1/registry/tactics`, `GET /v1/registry/equipment`.

게임 데이터 endpoint는 `data_application_scopes`에 명시적 scope가 없으면 기본 거부됩니다.
