# NAKWOL My Data Hardening v1 — Single Development Specification

Status: authoritative implementation SSOT
Date: 2026-09-01
Repository: `goyoung2/nakwol-auth`
Base branch: `dev`
Parent architecture: `docs/superpowers/specs/2026-09-01-nakwol-user-data-platform-v1-design.md`

> 이 문서는 My Data Hardening v1의 **유일한 개발 기준 문서**다.
> 기존 `...hardening-v1-design.md`와 `...hardening-v1.md` plan은 이 문서로 통합되어 superseded 된다.

---

# 1. 목적

NAKWOL User Data Platform은 이미 production에서 다음 경로가 실제로 동작한다.

```text
사용자 브라우저
  -> NAKWOL AUTH
  -> app-bound access token
  -> NAKWOL DATA Worker
  -> AUTH Service Binding verification
  -> DATA D1
  -> 브라우저 재조회
```

현재 구현/검증된 기반:

- NAKWOL AUTH 0.2.0
- NAKWOL Connect 0.4.0
- NAKWOL DATA 0.9.0 / schema 3
- high-level Connect Data SDK
- `/my-data`
- game account C/R
- owned general C/R/U/D
- owned tactic C/R/U/D
- equipment instance C/R/U/D
- live deck C/R/U/D
- deck composition PUT
- immutable snapshot C/R
- production refresh persistence
- DATA Lab production CRUD smoke PASS

따라서 이번 작업은 CRUD를 다시 만드는 일이 아니다.

이번 hardening의 목표는 **다른 낙월 서비스가 My Data를 신뢰하고 재사용하기 전에 저장 기반 자체를 단단하게 만드는 것**이다.

핵심 원칙은 세 문장이다.

> **UI가 잘못된 편성을 만들더라도 DATA 서버가 잘못된 상태를 저장해서는 안 된다.**
>
> **“저장됨”은 mutation 성공이 아니라 authoritative read-back까지 확인된 상태를 뜻한다.**
>
> **운영자는 사용자의 production DATA를 안전한 read-only 도구로 직접 검증할 수 있어야 한다.**

이 문서의 모든 단계가 production에서 검증되기 전에는 shared `AccountPicker` / `DeckPicker`를 다음 production contract로 확정하지 않는다.

---

# 2. 현재 관찰된 문제

## 2.1 덱 편성 기본값이 전체 Registry

현재 My Data deck editor는 deck-first research 흐름을 지원하기 위해 모든 enabled general과 canonical tactic을 기본 selector에 노출한다.

이 기능 자체는 필요하다. 하지만 daily-use UX의 기본 기대는 다음이다.

```text
내 덱 편성
  -> 기본적으로 내가 보유 등록한 장수와 전법
```

따라서 daily-use와 research-use를 분리한다.

## 2.2 동일 장비 인스턴스의 같은 덱 내 중복 배치

`user_equipment.id`는 실제 보유 장비 인스턴스 하나를 의미한다.

금지:

```text
deck X
  position 1 -> weapon eqp_123
  position 2 -> weapon eqp_123
```

허용:

```text
deck A -> eqp_123
deck B -> eqp_123
```

즉 uniqueness 범위는 **동일 deck 내부**다.

## 2.3 동일 장수의 같은 덱 내 중복 배치

현재 `position`은 unique지만 `general_id`는 deck-local unique invariant가 아니다.

금지:

```text
deck X
  position 1 -> general A
  position 2 -> general A
```

## 2.4 저장 성공 메시지의 의미가 약함

현재 대부분의 UI는 mutation 성공 후 다시 데이터를 불러오지만, UX contract가 명시적으로 “read-back까지 확인된 저장”으로 통일되어 있지는 않다.

단순 toast:

```text
저장했습니다.
```

만으로는 운영/사용자가 persisted server truth까지 확인했는지 알기 어렵다.

## 2.5 사용자 DATA 관리자 콘솔 부재

현재 DATA Worker의 사용자/운영 surface:

```text
/lab      current signed-in operator의 production CRUD diagnostic
/my-data  일반 사용자의 자기 데이터 관리
```

임의의 NAKWOL user 또는 game account를 검색하여 실제 production DATA를 읽는 관리자 console은 없다.

`Connect Admin`은 app/developer 관리 도구이고, `Data Lab`은 arbitrary-user inspector가 아니다.

---

# 3. Hardening v1 범위

이번 작업은 다음 네 축만 다룬다.

1. **Server-side deck integrity**
2. **My Data owned-first UX**
3. **Persistence confirmation**
4. **NAKWOL DATA Ops read-only admin verification**

이번 v1에서 하지 않는다.

- 장수 스탯 분배 모델
- 병종
- 진형
- 병서
- 상세 장비 옵션/특성 applicability 확대
- screenshot/video import
- shared DeckPicker
- alliance/public snapshot read 확대
- arbitrary admin mutation

위 후속 게임 데이터는 먼저 canonical Registry, ownership level, slot/cardinality, duplicate rule, season behavior, snapshot freeze boundary를 확정한 뒤 별도 schema/API 작업으로 진행한다.

`deck_settings`에 근거 없는 opaque JSON을 먼저 쌓지 않는다.

---

# 4. 변경 불가 경계

다음은 hardening 중에도 유지한다.

- AUTH D1 / DATA D1 분리
- Discord secret은 AUTH에만 존재
- Authorization Code + PKCE(S256)
- exact redirect allowlist
- app-bound token
- user-owned access는 account ownership으로 격리
- Registry reseed는 user-owned rows delete/truncate 금지
- pinned AUTH Web SDK v0.1 수정 금지
- existing low-level/high-level Connect compatibility 유지
- Data Lab과 My Data의 역할 분리
- read-only consumer에 write scope 자동 부여 금지

---

# 5. 최종 무결성 규칙

무결성은 세 층에서 방어한다.

```text
My Data UI guard
   +
DATA domain validation
   +
D1 constraint
```

UI guard는 편의 기능이다. 최종 source of truth는 DATA server다.

## 5.1 Position

- position은 1..3
- 같은 position 중복 금지

기존 규칙 유지.

## 5.2 General uniqueness

한 deck 안에서 동일 `general_id`는 최대 1회.

API error code:

```text
DUPLICATE_GENERAL_IN_DECK
```

## 5.3 Equipment instance uniqueness

한 deck 안에서 동일 `user_equipment.id`는 weapon/mount를 합쳐 최대 1회.

API error code:

```text
DUPLICATE_EQUIPMENT_IN_DECK
```

동일 인스턴스가 weapon field와 mount field에 동시에 등장하는 비정상 payload도 동일 code로 거부한다.

## 5.4 Equipment ownership

기존 규칙 유지.

- equipment는 해당 game account 소유여야 함
- 다른 account equipment 참조 금지

## 5.5 Equipment type

기존 규칙 유지.

```text
weapon_instance_id -> weapon
mount_instance_id  -> mount
```

## 5.6 Registry validity

기존 canonical validation을 유지한다.

- general: DATA가 허용하는 enabled/playable Registry row
- tactic: DATA가 인정하는 canonical ownable tactic

## 5.7 Tactic deck-global uniqueness는 아직 만들지 않음

동일 tactic을 여러 장수에게 동시에 장착 가능한지에 대한 게임 규칙 증거가 아직 이 hardening 문서의 근거로 확정되어 있지 않다.

따라서 추측으로 `DUPLICATE_TACTIC_IN_DECK` 같은 규칙을 만들지 않는다.

## 5.8 Atomic replacement

composition replace는 all-or-nothing이어야 한다.

```text
기존 valid composition A 저장
  -> invalid composition B PUT
  -> 400
  -> GET deck
  -> composition A 그대로
```

부분 delete/insert 상태가 남아서는 안 된다.

---

# 6. 구현 순서 — 절대 순차 진행

아래 순서를 바꾸지 않는다.

```text
Stage 1  Composition invariant RED tests
Stage 2  DATA server validation
Stage 3  Production duplicate preflight
Stage 4  D1 unique constraints
Stage 5  My Data owned-first UX + UI duplicate guard
Stage 6  Persistence confirmation contract
Stage 7  DATA Ops read-only foundation
Stage 8  DATA Ops audit
Stage 9  Production manual hardening matrix
Stage 10 Hardening close -> DeckPicker 단계 복귀
```

각 Stage는 직전 Stage가 `dev`에 green으로 병합된 뒤 다음 branch를 만든다.

---

# 7. Stage 1 — Composition invariant RED tests

Branch:

```text
fix/data-deck-composition-integrity
```

주요 파일 후보:

```text
services/data/tests/decks.test.ts
services/data/src/decks-domain.ts
services/data/src/decks-store.ts
services/data/src/routes/decks.ts
```

먼저 실패 테스트를 작성한다.

## T1 duplicate general

```text
position 1 -> general A
position 2 -> general A
```

Expected:

```text
HTTP 400
error.code = DUPLICATE_GENERAL_IN_DECK
```

## T2 duplicate weapon

```text
position 1 -> weapon eqp_X
position 2 -> weapon eqp_X
```

Expected:

```text
HTTP 400
error.code = DUPLICATE_EQUIPMENT_IN_DECK
```

## T3 duplicate mount

동일.

## T4 equipment ID cross-field duplicate

가능한 payload shape에서 동일 equipment instance가 weapon과 mount를 가로질러 두 번 등장하면 거부한다.

## T5 failed replace atomicity

1. valid old composition 저장
2. invalid duplicate composition PUT
3. 400 확인
4. deck GET
5. old composition semantic-equivalent 확인

## T6 existing regression

계속 PASS해야 함:

- cross-account equipment rejection
- weapon/mount mismatch rejection
- invalid position rejection
- non-canonical tactic rejection
- owner isolation

Stage 1 DoD:

```text
새 테스트가 현재 구현에서 의도대로 RED
기존 테스트는 회귀 없음
테스트가 실제 API path를 검증
```

---

# 8. Stage 2 — DATA server validation

Stage 1 branch에서 RED를 GREEN으로 만든다.

request 전체 composition을 mutation 전에 먼저 검사한다.

개념:

```text
seenPositions
seenGeneralIds
seenEquipmentIds
```

각 general row 처리:

```text
position duplicate
  -> existing position error

general_id duplicate
  -> DUPLICATE_GENERAL_IN_DECK

weapon_instance_id duplicate
  -> DUPLICATE_EQUIPMENT_IN_DECK

mount_instance_id duplicate
  -> DUPLICATE_EQUIPMENT_IN_DECK
```

모든 structural validation은 기존 composition을 delete하기 전에 끝낸다.

error mapping은 DATA API JSON contract로 deterministic code를 그대로 노출한다.

DB native constraint message를 정상 사용자 입력 오류 contract로 직접 노출하지 않는다.

Stage 2 DoD:

```text
T1~T6 GREEN
DATA tests GREEN
typecheck GREEN
bundle GREEN
Repository Governance GREEN
```

이 단계까지 한 PR로 `dev` 병합한다.

---

# 9. Stage 3 — Production duplicate preflight

DB unique index를 넣기 전에 production D1에 기존 bad row가 있는지 먼저 검사한다.

이 단계는 **읽기만 한다.**

### General duplicate

```sql
SELECT deck_id, general_id, COUNT(*) AS n
FROM deck_general_slots
GROUP BY deck_id, general_id
HAVING COUNT(*) > 1;
```

### Weapon duplicate

```sql
SELECT deck_id, weapon_instance_id, COUNT(*) AS n
FROM deck_general_slots
WHERE weapon_instance_id IS NOT NULL
GROUP BY deck_id, weapon_instance_id
HAVING COUNT(*) > 1;
```

### Mount duplicate

```sql
SELECT deck_id, mount_instance_id, COUNT(*) AS n
FROM deck_general_slots
WHERE mount_instance_id IS NOT NULL
GROUP BY deck_id, mount_instance_id
HAVING COUNT(*) > 1;
```

결정:

```text
세 쿼리 모두 0 rows
  -> Stage 4 진행

하나라도 1+ rows
  -> Stage 4 중단
  -> report만 남김
  -> 자동 winner 선택/삭제 금지
```

production user row를 migration 편의를 위해 자동 수정하지 않는다.

Preflight 결과는 PR/운영 기록에 남긴다.

---

# 10. Stage 4 — D1 integrity constraints

Stage 3이 clean일 때만 진행한다.

예상 migration:

```text
services/data/migrations/0006_deck_integrity.sql
```

필요한 repository mirror migration은 기존 convention에 맞춘다.

Index:

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

추가 검증:

- migration idempotency
- existing valid user rows preservation
- Registry reseed 영향 없음
- D1 unique failure가 user-facing 정상 validation 경로를 대체하지 않음

Stage 4 DoD:

```text
production preflight clean evidence
migration tests GREEN
existing user rows preserved
remote migration success
production DATA surface smoke GREEN
```

---

# 11. Stage 5 — My Data owned-first UX

Branch:

```text
feature/my-data-owned-first-deck-editor
```

Stage 4가 `dev`에 반영된 이후 시작한다.

## 11.1 Mode

덱 편성 상단:

```text
[내 보유만] [전체 Registry · 연구용]
```

초기값:

```text
내 보유만
```

## 11.2 Owned mode

General source:

```text
owned.generals
```

Tactic source:

```text
owned.tactics
```

Equipment source:

```text
owned.equipment
```

## 11.3 Research mode

General:

```text
enabled Registry generals
```

Tactic:

```text
canonical ownable Registry tactics
```

Equipment:

```text
항상 owned equipment instances only
```

미등록 Registry 항목은 명확히 표시한다.

```text
관우 · 미등록 · 연구용
강궁격 · 미등록 · 연구용
```

## 11.4 Existing research deck 보존

이미 미등록 general/tactic을 포함하는 deck을 owned mode에서 열어도 선택값을 조용히 삭제하지 않는다.

표시:

```text
현재 편성에 미등록 장수/전법이 포함되어 있습니다.
```

기존 값은 유지되고 사용자가 명시적으로 바꿀 때만 변경한다.

## 11.5 UI duplicate guard

다른 position에서 이미 선택된:

- general
- weapon instance
- mount instance

는 다른 selector에서 disabled 또는 hidden 처리한다.

현재 selector 자신의 기존 선택은 유지한다.

UI는 server rule과 같은 invariant를 설명하는 즉시 피드백을 준다.

## 11.6 UI tests

- initial mode owned
- research toggle explicit
- owned general/tactic source
- research canonical source
- unowned research label
- duplicate general option disabled
- duplicate equipment option disabled
- existing research value preservation
- mobile layout regression 없음
- raw token / low-level REST 직접 호출 없음

---

# 12. Stage 6 — Persistence confirmation contract

사용자 메시지의 의미를 강화한다.

## 12.1 Saved definition

성공 상태:

```text
mutation request success
  -> authoritative GET/list
  -> expected entity/value observed
  -> 저장 확인됨
```

mutation response만 성공한 상태는 최종 `저장 확인됨`이 아니다.

## 12.2 General

upsert 후 authoritative list에서 확인:

- general_id
- breakthrough
- promotion
- favorite
- note
- updated_at 존재/갱신

## 12.3 Tactic

- tactic_id
- breakthrough
- favorite
- note

## 12.4 Equipment

Create:

```text
returned equipment ID
  -> list
  -> exact ID 존재
```

Update:

```text
nickname / locked / favorite 일치
```

## 12.5 Deck metadata

`data.decks.get(accountId, deckId)`로 확인.

## 12.6 Composition

`replaceComposition()` 후 `decks.get()`을 다시 호출하여 normalized expected composition과 비교한다.

## 12.7 Delete

삭제 후 absence를 authoritative read로 확인한다.

## 12.8 UI 상태

정상:

```text
저장 중
저장 확인됨 · HH:MM:SS
```

write 성공 + verify 실패:

```text
저장 요청은 성공했지만 재확인하지 못했습니다. 새로고침해 확인하세요.
```

이 경우 거짓으로 `저장 실패`라고 하지 않는다.

## 12.9 Failure semantics

- mutation 자체 실패 -> 저장 실패
- mutation 성공, read-back mismatch -> 저장 검증 실패
- mutation 성공, read-back network 실패 -> 저장 요청 성공 / 재확인 실패

세 상태를 구분한다.

---

# 13. Stage 7 — NAKWOL DATA Ops read-only foundation

Branch:

```text
feature/data-ops-readonly
```

## 13.1 별도 제품 surface

```text
https://nakwol-data.sepsd21.workers.dev/ops
client_id = nakwol-data-ops
```

Data Lab과 My Data를 재사용/확장하지 않는다.

## 13.2 AUTH app

internal app:

```text
client_id: nakwol-data-ops
callback: https://nakwol-data.sepsd21.workers.dev/ops
access_policy: admin
```

중요:

- `lab` policy 금지
- active Connect developer만으로 접근 허용 금지
- membership admin만 접근
- exact app binding 확인
- expired/invalid token 거부
- runtime에서 admin eligibility 재확인

## 13.3 Read-only boundary

Ops v1은 arbitrary-user **읽기만** 가능하다.

금지:

- 사용자 대신 수정
- delete
- create
- impersonation
- 사용자 access token 표시
- Discord OAuth token 표시
- Cloudflare credential 표시

## 13.4 Internal routes

후보:

```text
GET /ops
GET /internal/ops/accounts?q=...
GET /internal/ops/accounts/:accountId
GET /internal/ops/accounts/:accountId/decks/:deckId
```

normal app-facing OpenAPI와 섞지 않는다.

## 13.5 Search

최소 key:

- `gac_*` account ID
- DATA user ID
- nickname exact/partial
- server code

검색 list 최소 필드:

```text
account id
nickname
server_code
primary
updated_at
```

## 13.6 Account detail

```text
Account summary
Owned generals
Owned tactics
Equipment instances
Live decks
Deck composition
Snapshot summary
Raw JSON (safe fields only)
```

## 13.7 Authorization tests

- membership admin -> allowed
- ordinary member -> denied
- non-member -> denied
- active developer but not admin -> denied
- wrong client ID -> denied
- invalid/expired token -> denied

## 13.8 Read-only tests

source/API/UI에서 user DATA mutation route/button이 없어야 한다.

```text
POST/PUT/PATCH/DELETE arbitrary-user Ops API 금지
```

---

# 14. Stage 8 — DATA Ops audit

Ops에서 임의 사용자 데이터를 조회한 사실 자체를 기록한다.

예상 table:

```text
data_ops_audit_log
```

필드:

```text
id
operator_user_id
target_user_id nullable
target_account_id nullable
action
request_id
created_at
```

최소 action:

```text
SEARCH_ACCOUNT
VIEW_ACCOUNT
VIEW_DECK
```

원칙:

- 성공한 arbitrary-user read는 audit
- denied request를 successful-view로 기록하지 않음
- token/secret 저장 금지
- raw search text가 불필요하면 normalized/redacted 형태 사용
- normal consumer가 audit table을 쓸 수 없음

Tests:

- admin view -> audit row
- denied view -> successful audit 없음
- consumer -> audit write 불가
- user DATA mutation 없음

---

# 15. Stage 9 — Production manual hardening matrix

자동 CI만으로 완료 처리하지 않는다.

실제 production account/deck으로 browser E2E를 수행한다.

## 15.1 Integrity

```text
H1 same general twice                -> FAIL expected
H2 same weapon instance twice        -> FAIL expected
H3 same mount instance twice         -> FAIL expected
H4 invalid replace after valid deck  -> old composition preserved
H5 valid deck save                   -> PASS
```

## 15.2 Persistence

```text
P1 general save -> 저장 확인됨
P2 tactic save -> 저장 확인됨
P3 equipment create/update -> 저장 확인됨
P4 deck metadata -> 저장 확인됨
P5 composition -> 저장 확인됨
P6 Ctrl+F5 -> same values
P7 browser close/reopen -> same values
P8 delete -> read-back absence
```

## 15.3 Owned-first UX

```text
M1 기본 mode = 내 보유만
M2 내 장수만 표시
M3 내 전법만 표시
M4 research mode -> Registry 표시
M5 unowned -> 연구용 표시
M6 same general duplicate selection 불가
M7 same equipment duplicate selection 불가
M8 existing research deck value 보존
```

## 15.4 DATA Ops

```text
O1 admin login -> PASS
O2 account search -> PASS
O3 My Data에서 저장한 entity 확인
O4 deck composition 확인
O5 ordinary member -> 403
O6 active developer but non-admin -> 403
O7 audit row 확인
O8 Ops UI에서 mutation action 없음
```

테스트용 데이터는 cleanup 가능한 것만 사용한다.

삭제 API가 없는 game account처럼 cleanup 불가능한 test object를 반복 생성하지 않는다.

---

# 16. DATA Ops가 나오기 전 현재 저장 확인 방법

## 16.1 사용자 수준

```text
My Data에서 저장
  -> Ctrl+F5 또는 browser reopen
  -> 동일 game account 선택
  -> 동일 entity/deck 재조회
```

새 browser state에서 DATA API를 다시 읽으므로 단순 toast보다 강한 증거다.

## 16.2 Backend truth

현재 운영자 최종 확인 경로:

```text
Cloudflare Dashboard
  -> D1
  -> nakwol-data
  -> Console
```

또는:

```bash
cd services/data
npx wrangler d1 execute DB --remote --command "SELECT ..."
```

핵심 table:

```text
game_accounts
user_generals
user_tactics
user_equipment
decks
deck_general_slots
deck_tactic_slots
deck_snapshots
```

manual SQL UPDATE/DELETE는 정상 운영 흐름으로 사용하지 않는다.

---

# 17. 각 Stage의 Git/PR 규칙

정상 흐름:

```text
feature/fix/docs -> dev -> main -> stable
```

- long-lived branch direct push 금지
- feature/fix branch는 current `dev`에서 시작
- 각 Stage는 별도 PR
- fresh CI green 후 merge
- `dev -> main -> stable`은 merge commit 사용하여 ancestry 보존
- production deploy trigger가 필요한 Stage만 명시적으로 갱신
- ancestry reconciliation이 필요하면 runtime change와 분리

DB migration이 포함되는 Stage는 production deploy 전에 반드시 remote preflight/CI evidence를 남긴다.

---

# 18. Definition of Done — Hardening v1 전체

다음이 모두 만족돼야 완료다.

## Server/Data

- duplicate general server rejection
- duplicate equipment server rejection
- deterministic error code
- invalid replace atomic
- existing ownership/type/canonical validation regression 없음
- production duplicate preflight clean 또는 명시적 remediation 완료
- D1 unique constraints 적용

## My Data

- owned-first default
- research mode explicit
- duplicate UI guard
- existing research deck 보존
- 모든 supported mutation에 read-after-write confirmation
- 저장 상태 문구 구분

## DATA Ops

- admin-only
- developer-only privilege 불가
- arbitrary-user read-only search/detail
- no mutation/impersonation
- safe raw JSON
- audit log

## Verification

- AUTH Verify GREEN
- DATA Verify GREEN
- Repository Governance GREEN
- production deploy GREEN
- production manual H/P/M/O matrix PASS
- Registry counts/user data preservation 확인

---

# 19. Hardening 완료 후 다음 단계

이 문서의 DoD가 production에서 PASS한 뒤 원래 User Data Platform 계획으로 복귀한다.

다음은:

```text
AccountPicker
DeckPicker
My Data launcher
```

그리고 실제 서로 다른 consumer 두 곳에서:

```text
My Data에서 deck X 저장
  -> consumer A에서 X 선택
  -> consumer B에서도 같은 deck.id X 선택
  -> My Data에서 X 수정
  -> 두 consumer가 같은 변경값 재조회
```

production E2E를 수행한다.

---

# 20. 구현 시작점

이 문서가 `dev`에 병합된 직후 첫 작업은 정확히 하나다.

```text
Stage 1 + Stage 2
Branch: fix/data-deck-composition-integrity
```

먼저 duplicate general/equipment와 atomicity RED tests를 추가하고, 같은 PR에서 DATA server validation을 GREEN으로 만든다.

DB migration은 그 PR에 넣지 않는다.

그 다음 production duplicate preflight를 수행한 후 Stage 4로 넘어간다.
