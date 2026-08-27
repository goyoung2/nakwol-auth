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

## v0.4 사용자 장수 보유 API

기존 schema 2의 `user_generals`를 사용합니다.

- `GET /v1/game-accounts/:accountId/roster/generals` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/generals/:generalId` — `roster:write`

모든 endpoint는 AUTH principal이 실제 소유한 game account만 읽고 쓸 수 있습니다. 새 보유 장수는 `game_generals.enabled=1`인 Registry 항목만 허용합니다. 돌파는 0~5, 승품은 0 이상의 정수로 검증합니다.

## v0.5 사용자 전법 보유 API

기존 schema 2의 `user_tactics`를 그대로 사용합니다.

- `GET /v1/game-accounts/:accountId/roster/tactics` — `roster:read`
- `PUT /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`
- `DELETE /v1/game-accounts/:accountId/roster/tactics/:tacticId` — `roster:write`

전법 돌파는 0~5 정수입니다. PUT은 현재 상태를 멱등적으로 UPSERT하고 DELETE는 해당 계정의 보유 전법만 제거합니다.

보유 가능한 정식 전법은 ID 대역을 추측하지 않고 authoritative Registry 메타데이터로 판정합니다.

- `enabled=1`
- `class=5`
- `learn=1`
- `get=3`
- `copy=0`
- `chip>0`
- 어떤 장수의 `unique_tactic_id`로도 참조되지 않음

현재 확정 Seed에서는 이 조건을 만족하는 정식 보유 전법이 146개이고, 146개 모두 서로 다른 chip에 1:1로 연결됩니다. `755x`, `177xx`, `600xxx`, `810xxx` 등의 chip 없는 내부/콘텐츠 파생 레코드는 자동으로 제외됩니다.

## v0.6 사용자 무기·탈것 인스턴스 API

기존 schema 2의 `user_equipment`를 사용합니다. 새 migration은 없습니다.

- `GET /v1/game-accounts/:accountId/equipment` — `equipment:read`
- `POST /v1/game-accounts/:accountId/equipment` — `equipment:write`
- `PATCH /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`
- `DELETE /v1/game-accounts/:accountId/equipment/:equipmentId` — `equipment:write`

생성은 `game_equipment_templates.enabled=1`인 무기 또는 탈것만 허용합니다. DATA가 고유한 `eqp_...` 인스턴스 ID를 발급하며, 저장 가능한 현재 상태는 다음과 같습니다.

- `template_id`
- 선택적 `nickname`
- `locked`
- `favorite`
- `created_at`, `updated_at`

생성 후 `template_id`는 변경할 수 없습니다. 목록/수정/삭제는 AUTH principal이 실제 소유한 game account와 그 안의 equipment instance로만 제한됩니다.

DB에는 `user_equipment_stats`와 `user_equipment_traits` 자리가 이미 있지만, 현재 authoritative source에는 “어떤 스탯/특기가 어떤 장비에 실제로 붙을 수 있는가”를 확정할 전체 매핑과 trait Registry가 없습니다. 따라서 v0.6은 `stats`/`traits` 입력을 `EQUIPMENT_OPTIONS_UNSUPPORTED`로 명시적으로 거부합니다. `game_stat_types` 281개 전체를 장비 옵션으로 추정하지 않습니다.

`locked`는 저장되는 게임 상태이며, DATA API가 임의로 “잠긴 장비는 삭제 불가”라는 별도 게임 규칙을 만들지는 않습니다.

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

Registry seed는 DELETE/TRUNCATE 없이 UPSERT만 수행합니다. DATA v0.6은 schema 2를 그대로 사용하며 새 migration은 없습니다.

## Next

1. 덱 편집/스냅샷 API
2. 장비 옵션/특기 authoritative Registry 보강 후 장비 옵션 API 개방
3. 승품 재료 Registry 보강
