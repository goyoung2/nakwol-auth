# T05/D01 정책 관리 구현 및 검증

## 범위

기준 commit `0faf9c36683d18b42eae6bb06fd647265be56b1a`, 작업 branch
`feature/commercial-auth-foundation`. 이번 단계는 정책 저장·평가·게이트 협상과 외부
개발자 소유권 경계다. 장기 서버 세션(T06), Discord 역할 자동 갱신(T07), 제어 전파(T08),
서비스 사용자 목록·조치(D02), UI 편집(D03)은 완료하지 않았다.

## 실행 경로

- `/developer/apps` 공개 HTML은 개인정보 없는 shell이다. 관리 데이터는
  `nakwol-connect-admin` audience 토큰, 활성 사용자, 현재 소유권 또는 auth_operators를 확인한다.
- owner는 자기 앱의 lease 60~300초, idle 1시간~10일, absolute 1시간~30일을 전역 상한 안에서 저장한다.
  idle/absolute의 실제 장기 세션 적용은 T06까지 대기한다. 현재 사이트 쿠키는 최대 1시간이다.
- 운영자는 전역 정책과 앱 접근 정책을 변경한다. 전역 변경과 접근 정책 변경에는 5분간 유효한
  actor/scope/version/payload 결합 preview가 필요하다. 변경은 expectedVersion CAS와 감사/outbox를
  같은 D1 batch에 기록한다. outbox pending은 실제 사이트 적용 완료를 뜻하지 않는다.
- 쓰기는 정확한 Origin, 최근 15분 역할 확인, 3~500자 사유, 8KiB body 제한,
  actor/scope당 분당 20회 제한을 적용한다. 오래된 인증은 `prompt=login`으로 갱신하며 다른
  서비스의 중앙 SSO를 삭제하지 않는다.
- 앱/전역 deny가 grant보다 우선한다. grant는 member/guest의 운영자 예외이며 admin/lab
  권한을 만들지 않는다. 정상 role 승인은 만료된 미사용 grant에 영향을 받지 않는다.
- `/me`는 기존 응답을 보존하면서 `authorization_policy`를 추가한다. 공통 gate 0.9.0이
  policy-v1을 협상하고 lease, 정책 버전, 사용한 승인 증거의 만료를 검증한다. 정상 lease의
  자산 요청에는 원격 조회가 없다. 기존 v2 쿠키 계약과 fail-closed 처리는 유지한다.

## 경합 리뷰와 수정

독립 리뷰가 발견한 네 문제를 모두 수정했다.

1. 발급 중 TTL 축소: 토큰 INSERT 자체에서 현재 global/app TTL을 읽어 sweep 이후 오래된 TTL로
   발급되는 경합을 제거했다. 이후 확대해도 축소된 토큰의 만료는 연장하지 않는다.
2. 기존 앱 수정 API: 이름 등 metadata 수정은 access_policy를 쓰지 않는다. concurrent 정책
   강화가 오래된 pre-read 값으로 되돌아가지 않는다.
3. 전역 상한 축소 후 기존 override: 새 입력만 상한 검사하고 기존 값은 effective에서 clamp한다.
4. preview 만료/삭제 경합: 저장 batch 내부에서 preview 전체 귀속과 DB 시각 만료를 재검사한다.

재검토에서 이 네 수정 범위의 남은 P0/P1/P2 문제는 발견되지 않았다. 리뷰는 소스 검토이고
실행 검증은 별도 테스트 결과다.

## 호환성과 운영 적용 주의

- migration 0015가 먼저 필요하다. 모든 기존 grant의 expires_at을 updated_at+7일로 채운다.
  활성 grant가 이미 7일보다 오래되었으면 즉시 효력을 잃는다. 운영 대상 사전 점검 및 필요한
  재승인 없이 무조건 적용해서는 안 된다. 원격 migration은 이번에 실행하지 않았다.
- Connect 0.9.0은 로컬 패키지 버전이다. npm 게시·AUTH 배포·설치 사이트 배포는 하지 않았다.
- 기존 0.7/0.8 사이트는 동적 정책 미지원이다. 0.9도 현재 유효 lease가 있으면 다음 재검증까지
  최대 5분 지연된다. 설치 사이트 업데이트·재빌드·배포와 실제 관측이 필요하다.
- 역할 확인 신선도는 현재 24시간 계약을 유지한다. 짧은 lease가 Discord 역할 회수를 즉시
  반영한다는 뜻이 아니다. 이 부분은 T07 대상이다.
- D02 대상 subject/session/cursor/supportCode는 아직 미지원으로 거절한다. 서비스 사용자 관리가
  완성된 것처럼 capability를 노출하지 않는다.

## 검증 기록

최종 실행 결과는 아래에 추가한다. 로컬 테스트는 실제 운영 OAuth/CDN 검증을 대신하지 않는다.

- `npm test`: 270/270 통과, `.wrangler/commercial/t05-full-verified.log`.
- `npx tsc --noEmit`: 통과, `.wrangler/commercial/t05-types-verified.log`.
- 실제 D1: 동시 CAS, 감사 실패 rollback, 타 앱 차단, 소유권 회수, CSRF/최근 인증/body/rate,
  preview 삭제 경합, 토큰 발급 TTL 경합, metadata 변경 정책 보존을 검사했다.
- 게이트: 협상된 60초 lease에서 이미지 300개에 추가 `/me` 0회, 만료 후 AUTH 503 차단,
  승인 증거 조기 만료, 중앙 guest 정책, malformed 정책의 세션 발급 거부를 검사했다.
- 보호 검사 기존 회귀 suite와 CLI pack 통과. 이번에는 운영 사이트에 protect verify를 실행하거나
  OAuth 승인을 누르지 않았다.
- 실제 Chromium + disposable workerd/D1 + 실제 sdk-entry 번들: owner의 2시간 설정 저장 후
  새로고침 유지(version1), operator의 guest 정책 preview/confirm 저장 유지(version2)를 확인했다.
  스크린샷은 로컬 `output/playwright/policy-owner.png`, `policy-operator-preview.png`에 있다.
  CSS가 hidden 속성을 덮어 운영자 필드가 보이던 문제를 발견하고 수정했다.
- 추가 브라우저 확인: owner가 admin bootstrap을 마치면 운영자 검사 전에
  `/developer/apps?client_id=a`로 복귀한다. 재인증 버튼은 실제 authorize URL에 prompt=login,
  admin audience/redirect를 포함했다. Discord 네트워크 요청은 차단하여 실제 동의는 하지 않았다.
  복귀 화면 `output/playwright/policy-owner-return.png`. 최종 UI 회귀는 6/6 통과했다.
