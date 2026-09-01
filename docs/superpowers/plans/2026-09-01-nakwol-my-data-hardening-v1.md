# NAKWOL My Data Hardening v1 — Implementation Plan

Status: implementation plan
Date: 2026-09-01
Design: `docs/superpowers/specs/2026-09-01-nakwol-my-data-hardening-v1-design.md`
Repository: `goyoung2/nakwol-auth`
Base branch: `dev`

## 1. Goal

My Data CRUD가 production에서 동작하는 현재 상태를, 다음 공통 `DeckPicker` 단계가 신뢰해도 되는 저장 기반으로 강화한다.

이번 계획의 완료 조건은 네 가지다.

1. invalid deck composition을 DATA server가 저장하지 않는다.
2. My Data의 기본 deck edit가 owned-first이며 중복 선택을 UI에서도 방지한다.
3. write 성공 뒤 authoritative read-back으로 persistence를 확인한다.
4. NAKWOL admin이 read-only `DATA Ops`에서 production user DATA를 확인할 수 있다.

이 작업이 끝나기 전에는 shared DeckPicker를 production contract로 확정하지 않는다.

---

## 2. Current baseline

현재 이미 구현/검증된 기능:

- high-level Data SDK
- `/my-data`
- game account list/create/select
- general owned C/R/U/D
- tactic owned C/R/U/D
- equipment instance C/R/U/D
- deck C/R/U/D
- composition PUT
- Registry-based research deck creation
- production refresh persistence

현재 schema의 `deck_general_slots`는 `(deck_id, position)`만 primary key다.

따라서 same-deck general/equipment uniqueness는 DB에서 강제되지 않는다.

기존 server validation은:

- position
- canonical general/tactic
- equipment account ownership
- weapon/mount type

을 확인하지만 same-deck duplicate instance/general 검사는 추가가 필요하다.

---

# Phase 1 — Composition invariant tests first

## 3. Branch

```text
fix/data-deck-composition-integrity
```

`dev`에서 분기한다.

## 4. RED tests

주요 파일 후보:

```text
services/data/tests/decks.test.ts
services/data/src/decks-domain.ts
services/data/src/decks-store.ts
services/data/src/routes/decks.ts
```

먼저 다음 실패 test를 추가한다.

### 4.1 duplicate general

```text
position 1 -> general A
position 2 -> general A
```

expected:

```text
400
DUPLICATE_GENERAL_IN_DECK
```

### 4.2 duplicate weapon instance

```text
position 1 -> weapon eqp_X
position 2 -> weapon eqp_X
```

expected:

```text
400
DUPLICATE_EQUIPMENT_IN_DECK
```

### 4.3 duplicate mount instance

동일.

### 4.4 failed replace is atomic

1. valid old composition 저장
2. duplicate composition PUT
3. 400 확인
4. GET deck
5. old composition 유지 확인

### 4.5 existing validation regression

다음 기존 규칙은 계속 PASS해야 한다.

- cross-account equipment rejected
- weapon/mount mismatch rejected
- non-canonical tactic rejected
- invalid position rejected

---

# Phase 2 — Server validation

## 5. Domain validation

request normalization 단계에서 전체 composition을 한 번 순회한다.

추가 set:

```text
seenGeneralIds
seenEquipmentIds
```

각 general row마다:

```text
if general_id already seen -> DUPLICATE_GENERAL_IN_DECK

if weapon_instance_id already seen -> DUPLICATE_EQUIPMENT_IN_DECK
if mount_instance_id already seen -> DUPLICATE_EQUIPMENT_IN_DECK
```

server error mapping은 code를 그대로 API response에 보존한다.

## 6. Do not add guessed tactic uniqueness

동일 tactic의 deck-global 중복 가능 여부는 별도 게임 규칙 증거가 확인될 때까지 validation에 추가하지 않는다.

---

# Phase 3 — Production duplicate preflight

## 7. Before DB unique indexes

unique index migration 전에 production D1에서 existing bad rows를 검사한다.

운영 SQL 예:

```sql
SELECT deck_id, general_id, COUNT(*) AS n
FROM deck_general_slots
GROUP BY deck_id, general_id
HAVING COUNT(*) > 1;
```

```sql
SELECT deck_id, weapon_instance_id, COUNT(*) AS n
FROM deck_general_slots
WHERE weapon_instance_id IS NOT NULL
GROUP BY deck_id, weapon_instance_id
HAVING COUNT(*) > 1;
```

```sql
SELECT deck_id, mount_instance_id, COUNT(*) AS n
FROM deck_general_slots
WHERE mount_instance_id IS NOT NULL
GROUP BY deck_id, mount_instance_id
HAVING COUNT(*) > 1;
```

### Decision

- 0 rows -> migration 진행
- 1+ rows -> migration 중단, report만 남김

자동 row deletion/repair 금지.

---

# Phase 4 — D1 integrity constraints

## 8. Migration

production preflight가 clean일 때 migration을 추가한다.

예상 next DATA migration:

```text
services/data/migrations/0006_deck_integrity.sql
```

root mirror/ops migration이 필요하면 repository convention에 맞춘다.

index:

```sql
CREATE UNIQUE INDEX idx_deck_general_unique_general
ON deck_general_slots(deck_id, general_id);

CREATE UNIQUE INDEX idx_deck_general_unique_weapon
ON deck_general_slots(deck_id, weapon_instance_id)
WHERE weapon_instance_id IS NOT NULL;

CREATE UNIQUE INDEX idx_deck_general_unique_mount
ON deck_general_slots(deck_id, mount_instance_id)
WHERE mount_instance_id IS NOT NULL;
```

migration idempotency / existing user rows preservation test를 추가한다.

## 9. Why server + DB both

DB error message를 사용자 API contract로 직접 노출하지 않는다.

정상 invalid input은 domain validator에서 deterministic code로 거부한다.

DB index는 race/bug/미래 코드 regression의 마지막 방어층이다.

---

# Phase 5 — My Data owned-first deck UX

## 10. Branch

```text
feature/my-data-owned-first-deck-editor
```

server integrity가 `dev`에 들어간 뒤 분기한다.

## 11. Default mode

My Data deck composition editor에 mode를 둔다.

```text
[내 보유만]  [전체 Registry · 연구용]
```

초기값:

```text
내 보유만
```

### Owned mode

General:

```text
owned.generals
```

Tactic:

```text
owned.tactics
```

Equipment:

```text
owned.equipment
```

### Research mode

General:

```text
Registry enabled generals
```

Tactic:

```text
canonical ownable Registry tactics
```

Equipment은 그대로 owned instance only.

unowned Registry general/tactic은 `미등록 · 연구용` 표시.

## 12. UI duplicate guard

각 select render/update 시 currently selected values를 수집한다.

- 다른 position에서 선택한 general -> disabled
- 다른 slot에서 선택한 equipment instance -> disabled

현재 선택값은 자기 selector에서는 유지한다.

mode 전환 시 기존 선택을 조용히 삭제하지 않는다.

unowned selection이 이미 존재하는 deck을 owned mode로 열면:

```text
현재 편성에 미등록 장수/전법이 포함되어 있습니다.
```

표시하고 existing value를 유지한다.

## 13. UI tests

- initial mode = owned
- Registry toggle explicit
- duplicate general option disabled
- duplicate equipment option disabled
- research mode keeps canonical filter
- no raw token/request path usage
- mobile layout unchanged

---

# Phase 6 — Persistence confirmation contract

## 14. Shared helper

My Data 내부에서 mutation마다 제각각 toast를 띄우지 않고 공통 pattern을 만든다.

개념:

```js
await mutate();
const persisted = await verify();
assertExpected(persisted);
showSavedConfirmed();
```

꼭 generic abstraction으로 과도하게 만들 필요는 없지만 UX wording/behavior는 통일한다.

## 15. Entity verification

### General/tactic

save 후 list에서 ID와 editable fields 일치 확인.

### Equipment

create 후 returned ID를 list에서 확인.

update 후 editable fields 일치 확인.

### Deck metadata

`decks.get()`로 확인.

### Composition

`replaceComposition()` success 뒤 `decks.get()` 재호출.

normalized expected composition과 비교.

### Delete

list/detail absence 확인.

## 16. UI labels

성공:

```text
저장 확인됨
```

가능하면 sync timestamp:

```text
저장 확인됨 · 16:24:31
```

write success + verify fail:

```text
저장 요청은 성공했지만 재확인하지 못했습니다. 새로고침해 확인하세요.
```

이 경우 `저장 실패`라고 거짓 표시하지 않는다.

---

# Phase 7 — DATA Ops foundation

## 17. Branch

```text
feature/data-ops-readonly
```

## 18. Dedicated AUTH app

신규 internal app:

```text
client_id: nakwol-data-ops
homepage/callback: https://nakwol-data.sepsd21.workers.dev/ops
access_policy: admin
```

AUTH migration은 non-destructive UPSERT.

`lab` policy를 쓰지 않는다.

## 19. Ops auth contract tests

RED tests:

- admin access allowed
- ordinary member denied
- non-member denied
- active Connect developer but not membership admin denied
- wrong client ID denied
- expired/invalid token denied

DATA Ops의 arbitrary-user reads는 normal owner-isolated DATA scope path와 분리한다.

구현 전에 runtime admin revalidation 방식을 확정한다.

요구사항은 **매 Ops request에서 현재 admin eligibility를 다시 확인할 수 있어야 한다**는 것이다.

## 20. Read-only store/API

후보 internal routes:

```text
GET /ops
GET /internal/ops/accounts?q=...
GET /internal/ops/accounts/:accountId
GET /internal/ops/accounts/:accountId/decks/:deckId
```

실제 route naming은 OpenAPI app-facing contract와 섞이지 않도록 internal prefix를 사용한다.

Ops API는 normal public OpenAPI에 반드시 노출할 필요가 없다. 노출한다면 clearly internal/admin marked contract가 필요하다.

## 21. Search result

검색:

- account ID
- DATA user ID
- nickname
- server code

list에는 최소 필드만.

```text
account id
nickname
server
primary
updated_at
```

## 22. Detail view

탭/section:

```text
요약
장수
전법
장비
덱
스냅샷 요약
Raw JSON
```

Raw JSON에 포함 금지:

- access token
- refresh/session secret
- Discord OAuth token
- Cloudflare credential

## 23. Read-only enforcement

Ops v1 source와 tests에서 다음을 금지한다.

```text
POST /internal/ops/user-data/*
PUT
PATCH
DELETE
```

UI에도 수정/삭제 button 없음.

---

# Phase 8 — Ops audit

## 24. Migration

신규 table 후보:

```text
data_ops_audit_log
```

fields:

```text
id
operator_user_id
target_user_id nullable
target_account_id nullable
action
request_id
created_at
```

필요하면 search query 자체는 raw text 대신 normalized/redacted 형태로 저장한다.

## 25. Audit requirements

최소 action:

```text
SEARCH_ACCOUNT
VIEW_ACCOUNT
VIEW_DECK
```

Ops DATA read가 성공했을 때 audit 기록.

민감 credential/token은 audit payload에 저장하지 않는다.

## 26. Audit tests

- admin view creates audit row
- denied request does not create misleading successful-view row
- audit cannot be written by normal consumer app
- no user DATA mutation occurs

---

# Phase 9 — Manual production verification

## 27. Integrity matrix

테스트용 account/deck을 사용한다.

```text
H1 general A + general A duplicate -> FAIL
H2 weapon X + weapon X duplicate -> FAIL
H3 mount X + mount X duplicate -> FAIL
H4 invalid save 뒤 old composition 유지
H5 valid deck save -> PASS
H6 refresh -> same deck
H7 browser close/reopen -> same deck
```

테스트 데이터 cleanup 수행.

## 28. My Data matrix

```text
M1 owned mode에서 내 장수만 표시
M2 owned mode에서 내 전법만 표시
M3 research mode에서 Registry 표시
M4 unowned row에 연구용 표시
M5 equipment duplicate UI 선택 불가
M6 valid composition 저장 확인됨
```

## 29. Ops matrix

```text
O1 admin 로그인
O2 account 검색
O3 My Data에서 저장한 test entity 확인
O4 deck composition 확인
O5 non-admin account -> 403
O6 active developer but non-admin -> 403
O7 audit row 확인
```

---

# Phase 10 — Current operator verification until DATA Ops ships

## 30. User-side check

현재 가장 간단한 독립 검증:

```text
My Data에서 저장
-> Ctrl+F5 또는 브라우저 닫기
-> /my-data 다시 열기
-> 같은 account 선택
-> 동일 값 확인
```

이는 새 GET 요청으로 DATA를 다시 읽으므로 단순 toast보다 강한 증거다.

## 31. Backend truth via Cloudflare D1

DATA Ops가 생기기 전에는 Cloudflare Dashboard의 `nakwol-data` D1 Console 또는 `wrangler d1 execute DB --remote`가 운영자 backend truth 확인 경로다.

account 찾기:

```sql
SELECT id,user_id,nickname,server_code,is_primary,created_at,updated_at
FROM game_accounts
ORDER BY updated_at DESC;
```

특정 account의 장수:

```sql
SELECT ug.general_id,g.name,ug.breakthrough,ug.promotion,ug.favorite,ug.note,ug.updated_at
FROM user_generals ug
JOIN game_generals g ON g.id=ug.general_id
WHERE ug.account_id='gac_...'
ORDER BY g.name;
```

전법:

```sql
SELECT ut.tactic_id,t.name,ut.breakthrough,ut.favorite,ut.note,ut.updated_at
FROM user_tactics ut
JOIN game_tactics t ON t.id=ut.tactic_id
WHERE ut.account_id='gac_...'
ORDER BY t.name;
```

장비:

```sql
SELECT ue.id,ue.template_id,et.name,et.type,ue.nickname,ue.locked,ue.favorite,ue.updated_at
FROM user_equipment ue
JOIN game_equipment_templates et ON et.id=ue.template_id
WHERE ue.account_id='gac_...'
ORDER BY ue.created_at;
```

덱:

```sql
SELECT id,name,status,visibility,is_primary,created_at,updated_at
FROM decks
WHERE account_id='gac_...'
ORDER BY updated_at DESC;
```

composition:

```sql
SELECT gs.deck_id,gs.position,gs.general_id,g.name AS general_name,
       gs.weapon_instance_id,gs.mount_instance_id
FROM deck_general_slots gs
JOIN game_generals g ON g.id=gs.general_id
WHERE gs.deck_id='dek_...'
ORDER BY gs.position;
```

```sql
SELECT deck_id,general_position,slot,tactic_id
FROM deck_tactic_slots
WHERE deck_id='dek_...'
ORDER BY general_position,slot;
```

이 SQL은 진단용이다. manual `UPDATE/DELETE`를 정상 운영 방법으로 사용하지 않는다.

---

# Phase 11 — Future loadout contract discovery

## 32. Separate discovery task

다음 항목은 hardening 뒤 별도 spec으로 만든다.

```text
general stat allocation
formation
warbooks
troop type
equipment traits/options
```

각 항목마다 먼저 확인:

```text
canonical Registry 존재 여부
ownership level
slot/cardinality
중복 규칙
시즌 영향
snapshot freeze 대상 여부
```

확정 뒤 schema/API/UI를 설계한다.

`deck_settings`에 임의 JSON을 먼저 쌓지 않는다.

---

## 33. PR sequence

권장 순서:

```text
PR A  fix: composition server duplicate guards + atomic regression tests
PR B  chore/data: production preflight + D1 unique indexes
PR C  feat(my-data): owned-first selectors + duplicate UI guard
PR D  feat(my-data): explicit read-after-write confirmation
PR E  feat(data-ops): admin-only read-only Ops foundation
PR F  feat(data-ops): audit log + production verification
```

각 PR:

```text
feature/fix -> dev
fresh CI
merge
```

production이 필요한 변경은 repository의 `dev -> main -> stable` promotion policy를 따른다.

---

## 34. Final acceptance gate

Hardening v1 완료 조건:

```text
Server structural invariants PASS
D1 duplicate constraints PASS
My Data owned-first UX PASS
Read-after-write confirmation PASS
DATA Ops admin-only read PASS
Ops audit PASS
Production manual matrix PASS
```

완료 후 원래 User Data Platform v1 계획의 Phase 3 — shared `AccountPicker / DeckPicker / My Data launcher`로 복귀한다.
