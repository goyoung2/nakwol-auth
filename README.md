# NAKWOL Platform Core

낙월(落月) 서비스들의 중앙 인증·SSO와 공통 게임 데이터 기반입니다.

## NAKWOL AUTH

Discord OAuth, NAKWOL ID, membership, Authorization Code + PKCE, 앱별 access token/`/me`, SSO, Web SDK와 NAKWOL Connect를 담당합니다.

Auth origin: `https://nakwol-auth.sepsd21.workers.dev`

## NAKWOL DATA

`services/data/`는 AUTH와 런타임이 분리된 공통 게임 데이터 서비스입니다.

- Worker/D1: `nakwol-data`
- Foundation `0.1.0`, schema `1`
- 게임 계정, Registry, 사용자 영구 자산, 장비, 덱/스냅샷 스키마
- AUTH `/me`를 통한 NAKWOL ID 검증
- 앱별 DATA scope는 기본 거부 후 명시적 grant

상세 설계/API는 [DATA.md](./DATA.md)를 참고합니다.

## NAKWOL Connect

```bash
npx nakwol-connect init
npx nakwol-connect doctor --json
```

AUTH와 DATA는 같은 저장소에서 플랫폼 계약을 함께 버전 관리하지만 Worker/D1, migrations, deployment lifecycle은 분리합니다. 앱은 공개 API/SDK만 사용하며 AUTH/DATA D1에 직접 접근하지 않습니다.
