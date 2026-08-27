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

## Current production golden

- DATA service: `0.7.0`
- DATA schema: `2`
- production Worker Version ID: `1337d16b-1b72-4ec1-b26f-f0a99c5a5330`
- release merge commit: `bfdfd7e2e4605cf0ed13cd5e67be609ea324e996`
- deploy trigger commit: `771b832d731ed6605d5e6435f5c134e6a2cb4d2d`
- production workflow run: `33043770476`
- verification: 65/65 tests, typecheck, Worker bundle, exact D1, no migration, Registry UPSERT/count gate, production health/schema passed
- release record: `docs/releases/2026-08-27-nakwol-data-v0.7.md`

이 기준은 장수 보유(v0.4), 전법 보유(v0.5), 무기·탈것 인스턴스(v0.6), live deck 편집과 불변 snapshot(v0.7)까지 운영 배포가 검증된 현재 DATA 골든 기준입니다.

## v0.7 production release

v0.7.0은 schema 2를 그대로 사용하면서 다음 기능을 운영에 추가했습니다.

- live deck CRUD
- 전체 composition 원자 교체
- 미보유 planned 장수/전법 지원
- canonical 장착 전법 검증
- 같은 game account의 무기/탈것 인스턴스 연결
- immutable owner-only deck snapshot
- snapshot에 당시 장수/전법 보유·돌파·승품 및 장비 nickname/locked/favorite 상태 동결

운영 배포는 `33043770476`에서 65/65 테스트, typecheck, bundle, exact D1, `No migrations to apply!`, Registry count gate, production `0.7.0 / schema 2` health/schema smoke까지 통과했습니다.

상세 개발·검증 기록은 `docs/releases/2026-08-27-nakwol-data-v0.7.md`에 남깁니다.

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

## v0.7 덱 편집 API

기존 schema 2의 `decks`, `deck_general_slots`, `deck_tactic_slots`를 사용하며 새 migration은 없습니다.

- `GET /v1/game-accounts/:accountId/decks` — `decks:read`
- `POST /v1/game-accounts/:accountId/decks` — `decks:write`
- `GET /v1/game-accounts/:accountId/decks/:deckId` — `decks:read`
- `PATCH /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `DELETE /v1/game-accounts/:accountId/decks/:deckId` — `decks:write`
- `PUT /v1/game-accounts/:accountId/decks/:deckId/composition` — `decks:write`

덱 본체는 이름, 선택적 시즌, 상태(`active`/`candidate`/`research`/`archived`), visibility(`private`/`alliance`/`public`), note, is_primary를 저장합니다.

composition은 장수 position 1~3, 각 장수의 전법 slot 1~2, 선택적 무기·탈것 인스턴스를 한 요청으로 전체 교체합니다. 요청 전체를 검증한 뒤에만 D1 batch를 실행하므로 실패 시 기존 구성을 보존합니다.

연구/후보덱을 위해 `user_generals` 또는 `user_tactics` 보유 여부는 구성의 선행 조건이 아닙니다. 장수는 활성 Registry 항목, 전법은 v0.5 canonical 장착 전법만 허용합니다. 장비는 같은 game account 소유 인스턴스여야 하며 weapon/mount 타입을 검증합니다.

중복 장수·전법·장비 사용 금지 같은 출처 미확정 게임 규칙은 DATA 계층에서 임의로 만들지 않습니다.

## v0.7 불변 덱 스냅샷

기존 schema 2의 `deck_snapshots`를 사용합니다.

- `POST /v1/game-accounts/:accountId/decks/:deckId/snapshots` — `decks:write`
- `GET /v1/deck-snapshots` — `decks:read`
- `GET /v1/deck-snapshots/:snapshotId` — `decks:read`

스냅샷은 `dks_...` ID와 `format_version: 1` JSON을 생성하며 다음 값을 생성 시점에 동결합니다.

- game account nickname/server
- live deck 메타데이터
- 장수 ID/이름과 owned/breakthrough/promotion 상태
- 무기·탈것 ID/템플릿/이름과 nickname/locked/favorite 상태
- 전법 ID/이름과 owned/breakthrough 상태

생성 후 live deck, Registry 이름, 보유 상태, 돌파/승품, 장비 정보가 변경돼도 snapshot JSON을 다시 계산하지 않습니다. live deck 삭제 시 snapshot은 유지되고 `source_deck_id`만 NULL이 됩니다.

`visibility=alliance|public`은 향후 공유 정책을 위한 저장 메타데이터입니다. v0.7의 snapshot list/detail은 visibility와 무관하게 `owner_user_id`로 격리하며 cross-user 조회는 아직 열지 않습니다.

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

Registry seed는 DELETE/TRUNCATE 없이 UPSERT만 수행합니다. DATA v0.7은 schema 2를 그대로 사용하며 새 migration은 없습니다. 운영 배포 `33043770476`에서 exact D1, Registry count gate, production health/schema가 검증됐습니다.

## Next

1. 장비 옵션/특기 authoritative Registry 보강 후 장비 옵션 API 개방
2. 승품 재료 Registry 보강
3. `deck_settings` 진형/병서 모델과 공개 API 설계
