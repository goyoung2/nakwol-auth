# NAKWOL DATA v0.1

NAKWOL DATA는 NAKWOL AUTH와 분리된 게임 데이터 계층입니다. AUTH는 “누구인가/어떤 앱인가”를 판정하고, DATA는 “그 사용자가 어떤 영구 게임 자산과 덱을 가지고 있는가”를 관리합니다.

## Current production status

- Worker: `https://nakwol-data.sepsd21.workers.dev`
- D1: `nakwol-data`
- Service version: `0.1.0`
- Schema version: `1`
- Migration: `0001_initial.sql` applied
- Final normal deploy: 18/18 tests, typecheck, Worker bundle, existing-D1 check, migration no-op, Worker deploy, health/schema smoke all passed

Public diagnostics:

```text
GET /api/health
GET /api/schema
```

The current Registry tables are intentionally empty until canonical game data is imported. DATA application scopes are also intentionally empty by default, so authenticated apps cannot read/write game data until explicitly granted a DATA scope.

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

## v0.1 Foundation

실제 HTTP 기능은 사용자 확인, 게임 계정 생성/조회, Registry 조회까지 엽니다. 장수/전법/장비/덱 저장 테이블은 schema version 1에 포함하지만 mutation API는 다음 증분에서 엽니다.

DATA scope: `profile:read/write`, `roster:read/write`, `equipment:read/write`, `decks:read/write`. 기본값은 아무 권한도 없음입니다.

최초 bootstrap은 완료되었습니다. 이후 운영 배포는 `ops/data-deploy.flag` → existing exact `nakwol-data` D1 필수 → migration → deploy 순서이며 일반 배포는 D1을 새로 만들지 않습니다. 배포 후 health/schema smoke는 Workers propagation을 고려해 최대 1분 재시도합니다.

## Next

1. Registry importer와 실제 장수/전법/장비/특기 ID 적재
2. 장수·전법 보유/돌파/승품 API
3. 무기·탈것 인스턴스 API
4. 덱 편집/스냅샷 API
5. NAKWOL Connect DATA scope 승인 UX
