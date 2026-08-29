# NAKWOL AUTH UX v1 — Design Specification

Status: design approved in chat, implementation not started
Date: 2026-08-29
Repository: `goyoung2/nakwol-auth`
Target base: `dev`

## 1. Purpose

NAKWOL AUTH의 인증 코어는 이미 Discord OAuth, NAKWOL ID, membership/role, Authorization Code + PKCE, 앱별 access token, `/me`, SSO, Web SDK, NAKWOL Connect까지 실사용 가능한 수준으로 구축되어 있다.

이번 작업의 목적은 인증 코어를 다시 만드는 것이 아니라, **사용자가 실제 낙월 서비스 안에서 자연스럽게 로그인하고 자신의 계정 상태를 이해하며, 운영자는 인증 시스템 자체를 독립적으로 검증할 수 있는 UX 계층을 추가하는 것**이다.

현재 `https://siege-calculator.pages.dev/`에 시험 연결된 인증 위젯은 기능 검증에는 성공했지만 다음 문제가 있다.

- 로그인 여부와 관계없이 우측 상단에서 비교적 큰 면적을 계속 차지한다.
- `NAKWOL ID`, `로그인하지 않음`, `인증됨: member`, `로그아웃` 같은 기술적/상태적 정보가 항상 노출된다.
- 공성 계산기의 검정·금색·한지 계열 디자인과 인증 위젯의 독립적인 남색/보라색 스타일이 충돌한다.
- 인증 후 사용자가 들어갈 계정 메뉴, 프로필, 연결 서비스, 권한 확인 화면이 없다.
- NAKWOL AUTH 자체를 단독으로 검증할 공식 사용자 페이지와 테스트 페이지가 없다.
- 현재 위젯은 “인증 기능이 붙었다”는 것을 보여주지만 “낙월 플랫폼의 계정 시스템”처럼 느껴지지는 않는다.

NAKWOL AUTH UX v1은 이 문제를 해결한다.

---

## 2. Current baseline — 유지해야 할 것

이 설계는 기존 인증 코어를 교체하지 않는다.

기존 다음 계약은 그대로 유지한다.

- Discord OAuth는 중앙 AUTH Worker가 담당한다.
- 앱은 Discord Client Secret을 보유하지 않는다.
- NAKWOL 내부 사용자 식별자는 Discord ID가 아니라 `usr_...` 형태의 NAKWOL ID다.
- Authorization Code + PKCE(S256), `state` 검증을 유지한다.
- 앱별 `client_id`, redirect URI allowlist, access token을 유지한다.
- `/me`가 현재 사용자와 membership/role을 반환한다.
- 로컬 앱 로그아웃과 global logout을 모두 유지한다.
- 중앙 SSO 세션을 유지한다.
- Web SDK의 headless 사용을 유지한다.
- NAKWOL Connect v0.3의 `init`, `doctor`, DATA scope 자동화 구조를 유지한다.
- AUTH D1과 DATA D1은 직접 결합하지 않는다.
- DATA는 AUTH `/me`를 통해 caller identity를 검증한다.

즉 UX v1은 **인증 프로토콜 변경 프로젝트가 아니라 presentation / account experience / verification layer 프로젝트**다.

관련 현재 문서:

- `WEB_SDK.md`
- `CONNECT.md`
- `CONNECT_CLI.md`
- `CODEX_HANDOFF.md`

---

## 3. Design decision

### 채택안: Hybrid Identity Layer

세 가지 방식 중 Hybrid 방식을 채택한다.

### A. 고정 공통 위젯 강제

모든 낙월 서비스가 동일한 완성형 로그인 위젯을 그대로 사용한다.

장점:
- 가장 구현이 단순하다.
- 모든 사이트에서 모양이 동일하다.

단점:
- 서비스별 디자인과 충돌한다.
- 공성 계산기, 낙월일보, 덱 사이트 등 서로 다른 시각 언어를 가진 서비스에 어울리기 어렵다.
- 현재 시험 위젯의 문제를 반복할 가능성이 높다.

### B. Headless only

AUTH는 인증 API/SDK만 제공하고 모든 서비스가 로그인 UI를 직접 만든다.

장점:
- 디자인 자유도가 가장 높다.

단점:
- 각 서비스마다 동일한 로그인 상태 처리, 메뉴, 접근성, 오류 처리를 반복 구현해야 한다.
- UX 일관성이 무너질 수 있다.
- 코딩 에이전트마다 다른 구현을 만들 위험이 있다.

### C. Hybrid — 채택

AUTH 코어와 headless SDK는 유지하면서 그 위에 **재사용 가능한 NAKWOL Identity UI**를 제공한다. 각 서비스는 기본 컴포넌트를 그대로 사용하거나 테마 변수만 바꾸거나, 필요하면 headless SDK로 완전 커스텀 UI를 만들 수 있다.

구조:

```text
NAKWOL AUTH Core
  Discord / PKCE / SSO / token / me
                |
                v
NAKWOL Web SDK / Connect
                |
        +-------+-------+
        |               |
        v               v
NAKWOL Identity UI     Headless API
        |
        +---- Compact Button/Menu
        +---- Account Center link
        +---- Shared UI states
```

이 구조를 공식 기본값으로 한다.

---

## 4. UX principles

### 4.1 인증은 서비스의 주인공이 아니다

실서비스 안에서 인증 UI는 사용자가 로그인할 때만 눈에 띄면 된다. 로그인 후에는 계정 접근점 역할만 수행한다.

### 4.2 기술 용어를 상시 노출하지 않는다

다음 표현은 일반 서비스 헤더에 항상 보여주지 않는다.

- `NAKWOL ID`
- `로그인하지 않음`
- `인증됨: member`
- raw scope
- raw client ID
- token 상태

이 정보는 Account Center 또는 Auth Lab에서 필요할 때 보여준다.

### 4.3 로그인 상태 UI는 작아야 한다

로그아웃 상태 기본형:

```text
[ 낙월 로그인 ]
```

로그인 상태 기본형:

```text
[ avatar ] 고영 ▾
```

상시 노출 영역은 이 수준을 넘지 않는 것을 기본 원칙으로 한다.

### 4.4 서비스 디자인을 존중한다

NAKWOL Identity UI는 자체 브랜드 스타일을 강제하지 않는다. `inherit` 테마와 CSS custom properties를 지원해 서비스 헤더 안에 자연스럽게 녹아들어야 한다.

### 4.5 상세 정보는 progressive disclosure

사용자 이름을 눌렀을 때 메뉴가 열린다.

예시:

```text
┌────────────────────────┐
│ [avatar] 고영           │
│ 낙월 맹원               │
│                        │
│ 내 낙월 계정            │
│ 이 서비스 권한          │
│ ─────────────────────  │
│ 로그아웃                │
└────────────────────────┘
```

로그아웃은 상시 큰 버튼이 아니라 메뉴 안의 보조 기능으로 이동한다.

### 4.6 인증 UX와 authorization 판단을 분리한다

화면에 `낙월 맹원`이라고 예쁘게 보이는 것과 서버가 실제 접근을 허용하는 것은 별개다. 서비스 접근 제어는 기존 verified membership/role/scope 계약을 그대로 사용한다.

---

## 5. Component 1 — NAKWOL Compact Identity Menu

### 5.1 목적

각 낙월 서비스 헤더에 삽입하는 실서비스용 인증 진입점이다.

현재 시험용 고정 위젯을 대체하는 기본 컴포넌트다.

### 5.2 상태

#### Loading

레이아웃 이동을 최소화하는 작은 skeleton 또는 비활성 계정 아이콘을 사용한다.

#### Logged out

기본:

```text
[ 낙월 로그인 ]
```

선택 compact-icon 모드:

```text
[ 🌙 로그인 ]
```

#### Logged in

```text
[ avatar ] display_name ▾
```

기본 상태에서는 role, NAKWOL ID, token, logout 버튼을 노출하지 않는다.

#### Error

인증 bootstrap 오류가 서비스 전체를 막지 않는 경우 작은 재시도 상태로 표현한다.

```text
[ 로그인 확인 실패 · 다시 시도 ]
```

인증 필수 서비스라면 서비스가 별도의 access gate를 담당한다.

### 5.3 Menu contents

최소 메뉴:

- 사용자 avatar + display name
- 사람이 읽기 쉬운 role label
- `내 낙월 계정`
- `이 서비스 권한`
- `로그아웃`

관리자일 경우에만 선택적으로:

- `AUTH 관리`

### 5.4 Role labels

내부 role 값을 그대로 출력하지 않는다.

기본 매핑:

```text
member -> 낙월 맹원
admin  -> 낙월 관리자
public / non-member -> 일반 사용자
```

서비스가 비회원 접근을 별도 용어로 표현해야 하면 UI label만 override할 수 있다. authorization 의미 자체는 바꾸지 않는다.

`member` 같은 raw string은 Auth Lab에서는 볼 수 있지만 일반 헤더 메뉴 기본 표현으로 사용하지 않는다.

### 5.5 Variants

공식 UI API는 최소 세 가지 variant를 제공한다.

```text
button   로그인 버튼 중심
compact  avatar + name 중심, 기본 권장
menu     독립 메뉴 트리거
```

추가 variant는 실제 수요가 확인되기 전에는 만들지 않는다.

### 5.6 Theme

기본 테마 옵션:

```text
inherit  서비스 CSS를 최대한 상속 — 기본 권장
light
 dark
```

서비스 override용 CSS 변수:

```css
--nakwol-auth-accent
--nakwol-auth-bg
--nakwol-auth-text
--nakwol-auth-muted
--nakwol-auth-border
--nakwol-auth-radius
--nakwol-auth-shadow
```

공성 계산기 예시 방향:

```css
--nakwol-auth-accent: #c89b43;
--nakwol-auth-bg: #111a17;
--nakwol-auth-text: #ead7a5;
--nakwol-auth-border: #8b6a2c;
```

정확한 색상값은 공성 계산기의 실제 CSS token과 맞춰 구현한다. 원칙은 “AUTH가 별도 SaaS 위젯처럼 보이지 않는다”다.

### 5.7 Accessibility

- 키보드로 메뉴 열기/닫기 가능
- ESC로 닫기
- 닫힌 뒤 trigger로 focus return
- avatar에는 의미에 맞는 대체 텍스트 또는 decorative 처리
- 메뉴 항목은 실제 button/link semantic 사용
- 색상만으로 로그인 상태를 전달하지 않음
- 모바일에서 충분한 touch target 확보

### 5.8 Legacy widget policy

현재 Web SDK의 시험용/기존 위젯을 즉시 삭제하지 않는다.

- 기존 버전 고정 SDK URL의 compatibility를 유지한다.
- 기존 widget은 demo/legacy integration 용도로 남길 수 있다.
- 신규 실서비스의 권장 기본값은 Compact Identity Menu로 변경한다.
- 기존 서비스는 검증 후 단계적으로 전환한다.

---

## 6. Component 2 — NAKWOL Account Center

### 6.1 목적

NAKWOL AUTH를 단순 로그인 버튼이 아니라 독립적인 **낙월 통합 계정 시스템**으로 체감하게 만드는 사용자용 중앙 페이지다.

v1 정식 경로:

```text
https://nakwol-auth.sepsd21.workers.dev/account
```

### 6.2 인증 전 상태

`/account`는 로그아웃 사용자에게도 접근 가능하다.

로그아웃 상태에서는 계정 정보를 보여주지 않고 중앙 로그인 CTA를 제공한다.

```text
NAKWOL 계정
낙월 서비스의 통합 로그인입니다.
[ Discord로 낙월 로그인 ]
```

로그인 완료 후 같은 Account Center로 돌아온다.

### 6.3 대상

일반 낙월 사용자.

디버그 도구가 아니다. 기술 용어는 필요한 만큼만 보여준다.

### 6.4 Information architecture

#### A. Profile summary

- Discord avatar
- display name
- 낙월 role label
- 인증 상태
- NAKWOL ID

NAKWOL ID는 복사 가능하되 기본 강조 요소로 만들지 않는다.

#### B. Membership

- Discord guild membership 여부
- 낙월 member 여부
- 현재 role
- 최근 membership 확인 시각 또는 사용자 친화 상태 문구

#### C. Connected services

사용자가 실제로 NAKWOL AUTH를 통해 연결한 근거가 있는 서비스만 표시한다.

source of truth는 AUTH가 이미 보유하거나 구현 단계에서 안전하게 조회할 수 있는 **사용자별 app authorization/session/token 발급 기록**이다.

규칙:

- 단순히 `applications` 테이블에 앱이 등록되어 있다는 이유로 “사용자가 연결했다”고 표시하지 않는다.
- 사용 기록이 없는 앱을 임의로 `미사용`이라고 추론하지 않는다.
- 현재 스키마/API가 사용자별 연결 앱 목록을 안전하게 조회하지 못한다면, UX v1 범위에서 read-only account endpoint를 추가해 source of truth를 제공한다.
- 응답은 서비스 표시명, client ID, 마지막 확인 가능한 연결 시각, 사용자에게 설명할 수 있는 권한 정도만 제공한다.
- token 원문은 반환하지 않는다.

예:

```text
공성 시간 계산기      연결됨
덱 연구소             연결됨
```

#### D. Permissions

사용자 관점에서 앱 권한을 확인한다.

예:

```text
공성 시간 계산기
- 기본 프로필 확인

덱 연구소
- 내 장수/전법 읽기
- 내 덱 읽기
```

raw scope 이름은 상세 보기에서 보조적으로 표시할 수 있다.

#### E. Session / logout

- 현재 중앙 계정 상태
- 현재 앱 로그아웃과 구분되는 “모든 낙월 서비스에서 로그아웃”
- global logout은 영향 범위를 설명한 확인 UI를 사용한다.

### 6.5 Account Center가 하지 않는 것

v1에서는 다음을 한꺼번에 넣지 않는다.

- 전체 커뮤니티 프로필 편집기
- 맹원 SNS
- 친구 시스템
- 복잡한 개인정보 설정
- 게임 DATA 전체 CRUD UI

향후 NAKWOL DATA가 확장되면 `내 장수`, `내 전법`, `내 장비`, `내 덱`을 Account Center 또는 별도 Profile Hub에서 연결할 수 있다. 하지만 UX v1의 핵심 성공 조건은 인증/계정 상태의 명확한 중앙화다.

---

## 7. Component 3 — NAKWOL AUTH Lab

### 7.1 목적

공성 계산기 같은 실제 서비스에 디버그 정보를 계속 노출하지 않고, NAKWOL AUTH 자체를 독립적으로 검증하는 공식 테스트 페이지를 제공한다.

v1 정식 경로:

```text
https://nakwol-auth.sepsd21.workers.dev/lab
```

### 7.2 대상

- 플랫폼 운영자
- AUTH 관리자
- 등록된 개발자/operator
- Codex/LLM 개발 세션에서 운영자가 검증을 수행할 때

일반 사용자용 진단 페이지가 아니다.

### 7.3 Access control

로그인 전 `/lab` shell 자체는 접근 가능해야 신규 로그인 흐름을 시험할 수 있다. 그러나 로그인 전에는 다음 정도만 보여준다.

```text
NAKWOL AUTH LAB
[ 테스트 로그인 시작 ]
```

로그인 후 full diagnostics를 보여주기 전에 기존 AUTH의 관리자/개발자 관리 정책으로 권한을 확인한다.

- AUTH admin 또는 등록된 developer/operator만 full diagnostics 접근 허용
- 일반 member가 로그인하면 “진단 권한 없음” 상태를 보여주고 diagnostic data/actions를 노출하지 않는다.
- Lab 접근을 위해 새로운 광범위한 public debug permission을 만들지 않는다.

### 7.4 표시 정보

허가된 사용자에게만 다음 정보를 표시한다.

```text
NAKWOL AUTH LAB

Central session        OK
App access token       OK
/me                    200
NAKWOL ID              usr_...
Discord guild          true
Member                 true
Role                   member
Token expiration       47m
Client ID              auth-lab
Redirect URI           ...
PKCE                    S256
```

### 7.5 보안상 절대 표시하지 않는 것

- access token 원문
- refresh/CLI token 원문
- Discord Client Secret
- Cloudflare token
- session cookie 원문
- PKCE verifier 원문

Lab은 상태를 보여주지 비밀값을 덤프하지 않는다.

### 7.6 Lab actions

로그인 전:

```text
[ 테스트 로그인 시작 ]
```

권한 확인 후 최소 액션:

```text
[ /me 다시 확인 ]
[ 앱 로그아웃 ]
[ SSO 재로그인 테스트 ]
[ 전체 로그아웃 ]
```

선택 고급 액션:

- session 상태 새로고침
- 현재 app token 만료 상태 확인
- DATA read probe — 명시된 안전한 read-only endpoint만

### 7.7 결과 표현

성공/실패를 단순 색상만으로 표현하지 않는다.

```text
PASS  /me returned current NAKWOL user
FAIL  state validation rejected callback
INFO  central SSO session exists
```

각 검증에는 시간과 단계명을 남길 수 있다.

---

## 8. Verification matrix

AUTH UX v1과 기존 코어를 함께 검증하기 위해 다음 시나리오를 공식 회귀 항목으로 둔다.

### V1. 신규 사용자 로그인

```text
미로그인
-> Discord authorization
-> callback
-> NAKWOL ID
-> membership 확인
-> app access token
-> /me
-> Compact Identity logged-in state
```

성공 기준: callback loop 없이 최종 사용자 상태가 정확하다.

### V2. 기존 SSO 사용자

A 앱에서 로그인한 사용자가 B 앱에 들어간다.

성공 기준: 중앙 세션이 유효하면 Discord 인증 화면을 불필요하게 다시 거치지 않고 B 앱의 app token을 획득한다.

### V3. Local logout

A 앱에서 일반 로그아웃한다.

성공 기준:
- A 앱 token은 폐기된다.
- 중앙 SSO 세션은 유지된다.
- 다시 로그인 시 Discord 화면 없이 복귀할 수 있다.

### V4. Global logout

Account Center 또는 명시적 global logout 수행.

성공 기준:
- 현재 앱 token 폐기
- 중앙 SSO session 종료
- 이후 재로그인에서는 실제 인증 과정이 필요함

### V5. Token expiry

만료된 app token으로 `/me`를 호출한다.

성공 기준:
- 유효 사용자로 오인하지 않는다.
- UI는 logged-out 또는 재인증 가능한 상태로 회복한다.
- 무한 요청 loop가 없다.

### V6. Invalid redirect URI

등록되지 않은 redirect URI로 authorization을 요청한다.

성공 기준: 서버가 fail-closed로 거부한다.

### V7. Invalid state / PKCE

잘못된 state 또는 verifier로 callback/token exchange를 시도한다.

성공 기준: 인증 실패 처리되며 기존 세션/사용자 데이터가 손상되지 않는다.

### V8. Membership/role change

Discord 또는 낙월 관리 정책에서 사용자의 membership/role이 변경된다.

성공 기준: 새 `/me` 검증 시 정책에 맞는 최신 상태가 반영된다. 캐시가 있다면 기존 허용된 갱신 정책을 따른다.

### V9. Multi-app SSO isolation

A/B 두 앱을 같은 사용자가 사용한다.

성공 기준:
- 동일 NAKWOL user로 인식
- app token은 앱별로 분리
- A 앱 로그아웃이 B 앱 token을 임의로 폐기하지 않음

### V10. DATA scope enforcement

AUTH 사용자가 DATA를 요청한다.

성공 기준:
- 허용된 scope는 성공
- 허용되지 않은 scope는 거부
- 브라우저에 CLI token/Cloudflare secret이 필요하지 않음

### V11. UI recovery

네트워크 오류, `/me` 일시 실패, callback 오류가 발생한다.

성공 기준:
- 서비스 전체가 흰 화면이 되지 않음
- 오류 상태를 명확히 표현
- 재시도/로그인 진입점 제공

### V12. Responsive/accessibility

Desktop/mobile/keyboard 사용 검증.

성공 기준:
- 메뉴가 viewport 밖으로 잘리지 않음
- keyboard-only 사용 가능
- focus return 정상
- 서비스 헤더 레이아웃이 과도하게 흔들리지 않음

---

## 9. First reference integration — Siege Calculator

대상:

```text
https://siege-calculator.pages.dev/
```

공성 시간 계산기를 **NAKWOL AUTH UX v1의 첫 실제 완전 통합 사례**로 사용한다.

### 9.1 현재 UI 문제

현재 우측 상단 인증 UI는 다음과 같은 구조다.

로그아웃:

```text
NAKWOL ID
로그인하지 않음
[ 낙월 로그인 ]
```

로그인:

```text
[avatar] 고영
인증됨: member
[ 로그아웃 ]
```

기능 검증에는 유용하지만 실서비스 기본 UI로는 정보 밀도와 시각적 독립성이 과하다.

### 9.2 Target UI

로그아웃:

```text
[ 낙월 로그인 ]
```

로그인:

```text
[avatar] 고영 ▾
```

헤더의 기존 프리셋 버튼들과 높이/간격이 자연스럽게 맞아야 한다.

### 9.3 Popup menu

```text
[avatar] 고영
낙월 맹원

내 낙월 계정
이 서비스 권한
────────────
로그아웃
```

### 9.4 Visual integration

공성 계산기에서 Identity UI는 해당 서비스의 다음 시각 언어를 따른다.

- 검정/짙은 녹색 기반
- 금색 accent/border
- 밝은 한지색 text
- 기존 버튼과 비슷한 radius/height
- 보라색 standalone auth branding 제거

NAKWOL 브랜드 식별은 문구/아이콘/계정 메뉴에 남기되 별도 SaaS 위젯처럼 보이지 않아야 한다.

### 9.5 Integration role

공성 계산기는 다음을 동시에 검증한다.

- 실제 서비스 header integration
- Compact Identity Menu
- login/logout/SSO
- Account Center navigation
- theme inheritance
- desktop/mobile behavior

Auth Lab이 디버그 역할을 맡으므로 공성 계산기의 실서비스 UI에는 raw 인증 정보를 남기지 않는다.

---

## 10. Public UI API contract

기존 `NakwolAuthClient` headless contract는 그대로 유지한다.

새 Identity UI는 최소한 다음 기능 계약을 제공해야 한다.

- 기존 auth client instance를 받을 수 있음
- `button | compact | menu` variant 선택
- `inherit | light | dark` theme 선택
- 사용자명/role 표시 정책 설정
- Account Center URL 연결
- login/logout 상태 변화 자동 반영
- destroy/unmount 가능
- CSS custom properties로 service theme override

개념 예시:

```js
mountNakwolIdentityMenu(auth, {
  variant: 'compact',
  theme: 'inherit',
  showName: true,
  showRole: false,
  accountUrl: '/account'
});
```

함수/옵션의 정확한 최종 이름은 구현 계획에서 기존 SDK naming convention과 충돌 여부를 확인해 확정할 수 있지만, 위 기능 계약 자체는 변경하지 않는다.

버전 정책:

- 현재 `v0.1.0/...` 고정 SDK 자산은 immutable하게 유지한다.
- UX v1 구현이 기존 asset 내용을 바꾸어야 한다면 반드시 새 immutable SDK version URL로 배포한다.
- `/sdk/nakwol-auth-web.js` stable alias는 새 안정 버전을 가리킬 수 있다.
- 기존 시험 widget compatibility를 깨뜨리지 않는다.

---

## 11. Error handling

### Service UI

인증이 선택 기능인 서비스:
- AUTH 오류가 계산기/도구 본체를 다운시키지 않는다.
- 작은 오류 상태와 재시도만 제공한다.

인증이 필수인 서비스:
- 서비스가 별도의 access gate를 제공한다.
- Identity Menu 자체를 전체 화면 접근 제어기로 사용하지 않는다.

### Account Center

- `/me` 실패 시 사용자에게 재로그인/재시도 선택 제공
- 서버 오류와 미로그인 상태를 구분
- global logout 실패 시 부분 성공 여부를 숨기지 않음

### Auth Lab

- 단계별 실패 원인 표기
- 사용자에게 보여도 되는 서버 error code만 표시
- secret/raw token은 로그에도 노출하지 않음

---

## 12. Security and privacy constraints

UX 개선 과정에서 기존 보안 경계를 약화시키지 않는다.

필수 규칙:

- Discord Client Secret은 AUTH Worker에만 존재한다.
- 브라우저에는 app access token 외 운영 비밀값을 넣지 않는다.
- access token은 기존 SDK 저장정책을 유지한다.
- Account Center와 Lab은 raw secret/token을 표시하지 않는다.
- 사용자 출력은 `textContent`/안전 DOM API 또는 동등한 escaping 정책을 사용한다.
- redirect URI 검증을 완화하지 않는다.
- CORS allowlist를 UX 편의를 이유로 wildcard로 바꾸지 않는다.
- DATA scope를 UI에서 보이지 않게 했다는 이유로 서버 검증을 생략하지 않는다.
- role label의 예쁜 표현과 실제 authorization 판단을 분리한다. 서버 authorization은 raw verified role/scope 기준이다.
- Lab full diagnostics는 일반 member에게 공개하지 않는다.
- Account Center의 connected services는 실제 server-side evidence에서만 파생한다.

---

## 13. Non-goals

NAKWOL AUTH UX v1에서 하지 않는다.

- 인증 프로토콜 재설계
- Discord OAuth 제거
- AUTH D1 / DATA D1 통합
- 전체 낙월 커뮤니티 사이트 개발
- 모든 낙월 서비스 동시 이식
- 소셜 프로필/친구 기능
- DATA의 신규 게임 규칙 추론
- 장수/전법/장비/덱 전체 관리 UI 완성
- native mobile app 인증 체계 신설
- 별도 결제/구독 시스템

---

## 14. Delivery phases

### Phase 1 — Identity UI foundation

- Compact Identity Menu
- logged-out / loading / logged-in / error state
- popup menu
- inherit theme + CSS variables
- accessibility baseline
- legacy widget compatibility

### Phase 2 — Account Center

- `/account`
- login-before-account flow
- profile/membership
- NAKWOL ID
- evidence-backed connected services
- app/service permission presentation
- global logout

### Phase 3 — Auth Lab

- `/lab`
- public login shell + restricted diagnostics
- 상태 진단 panel
- safe diagnostic actions
- V1~V10 핵심 수동 회귀 시나리오 지원

### Phase 4 — Siege Calculator reference integration

- 기존 상시 위젯 제거
- Compact Identity Menu 적용
- 공성 계산기 theme integration
- Account Center 연결
- 실제 login / local logout / SSO / global logout 검증

### Phase 5 — Regression and release readiness

- 자동화 가능한 회귀 테스트 추가
- desktop/mobile/accessibility 수동 점검
- Web SDK/Connect compatibility 검증
- 새 immutable Web SDK version이 필요한 경우 versioned release
- AUTH UX의 정식 component release 준비

---

## 15. Acceptance criteria

UX v1은 다음 조건을 만족하면 완료로 본다.

1. 공성 계산기 헤더에서 로그인 UI가 서비스 디자인에 자연스럽게 통합된다.
2. 로그인 전에는 작은 `낙월 로그인` 버튼만 보인다.
3. 로그인 후에는 기본적으로 avatar + display name만 보인다.
4. role, account, permissions, logout은 popup/menu로 이동한다.
5. `/account`는 로그인 전 중앙 로그인 진입점을 제공하고 로그인 후 일반 사용자가 자신의 NAKWOL 계정 상태를 이해할 수 있다.
6. Account Center의 연결 서비스 정보는 실제 사용자별 authorization/session/token 근거에서만 표시된다.
7. `/lab`은 로그인 흐름 자체를 시험할 수 있지만 full diagnostics는 기존 admin/developer/operator 권한이 있는 사용자에게만 제공한다.
8. `/lab`에서 AUTH 코어를 다른 실제 서비스 없이 독립적으로 검증할 수 있다.
9. 신규 로그인, SSO, local logout, global logout, token expiry, invalid redirect, invalid state/PKCE, role change, multi-app isolation, DATA scope 검증 시나리오가 반복 검증 가능하다.
10. raw secret/token이 UI나 diagnostic log에 노출되지 않는다.
11. 기존 Web SDK headless contract와 Connect v0.3 integration을 깨뜨리지 않는다.
12. 기존 version-pinned SDK 자산을 뒤에서 변경하지 않는다.
13. 공성 계산기 내부에 디버그용 raw auth 상태를 상시 표시하지 않는다.
14. mobile/keyboard 환경에서도 Identity Menu가 사용 가능하다.
15. 인증 UI 오류가 인증 선택형 서비스의 핵심 기능을 불필요하게 중단시키지 않는다.

---

## 16. Relationship to future NAKWOL platform work

UX v1 이후 Account Center는 향후 낙월 플랫폼의 사용자 허브로 확장될 수 있다.

가능한 후속 확장:

```text
내 프로필
내 장수
내 전법
내 장비
내 덱
내가 접근 가능한 낙월 서비스
```

그러나 이 확장은 AUTH UX v1의 완료 조건이 아니다.

UX v1이 먼저 안정되어야 이후 전투 리포트, 덱 연구소, 개척 도우미, 낙월 허브 등이 동일한 NAKWOL ID와 Identity UI를 소비할 수 있다.

---

## 17. Final architectural boundary

최종 목표 구조:

```text
                       +----------------------+
                       |   Discord Identity   |
                       +----------+-----------+
                                  |
                                  v
+--------------------+   +----------------------+   +--------------------+
| Service UI         |<->|    NAKWOL AUTH Core  |<->| AUTH D1            |
| Siege / Deck / ... |   | OAuth PKCE SSO /me   |   | users/apps/session |
+---------+----------+   +----------+-----------+   +--------------------+
          |                         |
          |                         +----------------------+
          |                                                |
          v                                                v
+--------------------+                           +------------------------+
| Identity UI        |                           | NAKWOL DATA            |
| compact/menu       |                           | scopes + user data     |
+---------+----------+                           +------------------------+
          |
    +-----+------+
    |            |
    v            v
/account       /lab
User Center    Verification Lab
```

핵심 원칙은 다음 한 문장으로 고정한다.

> **NAKWOL AUTH는 인증을 중앙화하되, 인증 UI가 각 서비스의 디자인을 지배하지 않는다. 상세 계정 경험은 Account Center로, 기술 검증은 Auth Lab으로 분리한다.**
