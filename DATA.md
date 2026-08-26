# NAKWOL DATA

NAKWOL DATA는 NAKWOL AUTH와 분리된 게임 데이터 계층입니다. AUTH는 “누구인가/어떤 앱인가”를 판정하고, DATA는 “그 사용자가 어떤 영구 게임 자산과 덱을 가지고 있는가”를 관리합니다.

## Runtime boundary

```text
NAKWOL AUTH Worker/D1
        │  /me verification
        ▼
NAKWOL DATA Worker/D1
        ├─ game accounts
        ├─ Game Registry
        ├─ owned generals / tactics
        ├─ equipment / mounts
        └─ decks / snapshots
```

두 서비스는 같은 GitHub 저장소에서 플랫폼 계약을 함께 버전 관리하지만 `services/data/`가 독립 package, Wrangler config, D1 migrations를 소유합니다. DATA는 AUTH D1에 직접 접근하지 않습니다.

## v0.2 Registry

`nslg-s-season-raw-research-kit-v1`의 확정 카탈로그를 정규화·gzip한 뒤 Base64 조각으로 저장한 `services/data/seeds/registry-v0.2.parts/*.b64`를 재현 가능한 Seed Source로 사용합니다. 런타임은 원본 ZIP에 의존하지 않습니다. `scripts/registry-seed-file.mjs`가 조각을 결합해 원래 Registry JSON을 복원합니다.

현재 Registry 범위:

- 장수 209개, 이 중 `is_show=1` 사용자 기본 후보 140개
- 전법/스킬 1,077개
- 무기 97개
- 탈것 37개
- 스탯/속성 정의 281개
- 진형 8개
- 병서 442개

모든 항목은 native ID와 source provenance를 metadata에 보존합니다. 노출 장수 140명의 고유전법은 전부 skill catalog와 연결됩니다. 숨김 장수 중 source skill row가 없는 경우에는 FK를 만들지 않고 native skill ID만 metadata에 남깁니다.

전법 1,077개는 “사용자가 뽑아 보유 가능한 전법”으로 확정한 목록이 아니라 source skill Registry 전체입니다. `ownership_status=unclassified`로 저장해 추후 정확한 보유 가능 필터를 추가합니다.

현재 확정 자료가 없는 승품 재료와 장비 특기 전체 사전은 만들지 않습니다. 사용자가 후속 자료를 제공하면 같은 Registry 방식으로 추가합니다.

## Registry APIs

- `GET /v1/registry/summary` — 인증 필요, Registry source/version/count
- `GET /v1/registry/generals` — `roster:read`, 기본 140개
- `GET /v1/registry/generals?include_hidden=1` — `roster:read`, 보존된 209개 전체
- `GET /v1/registry/tactics` — `roster:read`
- `GET /v1/registry/equipment` — `equipment:read`
- `GET /v1/registry/stats` — `equipment:read`
- `GET /v1/registry/formations` — `decks:read`
- `GET /v1/registry/warbooks` — `decks:read`

## Deployment

Registry seed는 DELETE/TRUNCATE를 사용하지 않고 UPSERT만 수행합니다. 배포 순서는 `D1 migration → Registry seed → Worker deploy → smoke`입니다. 따라서 Registry를 갱신해도 사용자 `user_generals`, `user_tactics`, 장비/덱 데이터는 삭제하지 않습니다.

## Next

1. 사용자 장수 보유/돌파/승품 API
2. 사용자 전법 보유/돌파 API와 “실제 보유 가능 전법” 분류
3. 무기·탈것 인스턴스 API
4. 덱 편집/스냅샷 API
5. 승품 재료와 장비 특기 Registry 보강
6. NAKWOL Connect DATA scope 승인 UX
