# 빠른 차단 전파: bounded-control v1

상태: 상용 계획 T08의 **로컬 검증 대상인 선택형 프로필**. 공통 게이트 0.11.0.
기존 설치·운영 사이트를 자동으로 전환하지 않습니다. 기본값은 `local-lease`입니다.

## 동작과 보안 계약

1. 중앙 권한 변경과 같은 D1 트랜잭션의 SQL trigger가 앱별 outbox를 남깁니다.
2. 앱별 SQLite Durable Object에 단조 증가하는 버전과 차단 projection을 저장합니다.
3. 사이트는 credential로 `POST /server/v1/control`을 호출합니다. 중앙은 미게시 변경을 먼저
   게시하고 버전을 다시 검사한 후 P-256 ECDSA 문서를 발행합니다.
4. 사이트는 고정한 공개키, audience, clientId, origin, 시간, 버전, 크기를 검증합니다.
   수신 시각으로 TTL을 다시 시작하지 않습니다. 만료는 중앙 조회 **시작 시각 +30초**입니다.
5. 유효한 문서는 isolate 메모리에만 보관합니다. 정적 파일마다 네트워크·D1·KV를 조회하지 않습니다.
   차가운 isolate 또는 만료 시 한 번 조회하며 같은 isolate의 동시 요청은 합칩니다.
6. 앱 epoch보다 오래된 세션은 중앙 세션 갱신을 거칩니다. 세션 갱신은 앱 변경 버전을
   평가 전에 읽고 D1 INSERT/CAS 조건으로 묶습니다. 잘못된 쿠키는 control 조회 전에 차단합니다.

문서 필드: `schemaVersion`, `audience`, `clientId`, `siteOrigin`, `version`, `issuedAt`,
`expiresAt`, `appStatus`, `policyFloor`, `appEpoch`, `revocations`.
Envelope: `kid`, Base64URL `payload`, `signature`; 서명 입력은 `kid.payload`입니다.

취소된 세션 ID 최대 300개를 문서에 넣으며, 그 이상이면 앱 epoch로 전체 기존 승인을
재검증합니다. 현재 구현은 작은 변경에도 epoch를 올리는 보수적인 초기 구현입니다.
이 때문에 다른 사용자의 권한 변경 직후에도 정상 사용자가 세션 갱신 한 번을 할 수 있습니다.
문서 수신은 최대 64KiB, payload 최대 60,000자, 공개키 최대 4개입니다.
기존 outbox 기록은 30일 보존 후 정리하되 앱별 최신 epoch는 영구 보존합니다.
세션의 절대 만료 상한도 30일입니다. 단순 멤버십 조회 시각 갱신은 epoch를 올리지 않습니다.

## 전파 상태

- `pending`: DB 변경과 outbox 기록 완료, 아직 DO 게시 미확인.
- `failed`: 게시 작업 실패. 같은 operation ID로 재시도할 수 있습니다.
- `published` / `published_at`: 해당 버전 이상을 DO에 저장했음을 확인.
- `observed_at`: 사이트가 다음 조회에서 직전 검증 버전을 보고한 시각.
  문서를 HTTP로 보냈다는 사실만으로 수신 확인을 기록하지 않습니다.

`publishControl(operationId)`는 중복 호출해도 최신 버전을 후퇴시키지 않습니다.
1분 scheduled 작업은 앱 최대 100개씩 미게시 작업을 재시도합니다. 조회 시에도 재시도합니다.
게시 실패 전 구간을 35초 전파 성공으로 표현하지 않습니다. 전파 상한은 **게시 완료 후**
새로 시작한 요청에 대해 30초 + 시계 오차 최대 5초입니다.
글로벌 deny는 모든 앱 outbox에 반영하며, 앱별 게시 실패를 남겨 재시도합니다.

## 장애와 성능의 비용

- 문서 만료 후 AUTH 연결 실패, 잘못된 서명·시간·버전은 **503**으로 자산을 차단합니다.
  살아 있는 authorization lease로 만료된 control 문서를 대신하지 않습니다.
- 중앙이 이미 거절한 세션은 해당 epoch에 한해 최대 30초 동안 거절 결과를 캐시합니다.
  control 연결 실패는 1초 backoff만 두며 허용 결과로 바꾸지 않습니다.
- 최대 30초마다 isolate별 추가 RTT가 생깁니다. 사이트 전체 한 번이라는 보장은 없습니다.
  전역 네트워크 지연·DO 지역 지연은 운영에서 추가로 측정해야 합니다.
- 역할 변경의 발견 시점은 T07 Discord 재조회 계약에 따릅니다. 이 프로필은 **중앙에서
  발견·게시한 이후** 전파를 줄입니다. Discord 역할 변경을 실시간으로 발견하는 봇 기능은 아닙니다.
- 이미 내려받은 데이터나 진행 중인 스트림은 회수할 수 없습니다. cache 정책은 기존
  `private, no-cache, must-revalidate` / `no-store` 그대로입니다.

## 활성화와 호환성

중앙: 0018 migration, 실제 AUTH Wrangler의 `GATE_CONTROL` SQLite DO binding/migration,
`GATE_CONTROL_SIGNING_JWK` 서버 Secret, `GATE_CONTROL_KID`가 필요합니다.
개인키는 P-256 서명 전용이며 브라우저·저장소·빌드 설정에 넣지 않습니다.

사이트: 서버 credential과 세션 Secret에 더해 아래 서버 환경 변수를 설정합니다.

```text
NAKWOL_CONTROL_PROFILE=bounded-control
NAKWOL_CONTROL_PUBLIC_KEYS={"PINNED_KID":{"kty":"EC","crv":"P-256","x":"...","y":"...","ext":true}}
```

공개키를 신뢰 가능한 운영 경로로 전달·고정해야 합니다. 서명 문서가 임의로 제공한 키나
알 수 없는 kid를 자동으로 신뢰하지 않습니다. 키 교체 시 중앙과 사이트의 공개키 집합을
겹치게 배포한 후 기존 키를 제거합니다.
custom host는 `createGate` 옵션 `controlProfile`, `controlPublicKeys`로 동일한 기능을 사용합니다.
Workers·Pages·Vercel은 같은 `server/control.mjs`와 `session.mjs`를 사용합니다.
control 기능은 서버 갱신 모드에서만 지원하며 credential 없이 켜면 503입니다.

기존 0.10 설치 파일은 그대로 동작합니다. 새 기능은 `protect update` 후 재배포하고
위 설정을 **명시적으로** 활성화해야 합니다. 기존 0.7 게이트는 전파 검증 성공 대상으로
취급하지 않습니다. `protect verify`는 자산 차단을 검사하며 35초 전파나 지역 성능의
자동 승인 도구는 아닙니다. T11 운영 성능 검증 전 전체 사이트 활성화는 보류합니다.
