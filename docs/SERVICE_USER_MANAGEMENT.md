# 서비스 개발자의 사용자 관리

`/developer/users`에서 현재 소유권이 있는 앱만 관리합니다. `/developer/apps`의 사용자 관리 링크로 이동할 수 있습니다. 이 단계는 로컬 개발본이며 운영 배포·DB 마이그레이션·npm 발행은 별도입니다.

## 권한과 정보

- 사람의 관리 토큰은 `nakwol-connect-admin` audience이며, 현재 활성 개발자와 해당 앱 소유권을 매 요청과 쓰기 트랜잭션에서 검사합니다. site credential은 사용자 관리 권한을 주지 않습니다.
- 목록은 앱마다 다른 subject, Discord ID/표시명, 최초 승인·마지막 인증·마지막 관측/수신/지연, 마지막 거부 시도, 앱 차단과 위임 허가 만료만 제공합니다. 중앙 사용자 ID, 전체 역할, 타 앱 이력, 중앙 세션·credential·비밀값은 반환하지 않습니다.
- 인증 완료는 실제 페이지 방문과 다릅니다. 관측은 마지막으로 게이트가 보고한 통과이며 온라인 상태가 아닙니다. 인증 거부는 별도 상태입니다.
- 사전등록은 이미 알고 있는 Discord ID만 입력합니다. 중앙 가입 여부를 조회하지 않으며 등록 자체가 접근 허가가 아닙니다. 미등록 ID와 중앙에는 있으나 이 앱 관계가 없는 ID는 같은 응답 형태입니다.
- 익명 집계는 신원이 없는 중앙 OAuth 실패입니다. 익명 요청을 Discord 사용자로 만들거나 모든 거부된 이미지 요청을 중앙에 기록하지 않습니다.

## API

모든 사람용 API에 현재 owner/operator Bearer 인증이 필요합니다. 변경은 AUTH와 같은 Origin, 실제 OAuth 재인증 15분 이내, 사유 3~500자, 앱별 분당 20건 제한을 적용합니다.

| 경로 | 계약 |
|---|---|
| `GET /developer/v1/apps/:clientId/users` | 기본50/최대100, `cursor`, `state`, `q`; cursor는 앱·검색·필터에 바인딩 |
| `GET .../users/:subject` | 해당 앱 관계만, 다른 앱 subject는404 |
| `POST .../users` | `discordId`, `reason`, `expectedVersion:0`, `idempotencyKey`로 사전등록 |
| `POST .../users/:subject/actions` | `action`, `reason`, 관계의 `expectedVersion`, `idempotencyKey` |
| `GET .../user-operations/:operationId` | 이 앱의 최소 조치 결과·전파 상태만 |

액션은 `deny`, `clear-deny`, `revoke-app-sessions`, `grant`, `clear-grant`, `delete-relationship`입니다. 반복 요청은 같은 입력과 key를 재사용합니다. 다른 입력으로 같은 key를 쓰거나 상태가 바뀐 버전을 쓰면409입니다.

이미 저장된 같은 허가 operation은 허가 만료 뒤에도 동일한 결과를 반환합니다. 재시도가 허가를 연장하지 않으며 새 허가는 현재 시각 기준의 만료 조건을 다시 검사합니다. 한국어/이모지 검색어도 cursor에 동일하게 바인딩합니다.

앱 세션 종료는 이 앱의 사이트 세션·앱 토큰·미교환 코드를 회수합니다. 중앙 SSO family와 다른 앱 세션은 유지합니다. 중앙의 전체 재인증 함수를 호출하지 않습니다.

owner 허가는 중앙 운영자의 기존 예외 허가와 다른 테이블에 저장합니다. 플랫폼 `grantableConditions`의 `additional-roles`가 위임됐을 때만 `conditions:["additional-roles"]`와 5분~7일의 `expiresAt`을 받습니다. 시즌3·역할 freshness·계정/앱 활성·중앙/앱 deny·admin 기준을 우회하지 않습니다. 허가 철회는 owner의 위임 허가만 철회합니다.

관계 삭제는 해당 앱 관계·관측·owner 허가를 삭제합니다. 중앙 계정/타 앱/중앙 예외 허가는 보존하며 별도의 앱 deny tombstone도 유지합니다. 삭제 후 새 인증 시도에서 새로운 앱 관계가 생길 수 있습니다.

## 관측과 성능

Connect runtime0.12.0의 server-session 모드에서 승인된 asset 응답 뒤 `/server/v1/observations`로 비동기 보고합니다. HTML/JSON/이미지/폰트 등은 동일한 게이트를 유지합니다. 미인가 요청에서는 승인 관측을 생성하지 않습니다.

- 공식 Workers/Pages의 `ctx.waitUntil`과 Vercel의 `@vercel/functions.waitUntil`을 연결합니다. custom host는 `createGate`에 `waitUntil`을 제공합니다. hook 또는 site credential이 없는 호스트는 관측 미지원이며 콘텐츠 보호는 유지합니다.
- 앱·사용자·5분 구간을 isolate 안에서 합치고, 큐128건·배치50건·작업당 최대3배치·2초 timeout·1회 재시도 뒤 drop 집계를 둡니다. 관측 네트워크를 인증 응답에서 await하지 않습니다.
- 여러 isolate는 각각 보고할 수 있습니다. 중앙은 앱/subject/5분 구간으로 upsert합니다. 사이트 credential의 app/origin과 중앙에서 승인된 session을 검증해 신원을 도출하며 브라우저의 userId를 받지 않습니다.
- 전송 실패는 승인 판단을 변경하지 않습니다. 기록은 지연되거나 누락될 수 있습니다. drop은 isolate 진단 수치이며 다음 성공 보고 때 전송하므로 isolate 종료 시 유실될 수 있습니다.
- 성공 asset의 `X-Nakwol-Observations`는 `background-v1` 또는 `unsupported`입니다. 기존 lease/제어/ETag·304/HEAD/Range 계약은 유지합니다.

## 적용 상태와 보존

DB 조치 저장, 제어 publication, observation은 별개입니다. 기본 local-lease의 반영 상한은 앱의 권한 재확인 간격(최대300초)입니다. bounded-control은 성공 발행 뒤35초 상한이지만 실제 설치 프로필 확인 전에는 빠른 전파를 지원한다고 표시하지 않습니다.

관측·익명 집계30일, 사람의 조치 감사180일을 scheduled cleanup으로 정리합니다. deny는 명시적 해제까지 별도 보존합니다. source worker의 scheduled job이 실행되는 배포 설정을 함께 확인해야 합니다.

운영 순서: additive migration0020 → 중앙 Worker 배포 → 정상/거부 owner 수용 확인 → 원하는 소비 사이트만0.12.0 업데이트/재배포 → `doctor`와 `protect verify` 및 정상 사용자 검증. 원격 migration을 하지 않은 Worker에 먼저 배포하면 안 됩니다. AUTH만 배포해도 기존 사이트의 서버 파일은 바뀌지 않습니다. 0.11 이전 파일 구성도 검사/업데이트 계약을 유지합니다.
