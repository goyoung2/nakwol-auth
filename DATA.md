# NAKWOL DATA

NAKWOL DATA는 NAKWOL AUTH와 분리된 게임 데이터 계층입니다. AUTH는 “누구인가/어떤 앱인가”를 판정하고, DATA는 영구 게임 자산·Registry·덱 데이터를 관리합니다.

## Runtime boundary

```text
NAKWOL AUTH Worker/D1
        │  /me + Connect app ownership verification
        ▼
NAKWOL DATA Worker/D1
        ├─ game accounts
        ├─ Game Registry
        ├─ owned generals / tactics
        ├─ equipment / mounts
        └─ decks / snapshots
```

DATA는 AUTH D1에 직접 접근하지 않습니다.

## v0.2 Registry

`nslg-s-season-raw-research-kit-v1`의 확정 카탈로그를 재현 가능한 Seed Source로 사용합니다.

- 장수 209개, 기본 후보 140개
- 전법/스킬 1,077개
- 무기 97개
- 탈것 37개
- 스탯/속성 281개
- 진형 8개
- 병서 442개

확정 자료가 없는 승품 재료와 장비 특기 전체 사전은 만들지 않습니다.

## v0.3 Connect 자동 연동

개발자가 D1을 직접 수정하지 않습니다.

```bash
npx --yes nakwol-connect init --scopes roster:read,decks:read
npx --yes nakwol-connect doctor --json
```

Connect CLI는 기존 short-lived device CLI token을 DATA control endpoint에 전달합니다. DATA Worker는 그 token을 저장하거나 자체 해석하지 않고 AUTH의 기존 앱 관리 API로 전달하여 해당 개발자가 앱 owner/operator인지 매 요청마다 확인합니다. 검증 성공 후에만 `data_applications`와 `data_application_scopes`를 exact desired state로 UPSERT합니다.

브라우저에서는:

```js
const generals = await window.NAKWOL_CONNECT.data.registry.generals();
const tactics = await window.NAKWOL_CONNECT.data.registry.tactics();
```

`connect/v1.js`가 현재 앱 access token과 `X-NAKWOL-CLIENT-ID`를 자동 주입합니다. embed에 기록된 scope는 개발 편의용이고 실제 권한 판정은 DATA Worker가 수행합니다.

DATA control API:

- `GET /connect/cli/apps/:clientId/scopes`
- `PUT /connect/cli/apps/:clientId/scopes`

지원 scope:

- `profile:read`, `profile:write`
- `roster:read`, `roster:write`
- `equipment:read`, `equipment:write`
- `decks:read`, `decks:write`

## Registry APIs

- `GET /v1/registry/summary`
- `GET /v1/registry/generals`
- `GET /v1/registry/generals?include_hidden=1`
- `GET /v1/registry/tactics`
- `GET /v1/registry/equipment`
- `GET /v1/registry/stats`
- `GET /v1/registry/formations`
- `GET /v1/registry/warbooks`

## Deployment

Registry seed는 DELETE/TRUNCATE 없이 UPSERT만 수행합니다. DATA v0.3은 schema 2를 그대로 사용하며 새 migration은 없습니다.

## Next

1. 사용자 장수 보유/돌파/승품 API
2. 사용자 전법 보유/돌파 API와 실제 보유 가능 전법 분류
3. 무기·탈것 인스턴스 API
4. 덱 편집/스냅샷 API
5. 승품 재료와 장비 특기 Registry 보강
