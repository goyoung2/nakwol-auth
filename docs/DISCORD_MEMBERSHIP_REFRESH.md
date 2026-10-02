# Discord 역할 자동 갱신 (T07 개발)

## 목적과 경계

역할 갱신은 중앙 AUTH가 담당한다. 각 사이트는 공식 서버 게이트의 세션 갱신 계약을 사용하며 Discord OAuth나 봇을 직접 설치하지 않는다. 유효한 로컬 승인 증명의 정적 자산 요청에는 Discord 조회가 추가되지 않는다.

중앙은 OAuth access/refresh credential을 별도 키로 암호화 보관한다. 이 값은 사이트 Secret, 브라우저 응답, 진단 로그에 넣지 않는다. Discord의 `guilds.members.read` scope와 refresh token 교환은 [공식 OAuth 문서](https://github.com/discord/discord-api-docs/blob/main/developers/topics/oauth2.mdx)에 따른다.

## 상태 구분

- 정상 갱신: 사용자 개입 없이 역할 증거와 유효기한을 갱신한다.
- 역할 제거·서버 탈퇴: 정상 조회로 확인한 결과를 저장하고 해당 역할 기반 접근을 거부한다.
- 일시 장애·429: 마지막 정상 역할을 지우지 않는다. 재시도 시각을 준수하며 증거 유효기간이 끝나면 차단한다.
- credential 철회·재동의 필요: 기존 역할 값을 정상 상태인 것처럼 연장하지 않고 사용자가 다시 인증할 경로를 제공한다.
- 명시적 재인증 요청: 자동 역할 갱신으로 해제하지 않는다.

## 배포 상태

이 문서는 개발 계약이다. migration·중앙 암호키 설정·AUTH 배포가 운영에 적용되기 전에는 기존 사이트의 역할 재검증 주기가 바뀌었다고 안내하지 않는다. 세부 설정과 실행 결과는 구현 검증 후 아래에 기록한다.

## 중앙 설정과 전환

중앙 Secret `DISCORD_CREDENTIAL_KEY`(base64로 인코딩한32바이트)와 키 버전 `DISCORD_CREDENTIAL_KEY_VERSION`을 사용한다. 정상 키 회전에는 `DISCORD_CREDENTIAL_PREVIOUS_KEY`, `DISCORD_CREDENTIAL_PREVIOUS_VERSION`, `DISCORD_CREDENTIAL_PREVIOUS_UNTIL`(Unix 밀리초)이 필요하다. 이전 키로 읽은 인증 정보는 다음 실제 갱신에서 현재 키로 다시 암호화한다. 이 키는 사이트 게이트의 쿠키 키 및 Discord Client Secret과 분리한다.

migration0017은 기존 사용자의 전환 종료 시각을 최초 적용 시점+30일로 저장한다. `LEGACY_MEMBERSHIP_DEADLINE_AT`은 이 기한을 단축하는 용도다. 서버 재시작이나 로그인 시점마다30일을 다시 부여하지 않는다. 전환 기간에도 기존24시간 역할 증거의 만료를 넘겨 승인하지 않는다.

새 credential이 있는 사용자는 중앙에서15분 역할 신선도를 강제한다. 활성 요청은14분부터 미리 갱신을 시도한다. 관리자 강제 확인도 같은 갱신 경로를 사용하며, credential이 없는 사용자는 재인증 안내를 받는다. 역할 조회의401은 lease 안에서 토큰을 한 번 갱신하고 한 번 재시도한다. 만료된 증거와 일시 장애가 겹치면503으로 차단한다.

운영자 화면의 '역할 다시 확인'은 `POST /admin/api/access/:clientId`에 `action=refresh_membership`, `discord_user_id`, `reason`을 보내는 기존 인증된 관리 경로다. 자동 갱신 정보가 없는 사용자는 계정 복구 링크를 받는다. 서버 credential과 Discord credential은 서로 다른 인증 정보이며, 외부 개발자에게 중앙 Discord 토큰을 제공하지 않는다.

migration0017과 중앙 암호키를 준비한 뒤 AUTH를 배포해야 한다. 이 단계는 중앙 기능이므로 이미 T06 서버 갱신을 사용하는 사이트에 별도 Discord 연동 코드를 추가하지 않는다. 기존 게이트의 기능 한계가 자동으로 해소되었다는 뜻은 아니다. 운영 적용은 별도이며 [검증 기록](audits/2026-09-30-commercial-membership-refresh.md)을 참조한다.
