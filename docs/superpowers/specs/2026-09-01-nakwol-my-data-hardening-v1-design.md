# NAKWOL My Data Hardening v1 — Integrity, Verification & Ops Specification

Status: approved direction; implementation pending
Date: 2026-09-01
Repository: `goyoung2/nakwol-auth`
Base: `dev`
Parent architecture: `docs/superpowers/specs/2026-09-01-nakwol-user-data-platform-v1-design.md`

## 1. Purpose

NAKWOL User Data Platform의 핵심 저장 경로는 이미 production에서 동작한다.

현재 확인된 기반:

- NAKWOL DATA 0.9.0 / schema 3
- high-level Connect Data SDK
- NAKWOL My Data
- game account C/R
- owned general C/R/U/D
- owned tactic C/R/U/D
- equipment instance C/R/U/D
- live deck C/R/U/D
- deck composition PUT
- production refresh persistence

따라서 이 문서의 목표는 CRUD 기능을 다시 만드는 것이 아니다.

목표는 다음 단계로 넘어가기 전에 사용자 데이터 플랫폼을 **신뢰할 수 있는 저장 기반**으로 만드는 것이다.

핵심 원칙:

> **UI가 잘못된 편성을 만들더라도 서버가 잘못된 상태를 저장해서는 안 되며, 저장 성공은 다시 읽어서 확인할 수 있어야 하고, 운영자는 별도의 안전한 read-only 도구로 실제 production DATA를 검증할 수 있어야 한다.**

이 hardening 단계는 공통 `DeckPicker` / 소비자 서비스 연동보다 먼저 완료한다.

---

## 2. Current observations

2026-09-01 My Data 수동 확인에서 다음 UX/무결성 문제가 확인되었다.

### 2.1 Deck editor가 전체 Registry를 기본 노출

현재 덱 편성은 deck-first research 흐름을 지원하기 위해 Registry의 모든 사용 가능한 장수/전법을 선택할 수 있다.

이 기능 자체는 유지할 가치가 있지만, 일반 사용자의 기본 기대는 다음과 다르다.

```text
"내 덱 편성"
  -> 기본적으로 내가 보유 등록한 장수/전법이 보임
```

따라서 research capability와 daily-use default를 분리해야 한다.

### 2.2 동일 장비 인스턴스를 한 덱의 여러 슬롯에 중복 배치 가능

`user_equipment.id`는 하나의 실제 장비 인스턴스를 의미한다.

따라서 다음 상태는 허용해서는 안 된다.

```text
deck X
  position 1 -> weapon eqp_123
  position 2 -> weapon eqp_123
```

다른 live deck에서 동일 장비 인스턴스를 참조하는 것은 프리셋/설계 데이터이므로 허용할 수 있다.

```text
deck A -> eqp_123
deck B -> eqp_123
```

금지 범위는 **동일 deck 내부**다.

현재 `deck_general_slots`는 `(deck_id, position)`만 primary key이며 `weapon_instance_id` / `mount_instance_id`에 deck-local unique constraint가 없다.

### 2.3 동일 장수가 같은 덱의 여러 position에 들어갈 수 있는 경로

`position` 중복은 현재 validator가 막지만 `general_id` 중복은 별도 invariant로 강제되지 않는다.

NAKWOL deck composition의 의미상 같은 장수 ID가 한 덱의 두 position을 동시에 점유하는 상태는 허용하지 않는다.

### 2.4 아직 확정하지 않을 게임 규칙

다음 항목은 게임 규칙 근거를 확정하기 전까지 hardening invariant로 추측하지 않는다.

- 동일 전법을 한 덱의 여러 장수에게 동시에 배치 가능한지
- 장수 스탯 분배가 account-owned general 상태인지 deck loadout 상태인지
- 병종 설정의 정확한 소유 단위
- 병서의 정확한 slot/제약 규칙
- 진형과 장수 position 간 추가 제약
- 장비 특성 applicability

근거가 부족한 규칙은 UI나 server validator가 임의로 만들지 않는다.

---

## 3. Hardening scope

v1 hardening은 네 축이다.

1. **Server-side integrity** — 잘못된 composition 저장 차단
2. **My Data owned-first UX** — 일반 사용자 기본 흐름 개선
3. **Persistence verification** — write 성공과 server truth 재조회 연결
4. **NAKWOL DATA Ops** — 관리자용 production read-only 검증 surface

다음은 이 hardening v1의 범위 밖이다.

- 장수 스탯 분배 모델 확정
- 진형/병서/병종 구현
- screenshot/video import
- shared DeckPicker 구현
- alliance/public snapshot access 확대
- arbitrary admin mutation

---

# Part A — Server-side composition integrity

## 4. Source-of-truth rule

무결성은 My Data UI만으로 보장하지 않는다.

모든 consumer가 low-level REST 또는 high-level SDK를 통해 같은 DATA API에 접근할 수 있으므로 최종 invariant는 `PUT .../composition` server path가 강제한다.

UI validation은 사용자에게 빠른 피드백을 주기 위한 보조층이다.

```text
UI validation
   +
DATA domain validation
   +
D1 constraint where safe
```

세 층을 사용한다.

## 5. Mandatory composition invariants

### 5.1 Unique position

이미 존재하는 규칙 유지.

- position: 1..3
- 같은 position 중복 금지

### 5.2 Unique general within a deck

한 deck 안에서 같은 `general_id`는 최대 한 position에만 존재한다.

실패 code 제안:

```text
DUPLICATE_GENERAL_IN_DECK
```

### 5.3 Unique equipment instance within a deck

한 deck 안에서 동일 `user_equipment.id`는 한 번만 참조할 수 있다.

weapon과 mount type validation은 기존처럼 별도로 유지한다.

실패 code 제안:

```text
DUPLICATE_EQUIPMENT_IN_DECK
```

검사는 request body 전체를 기준으로 먼저 수행한다.

### 5.4 Account ownership

기존 규칙 유지.

- equipment instance는 해당 game account 소유여야 한다.
- 다른 account의 equipment ID 참조 금지.

### 5.5 Equipment type

기존 규칙 유지.

- `weapon_instance_id` -> weapon only
- `mount_instance_id` -> mount only

### 5.6 General/tactic Registry validity

기존 canonical validation 유지.

- general은 enabled/playable Registry row
- tactic은 DATA가 인정하는 canonical ownable tactic

### 5.7 Atomic replacement

composition validation 중 하나라도 실패하면 기존 composition은 그대로 유지되어야 한다.

부분 delete / 부분 insert가 남아서는 안 된다.

테스트에서 반드시 old composition을 저장한 뒤 invalid replacement를 시도하고, 실패 후 old composition이 byte/semantic equivalent인지 확인한다.

---

## 6. Database constraints

Server validation만으로 끝내지 않고 가능한 invariant는 D1에도 반영한다.

후보:

```sql
CREATE UNIQUE INDEX ... ON deck_general_slots(deck_id, general_id);

CREATE UNIQUE INDEX ...
ON deck_general_slots(deck_id, weapon_instance_id)
WHERE weapon_instance_id IS NOT NULL;

CREATE UNIQUE INDEX ...
ON deck_general_slots(deck_id, mount_instance_id)
WHERE mount_instance_id IS NOT NULL;
```

단, production migration은 기존 bad row 여부를 확인하기 전에는 추가하지 않는다.

migration 전 preflight:

```text
1. duplicate general scan
2. duplicate weapon instance scan per deck
3. duplicate mount instance scan per deck
4. count/report only
5. bad row가 0일 때 unique index migration
```

기존 bad row가 발견되면 자동 삭제/자동 winner 선택을 하지 않는다.

운영자가 해당 deck을 확인하고 명시적으로 수정한 뒤 migration한다.

---

# Part B — My Data owned-first UX

## 7. Default selector behavior

My Data의 일반적인 deck edit 기본값은 owned-first다.

### 7.1 General selector

기본:

```text
내 보유 장수만
```

옵션:

```text
[ ] 전체 Registry 표시 (연구용)
```

전체 Registry mode에서 owned가 아닌 장수는 명확하게 표시한다.

```text
곽가        보유
관우        미등록 · 연구용
```

### 7.2 Tactic selector

동일 원칙.

기본은 owned tactics.

전체 Registry mode에서는 canonical ownable tactic만 표시하고 `미등록 · 연구용` 상태를 명확히 한다.

### 7.3 Equipment selector

equipment은 instance 기반이므로 항상 현재 account의 owned instances만 표시한다.

Registry template 전체를 deck composition에서 직접 선택하지 않는다.

### 7.4 Duplicate prevention in UI

한 slot에서 선택된 equipment instance는 다른 slot selector에서 disabled/hidden 처리한다.

같은 general도 다른 position selector에서 disabled/hidden 처리한다.

단, 이것은 UX guard이며 server validation을 대체하지 않는다.

---

## 8. Research deck behavior

기존 deck-first 원칙은 폐기하지 않는다.

사용자는 전체 roster 등록 없이 research deck을 만들 수 있어야 한다.

권장 UX:

```text
덱 편성
[내 보유만] [전체 Registry · 연구용]
```

또는 `status=research`일 때 전체 Registry mode 진입을 더 쉽게 제공할 수 있다.

하지만 `status=research`가 서버 무결성 우회 수단이 되어서는 안 된다.

중복 장수/동일 equipment instance 같은 structural invariant는 모든 deck status에 동일 적용한다.

---

# Part C — Persistence verification

## 9. Definition of “saved”

UI에서 `저장했습니다`라는 메시지는 단순히 button handler가 끝났다는 뜻이어서는 안 된다.

최소 contract:

```text
mutation request success
  -> server response success
  -> authoritative read
  -> expected entity/revision observed
  -> UI: 저장 확인됨
```

현재 My Data는 대부분 mutation 뒤 account data를 다시 읽는 흐름을 갖고 있다. hardening에서는 이 원칙을 명시적인 계약으로 고정한다.

## 10. Read-after-write checks

### General / tactic

upsert 후 list 또는 detail-equivalent read에서 다음을 확인한다.

- ID 존재
- breakthrough
- promotion where applicable
- favorite
- note
- updated_at

### Equipment

create/update 후 list에서 exact instance ID를 확인한다.

### Deck

create/update 후 `decks.get(accountId, deckId)`로 current metadata 확인.

### Composition

replace 후 `decks.get(...)`에서 composition을 재조회하여 normalized payload와 비교한다.

### Delete

delete 후 list/detail에서 absence 확인.

## 11. UI state

권장 상태:

```text
저장 중
저장 확인됨 · 16:24:31
동기화 실패
```

`저장 요청 성공`과 `재조회 성공`을 구분할 수 있어야 한다.

재조회가 실패하면 write 성공 가능성을 숨기지 않는다.

예:

```text
저장 요청은 성공했지만 재확인에 실패했습니다. 새로고침해 확인하세요.
```

---

# Part D — Operator verification

## 12. Current state: no user DATA admin console

현재 DATA Worker의 운영 surface는 다음 두 개다.

- `/lab` — privileged production CRUD diagnostic, current signed-in user 기준
- `/my-data` — 일반 사용자의 자기 데이터 관리

임의의 NAKWOL user / game account를 검색해서 DATA 내용을 읽는 관리자 페이지는 현재 존재하지 않는다.

Connect Admin은 AUTH/Connect app/developer 관리 영역이며 user DATA inspection 도구로 사용하지 않는다.

Data Lab 역시 arbitrary-user impersonation 도구로 확장하지 않는다.

---

## 13. NAKWOL DATA Ops v1

별도 read-only 운영 surface를 만든다.

가칭:

```text
https://nakwol-data.sepsd21.workers.dev/ops
client_id = nakwol-data-ops
```

### 13.1 Authorization

`nakwol-data-ops`는 AUTH internal app이며 `access_policy=admin`을 사용한다.

중요:

- `lab` policy 사용 금지
- active Connect developer라는 이유만으로 접근 허용 금지
- 일반 DATA read/write scope만으로 Ops 접근 불가
- exact `nakwol-data-ops` app binding 필요
- runtime에서 admin 권한을 재확인할 수 있는 방어층을 둔다

### 13.2 v1 is read-only

Ops v1에서 금지:

- 사용자 대신 edit
- arbitrary delete
- arbitrary write
- token impersonation
- 사용자 access token 표시

목적은 검증/진단이다.

### 13.3 Search keys

최소 지원:

- game account ID (`gac_*`)
- NAKWOL DATA user ID
- exact/partial game nickname
- server code

검색 결과는 최소 정보만 보여준다.

### 13.4 Account detail

선택한 game account에 대해:

```text
Account
  id
  nickname
  server_code
  primary
  created_at / updated_at

Owned generals
Owned tactics
Equipment instances
Live decks
Deck composition
Snapshots summary
```

Registry raw metadata 전체 덤프는 기본 화면에 노출하지 않는다.

### 13.5 JSON inspection

운영 진단용 `raw JSON` view는 허용하되 access token/secret은 포함하지 않는다.

---

## 14. Ops audit log

arbitrary user DATA를 운영자가 열람하는 기능은 audit 가능해야 한다.

최소 기록:

```text
operator_user_id
target_user_id
target_account_id
action
request_id
created_at
```

예:

```text
VIEW_ACCOUNT
VIEW_DECK
SEARCH_ACCOUNT
```

Ops audit는 일반 사용자 DATA와 별도 table로 둔다.

v1에서 audit row를 사용자에게 노출할 필요는 없지만, 운영자가 조회 가능해야 한다.

---

# Part E — Future loadout model

## 15. Known future requirements

사용자가 언급한 실제 deck 정보에는 현재 composition보다 더 많은 상태가 필요하다.

후속 후보:

- 장수 스탯 분배
- 병종
- 진형
- 병서
- 장비 옵션/특성
- 시즌별 loadout 차이

현재 schema에는 `deck_settings(settings_json)`가 존재하지만, 임의 JSON bag처럼 무제한 확장하지 않는다.

## 16. Ownership decision before schema

각 필드는 먼저 어느 domain에 속하는지 확정한다.

예:

| 항목 | 후보 ownership | 구현 전 필요한 확인 |
|---|---|---|
| 진형 | deck-level | formation Registry와 실제 선택 규칙 |
| 병종 | deck slot/general loadout | 장수별/덱별 변경 가능 여부 |
| 병서 | deck slot/general loadout | slot 수, 중복/해금 규칙 |
| 스탯 분배 | owned general 또는 deck loadout | 게임에서 loadout마다 변경 가능한지 |
| 장비 특성 | equipment instance | canonical applicability evidence |

확정 전에는 storage field를 추측해서 만들지 않는다.

## 17. Versioned settings

`deck_settings`를 사용할 경우 최소 다음을 둔다.

```json
{
  "settings_version": 1,
  "...confirmed fields only": "..."
}
```

parser/validator 없는 opaque JSON write endpoint는 만들지 않는다.

---

# Part F — Acceptance criteria

## 18. Integrity acceptance

다음이 production에서 확인되어야 한다.

```text
I1 same general twice in one deck -> rejected
I2 same weapon instance twice in one deck -> rejected
I3 same mount instance twice in one deck -> rejected
I4 invalid replacement -> old composition unchanged
I5 cross-account equipment -> rejected
I6 weapon/mount type mismatch -> rejected
I7 valid composition -> saved and read-back equal
```

## 19. My Data acceptance

```text
U1 deck editor default = owned general/tactic
U2 explicit research/Registry mode exists
U3 selected general disabled in other positions
U4 selected equipment instance disabled in other slots
U5 save -> authoritative re-read -> confirmed state
U6 refresh/browser reopen preserves same data
```

## 20. Ops acceptance

```text
O1 admin can open DATA Ops
O2 non-admin member denied
O3 active Connect developer without admin role denied
O4 operator can search account and inspect stored roster/equipment/decks
O5 Ops cannot mutate user DATA
O6 every user-data inspection creates audit evidence
O7 no access token/secret appears in HTML, JSON, log
```

---

## 21. Production truth hierarchy

문제 발생 시 다음 순서로 truth를 판단한다.

```text
1. D1 persisted rows
2. DATA API authenticated read
3. high-level Data SDK result
4. My Data rendered state
5. success toast/message
```

성공 메시지는 가장 낮은 수준의 증거다.

최종 저장 확인은 authenticated read 또는 Ops/D1 persisted row로 한다.

---

## 22. Exit condition

이 hardening 단계는 다음 상태에서 완료로 본다.

> My Data가 잘못된 structural deck 상태를 만들기 어렵고, DATA server가 그것을 최종적으로 거부하며, 모든 정상 write가 read-after-write로 재확인되고, NAKWOL admin이 별도 read-only DATA Ops에서 production persisted state를 검증할 수 있다.

이 exit condition 이후 User Data Platform v1의 `AccountPicker / DeckPicker / My Data launcher` 단계로 진행한다.
