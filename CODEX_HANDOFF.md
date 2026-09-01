# CODEX HANDOFF — NAKWOL AUTH / CONNECT / DATA

Last updated: 2026-09-01
Repository: `goyoung2/nakwol-auth`

## Read this first

새 작업은 다음 순서로 문맥을 복구한다.

1. `CODEX_HANDOFF.md`
2. `BRANCHING.md`
3. 현재 작업의 `docs/handoffs/*`
4. 관련 `docs/superpowers/specs/*` 및 `docs/superpowers/plans/*`
5. 실제 component code/package/CI/production evidence
6. `DATA.md`, `CONNECT.md`, `CONNECT_CLI.md`, `WEB_SDK.md`

오래된 release/handoff 문구보다 실제 branch tree, package, CI, production evidence를 우선한다.

---

## Authoritative branch model

정상 흐름:

```text
feature/fix/chore/docs -> dev -> main -> stable -> component release
```

- default branch: `dev`
- `dev`, `main`, `stable`은 유지되는 long-lived branch
- long-lived branch direct push/force-push 금지
- GitHub Free private repository 특성상 native Branch Protection 대신 Repository Governance CI 계약을 사용

Hotfix:

```text
stable -> hotfix/* -> stable -> main -> dev
```

과거 squash promotion 때문에 ancestry가 끊겨 GitHub가 실제 content보다 큰 divergence를 보일 수 있다. content/tree를 먼저 확인하고, 필요하면 content-zero ancestry reconciliation을 사용한다. runtime 변경을 ancestry 문제 해결에 섞지 않는다.

---

## Current long-lived branch state

2026-09-01 User Data Platform 문서 작업 시작 직전 기준:

- `dev`: `acdf3924616c2b779f580c146848606c347640ec`
- `main`: `266c8dbaabbb4511c8afa27c62e15e149bd206d0`
- `stable`: `6aef40adf903ec32f35dd7e5553c110ce397f557`

`dev/main`은 현재 DATA tactic write projection fix의 같은 runtime tree를 포함한다.
`stable`은 같은 runtime fix + production deploy trigger flag 변경을 포함한다.

기능 차이와 deploy-only flag 차이를 구분한다.

---

## AUTH current state

- runtime version: **AUTH 0.2.0**
- formal component release: **`auth-v0.2.0` released**
- formal release target: `154baf448ee45a7b2bcf6e320f09a65866e1f8af`
- formal release deploy evidence: workflow `33373705515`
- formal release Worker version evidence: `b3540665-6d2a-4f85-a61f-4dbfb8837cad`
- formal final smoke: `33373908231`
- component release workflow: `33374685878`

AUTH v0.2 formal release 이후 DATA Lab용 OAuth app/client 등록을 위해 AUTH가 추가 production deploy되었다.

현재 AUTH 제품 경계:

- Discord OAuth
- central SSO
- Authorization Code + PKCE(S256)
- exact redirect allowlist
- app-bound access token
- `/me`
- Compact Identity Menu
- `/account`
- privileged AUTH `/lab`
- pinned Web SDK v0.1 compatibility asset 유지
- immutable SDK v0.2 asset 유지

AUTH Lab V1–V12 release matrix는 완료 상태다. V8-B live Discord role mutation만 approved external-authority waiver이며 AUTH v0.2 release blocker가 아니다.

AUTH protocol/release work를 User Data Platform 작업과 섞지 않는다.

---

## Connect current state

- **NAKWOL Connect 0.4.0**
- npm publish 완료
- Universal Embed
- app registration / device authorization
- DATA scope automation
- `data describe --json`
- DATA OpenAPI 3.1 discovery
- browser runtime `window.NAKWOL_CONNECT.data`
- low-level `data.request()` / `data.fetch()`
- Registry convenience helpers

현재 개발자 UX의 가장 큰 다음 gap은 user-owned CRUD가 여전히 REST path 기반이라는 점이다.

다음 product phase에서 high-level Data SDK를 추가한다.

---

## DATA current state

- runtime version: **DATA 0.9.0**
- schema: **3**
- origin: `https://nakwol-data.sepsd21.workers.dev`
- OpenAPI: `/openapi.json`
- AUTH verification: Worker Service Binding `AUTH_SERVICE -> nakwol-auth`
- AUTH D1 / DATA D1 직접 결합 없음

Current DATA scopes:

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

- game account: Create / Read
- owned generals: C/R/U/D
- owned tactics: C/R/U/D
- equipment instances: C/R/U/D
- live decks: C/R/U/D
- deck composition replace
- immutable snapshots: Create / Read
- Registry: generals/tactics/equipment/stats/formations/warbooks/equipment traits

Current known API gaps relevant to user-facing My Data:

- game account Update/Delete 없음
- snapshot Update/Delete 없음 (Update 부재는 immutable design과 일치)
- snapshot alliance/public metadata는 있으나 current list/detail은 owner-only
- equipment trait canonical applicability는 authoritative evidence가 없어 0 유지

Generic stats/equipment applicability를 추측하여 쓰기 허용하지 않는다.

---

## DATA Lab production E2E — completed

2026-09-01 사용자가 실제 production DATA Lab에서 CRUD smoke를 수동 실행했고 최종:

```text
CRUD smoke 완료
장수·전법·장비·덱 C/R/U/D와 덱 composition PUT을 실제 DATA API에서 확인
```

까지 PASS했다.

실제 검증 범위:

- AUTH + DATA principal
- game account C/R
- Registry general/tactic/equipment reads
- general Create/Read/Update/Delete + read-back
- tactic Create/Read/Update/Delete + read-back
- equipment Create/Read/Update/Delete + read-back
- deck Create/Read/Update/Delete + read-back
- deck composition PUT
- cleanup

수동 E2E는 코드/단위테스트가 잡지 못한 두 문제를 실제로 발견했다.

### Fix 1 — Data Lab canonical tactic selector

첫 smoke는 Registry 조회 후:

```text
CRUD smoke에 사용할 canonical Registry 항목을 선택하지 못했습니다.
```

으로 중단됐다.

원인:

- raw seed tactic metadata field와 public Registry projection field를 Lab이 혼동

수정:

- PR #79
- stable production path #82 + deploy trigger #83

### Fix 2 — production tactic write validator

두 번째 smoke는 general C/R/U까지 PASS 후 tactic Create에서:

```text
TACTIC_NOT_FOUND
```

으로 실패했다.

원인:

- production Registry/D1 metadata는 projected field names를 저장
- DATA write validator는 raw source field names만 판정

수정:

- PR #84 -> dev
- PR #85 -> main
- ancestry-safe stable promotion #87
- guarded deploy hotfix #88

최종 production DATA deploy:

- stable deploy trigger head: `6aef40adf903ec32f35dd7e5553c110ce397f557`
- workflow: `33468253146` — success
- DATA Worker Version ID: `048d713c-0387-402d-afe0-1691fa0f8fb3`
- DATA tests in deploy: 80/80 PASS
- production health/schema/OpenAPI/Lab verification: PASS

이후 사용자가 CRUD smoke 전체 PASS를 직접 확인했다.

따라서 DATA core CRUD는 더 이상 "code only" 상태가 아니다. 실제 production user -> AUTH -> DATA Worker -> D1 -> browser 왕복이 검증되었다.

---

## DATA safety boundary

User-owned generals, tactics, equipment, decks는 permanent account assets다.

Registry seed/reseed는 UPSERT 중심이며 user data를 DELETE/TRUNCATE하지 않는다.

production test에서 cleanup 가능한 명시적 test rows만 정리한다.

snapshot처럼 delete가 없는 불변 데이터를 자동 smoke에서 무분별하게 만들지 않는다.

---

# Current product direction — NAKWOL User Data Platform v1

이전 handoff의 `siege-calculator seamless SSO` 단독 우선순위는 **현재 제품 방향으로 superseded**되었다.

현재 공식 다음 방향은:

> **사용자가 한 번 자기 게임/덱 정보를 등록하고, 모든 낙월 서비스가 같은 데이터를 안전하게 재사용하는 User Data Platform을 완성한다.**

Authoritative design:

- `docs/superpowers/specs/2026-09-01-nakwol-user-data-platform-v1-design.md`

Implementation plan:

- `docs/superpowers/plans/2026-09-01-nakwol-user-data-platform-v1.md`

제품은 세 계층으로 구성한다.

```text
NAKWOL My Data
  사용자 중앙 입력/관리 앱
          |
          v
NAKWOL DATA
          |
          +-----------------------+
          |                       |
          v                       v
High-level Data SDK          NAKWOL Data UI
                          AccountPicker / DeckPicker
          |                       |
          +-----------+-----------+
                      |
                      v
               consumer services
```

Consumer examples:

- 덱 전적 확인
- 덱 분석
- 덱 연구/시뮬레이션
- 전투 분석
- 기타 낙월 도구

핵심 UX:

```text
한 서비스에서 덱 등록
 -> NAKWOL DATA 저장
 -> 다른 서비스에서 같은 deck ID 즉시 재사용
```

---

## Product principles for User Data Platform

1. **Enter once, reuse everywhere.**
2. 사용자가 서비스마다 같은 roster/deck을 다시 입력하게 만들지 않는다.
3. 사용자 데이터 입력 UI는 NAKWOL 공통 제품으로 만든다.
4. 소비자 개발자는 필요하면 공통 Picker를 쓰고, 원하면 high-level SDK로 자기 UI를 만든다.
5. read-only consumer에 write scope를 주지 않는다.
6. 수정은 기본적으로 별도 `nakwol-my-data` app identity로 수행한다.
7. central SSO는 재사용하되 app token은 공유하지 않는다.
8. live deck과 immutable snapshot을 구분한다.
9. 전적/역사 재현에는 snapshot을 우선 고려한다.
10. screenshot/video/game-share importer는 중앙 My Data에 붙이고 모든 서비스가 결과를 재사용한다.

---

## First implementation task

**Phase 1 — High-level NAKWOL Data SDK**

먼저 현재 low-level:

```js
window.NAKWOL_CONNECT.data.request('/v1/...')
```

위에 다음 high-level namespace를 추가한다.

```js
data.accounts
data.roster.generals
data.roster.tactics
data.equipment
data.decks
data.snapshots
data.registry
```

그 후:

1. `nakwol-my-data` 공식 app + My Data foundation
2. My Data user CRUD UI
3. AccountPicker / DeckPicker / My Data launcher
4. 서로 다른 consumer 두 곳에서 같은 deck 재사용 production E2E
5. 이후 screenshot/video/share-payload import 연구

구현 순서와 Definition of Done은 implementation plan을 따른다.

---

## Verification commands

Repository root:

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

User-facing My Data / Data UI는 자동 테스트만으로 완료 처리하지 않고 production browser E2E를 포함한다.

---

## Do not accidentally do these

- AUTH v0.2 formal release를 다시 수행하지 않는다.
- pinned Web SDK v0.1 asset을 수정하지 않는다.
- consumer app끼리 access token/sessionStorage를 공유하지 않는다.
- My Data write를 위해 read-only consumer에 write scope를 자동 추가하지 않는다.
- Data Lab을 사용자 daily-use UI로 전환하지 않는다.
- Registry seed에서 user-owned rows를 삭제하지 않는다.
- evidence 없는 equipment applicability를 추론하지 않는다.
- screenshot importer가 생겨도 인식 결과를 사용자 확인 없이 canonical user data로 silent write하지 않는다.
