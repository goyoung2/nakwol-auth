# CODEX HANDOFF — NAKWOL AUTH / CONNECT / DATA

Last updated: 2026-09-01
Repository: `goyoung2/nakwol-auth`

## Read this first

새 작업은 다음 순서로 문맥을 복구한다.

1. `CODEX_HANDOFF.md`
2. `BRANCHING.md`
3. 현재 작업의 단일 authoritative development SSOT
4. 실제 component code/package/CI/production evidence
5. `DATA.md`, `CONNECT.md`, `CONNECT_CLI.md`, `WEB_SDK.md`

현재 My Data Hardening v1의 유일한 개발 기준 문서:

```text
docs/superpowers/2026-09-01-nakwol-my-data-hardening-v1.md
```

오래된 release/handoff 문구보다 실제 branch tree, package, CI, production evidence를 우선한다.

---

## Branch governance

정상 흐름:

```text
feature/fix/chore/docs -> dev -> main -> stable -> component release
```

- default branch: `dev`
- dev/main/stable are long-lived
- dev, main, stable 장기 브랜치는 항상 보존한다.
- delete merged head branches: disabled
- long-lived branch direct push/force-push 금지
- GitHub Free private repository라 native Branch Protection은 현재 unavailable/not active
- Repository Governance CI와 stable promotion guard가 release/deploy provenance를 fail-closed로 검사

Hotfix:

```text
stable -> hotfix/* -> stable -> main -> dev
```

과거 squash promotion 때문에 ancestry가 실제 content와 다르게 보일 수 있다. content/tree를 먼저 확인하고 필요하면 content-zero ancestry reconciliation을 사용한다. runtime 변경을 ancestry 해결에 섞지 않는다.

---

## Current long-lived branch state

2026-09-01 My Data CRUD + browser async-form fix 기준:

- `dev`: My Data CRUD baseline + hardening documentation
- `main`: My Data CRUD production candidate history
- `stable`: My Data CRUD production

long-lived branches는 동일 runtime content를 의도하며 SHA 차이는 merge history 때문에 발생할 수 있다.

---

## AUTH current state

- runtime: **AUTH 0.2.0**
- formal release: `auth-v0.2.0`
- formal release target: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- formal release deploy: `33373705515`
- formal release Worker Version ID: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- final release smoke: `33373908231`
- component release workflow: `33374685878`

현재 AUTH 제품 경계:

- Discord OAuth
- central SSO
- Authorization Code + PKCE(S256)
- exact redirect allowlist
- app-bound access token
- `/me`
- Account Center
- Identity UI
- privileged AUTH Lab
- pinned Web SDK v0.1 compatibility asset
- immutable SDK v0.2 asset

My Data용 `nakwol-my-data` AUTH app도 production에 등록되어 있다.

AUTH Lab V1 through V12 completed. V8-B live Discord role mutation remains an approved external-authority waiver and is not an AUTH v0.2 release blocker.

AUTH protocol/release 작업을 My Data hardening과 섞지 않는다.

---

## Connect current state

- **NAKWOL Connect 0.4.0**
- npm published
- Universal Embed
- app registration/device authorization
- DATA scope automation
- DATA OpenAPI discovery
- browser `window.NAKWOL_CONNECT.data`

High-level Data SDK Phase 1은 완료되어 production Connect runtime에서 다음 namespace를 제공한다.

```text
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

기존 low-level `data.request()` / `data.fetch()` / `data.describe()` / `data.openapi()` compatibility도 유지한다.

---

## DATA current state

- runtime: **DATA 0.9.0**
- schema: **3**
- origin: `https://nakwol-data.sepsd21.workers.dev`
- OpenAPI: `/openapi.json`
- AUTH verification: Worker Service Binding `AUTH_SERVICE -> nakwol-auth`
- AUTH D1 / DATA D1 직접 결합 없음

DATA scopes:

```text
profile:read
profile:write
roster:read
roster:write
equipment:read
equipment:write
decks:read
decks:write
```

Current user-data support:

- game account: C/R
- owned generals: C/R/U/D
- owned tactics: C/R/U/D
- equipment instances: C/R/U/D
- live decks: C/R/U/D
- deck composition replace
- immutable snapshots: C/R
- Registry: generals/tactics/equipment/stats/formations/warbooks/equipment traits

Known gaps:

- game account U/D 없음
- snapshot U/D 없음; Update 부재는 immutable design과 일치
- snapshot alliance/public metadata는 있지만 current list/detail owner-only
- equipment trait canonical applicability = 0
- detailed loadout fields(진형/병서/병종/스탯 분배)은 아직 storage contract 미확정

근거 없는 게임 규칙/장비 applicability를 추측하여 DATA write로 허용하지 않는다.

---

## Historical formal DATA v0.8 release baseline

이 섹션은 historical release evidence이며 현재 runtime을 뜻하지 않는다.

- **DATA 0.8.0**
- schema 3
- tag: `data-v0.8.0`
- historical Worker Version ID: `2bea00a2-c4b1-4f8c-a521-8c64f18f10be`
- exact production deploy commit: `5cfe6c7511be8c2e90d98dfe10d85d7b57f49d61`
- release workflow: `33157010443`
- release notes: `docs/releases/2026-08-27-nakwol-data-v0.8.md`

이 기록은 현재 production DATA 0.9.0을 downgrade하지 않는다.

---

## DATA Lab production E2E — completed

2026-09-01 실제 production DATA Lab 수동 smoke 최종 PASS:

```text
CRUD smoke 완료
장수·전법·장비·덱 C/R/U/D와 덱 composition PUT 확인
```

검증 경로:

```text
browser -> AUTH -> app-bound token -> DATA Worker -> AUTH Service Binding -> DATA D1 -> browser
```

수동 E2E에서 실제 발견/수정한 production mismatch:

1. Data Lab canonical tactic selector vs public Registry projection
2. tactic write validator vs production Registry projection

따라서 DATA core CRUD는 mock/code-only가 아니라 production user path로 검증된 상태다.

---

## User Data Platform Phase 1 — High-level Data SDK — completed

완료:

- accounts
- roster generals/tactics
- equipment
- decks/composition
- snapshots
- Registry helpers

실제 runtime path/method/body/header/error propagation tests를 거쳐 production 배포됨.

---

## User Data Platform Phase 2 — NAKWOL My Data — completed to CRUD baseline

Production surface:

```text
https://nakwol-data.sepsd21.workers.dev/my-data
client_id: nakwol-my-data
```

현재 사용자 기능:

- central SSO/login
- game account list/create/select
- account overview counts
- general management
- tactic management
- equipment instance management
- deck management
- deck composition editor
- research/deck-first Registry selection

My Data CRUD production deploy 이후 browser async submit form reference 위험도 추가 fix했다.

Latest production DATA evidence:

- deploy workflow: `33478274558`
- DATA Worker Version ID: `7d6e4d94-6656-4739-bd1e-c86377b3811a`
- DATA tests in deploy: 91/91 PASS
- Registry counts preserved
- `nakwol-my-data` 8 scopes verified
- production `/my-data` HTTP verification PASS

---

# CURRENT PRIORITY — My Data Hardening v1

공통 DeckPicker를 만들기 전에 My Data/DATA storage를 한 번 더 단단히 한다.

**Single authoritative development SSOT:**

```text
docs/superpowers/2026-09-01-nakwol-my-data-hardening-v1.md
```

이전 split hardening spec/plan은 폐기하고 위 한 문서만 구현 기준으로 사용한다.

고정 구현 순서:

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
Stage 10 Hardening close -> DeckPicker
```

첫 구현 branch:

```text
fix/data-deck-composition-integrity
```

첫 PR에는 Stage 1 + Stage 2만 넣는다. DB migration은 넣지 않는다.

---

## Current known integrity issue

현재 `deck_general_slots`는 `(deck_id, position)`만 primary key이고 same-deck `general_id`, `weapon_instance_id`, `mount_instance_id` uniqueness를 DB가 강제하지 않는다.

server도 equipment ownership/type은 확인하지만 same-deck duplicate instance/general은 hardening 대상이다.

DB index migration 전에 production duplicate preflight를 수행하고 bad row가 있으면 자동 삭제하지 않는다.

---

## Current persistence verification

DATA Ops가 아직 없으므로 지금 저장 확인 방법은 두 단계다.

### User-level

```text
My Data 저장
-> Ctrl+F5 / browser reopen
-> 같은 account/deck 재조회
-> 동일 값 확인
```

### Backend-level

Cloudflare `nakwol-data` D1 Console 또는:

```bash
cd services/data
npx wrangler d1 execute DB --remote --command "SELECT ..."
```

으로 `game_accounts`, `user_generals`, `user_tactics`, `user_equipment`, `decks`, `deck_general_slots`, `deck_tactic_slots` persisted rows를 직접 확인한다.

manual SQL UPDATE/DELETE를 정상 운영 흐름으로 사용하지 않는다.

---

## Future loadout fields — do not implement by guess

후속 요구:

- 장수 스탯 분배
- 병종
- 진형
- 병서
- 장비 특성/options

각 필드는 먼저:

```text
canonical Registry
data ownership level
slot/cardinality
duplicate rules
season behavior
snapshot freeze boundary
```

를 확정한 후 schema/API/UI에 반영한다.

`deck_settings`에 검증 없는 opaque JSON을 먼저 쌓지 않는다.

---

## Verification commands

Root:

```bash
npm install --legacy-peer-deps
npm test
npm run typecheck
npx wrangler deploy --dry-run --outdir .dry-run
```

DATA:

```bash
cd services/data
npm install --legacy-peer-deps
npm test
npm run typecheck
npm run bundle
```

PR에서는 Repository Governance와 관련 component verify가 모두 green인지 확인한다.

My Data / DATA Ops / shared Data UI는 자동 테스트만으로 완료 처리하지 않고 production browser E2E를 포함한다.

---

## Do not accidentally do these

- AUTH v0.2 formal release를 다시 수행하지 않는다.
- pinned Web SDK v0.1 asset을 수정하지 않는다.
- consumer app끼리 access token/sessionStorage를 공유하지 않는다.
- read-only consumer에 write scope를 자동 추가하지 않는다.
- Data Lab을 arbitrary-user admin viewer로 바꾸지 않는다.
- DATA Ops에 active developer-only privilege를 허용하지 않는다.
- DATA Ops v1에 arbitrary user mutation을 추가하지 않는다.
- Registry reseed에서 user-owned rows를 delete/truncate하지 않는다.
- duplicate production rows가 발견됐을 때 자동으로 한 row를 선택/삭제하지 않는다.
- evidence 없는 tactic/equipment/game rules를 추측하여 validator에 넣지 않는다.
