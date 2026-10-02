# 서버 세션 갱신 (Connect 0.10.0 릴리스 후보)

이 기능은 T06 개발 단계이며 npm 게시·운영 배포와 별개다. 기존 설치는 자동 전환되지 않는다.

## 무엇이 달라지는가

브라우저의 장기 credential을 JavaScript에서 다루지 않는다. 사이트 서버는 다음 두 쿠키를
HttpOnly/Secure/SameSite=Lax, host-only로 관리한다.

- **안정 핸들**: 사이트·앱·인증 서버·sessionId·난수 bearer를 암호화한다. 중앙에는 bearer의 해시만 저장한다.
- **승인 증명**: 사용자, 세대, 승인 근거, 검증 시각, lease/증거/세션 만료를 AES-GCM으로 봉인한다.

유효 증명을 가진 이미지·HTML·JSON·폰트 요청은 로컬 암호 검증 후 제공한다. 자산마다
중앙 AUTH나 D1을 조회하지 않는다. 증명이 만료된 요청만 사이트 credential과 핸들을 함께
보내 중앙에서 갱신한다. 갱신은 증명 쿠키만 교체한다. 여러 요청이 겹쳐도 안정 핸들은 유지하고,
오래된 세대가 늦게 도착하면 다음 확인에서 최신 상태로 복구한다.

## 활성화 순서

1. AUTH migration 0016과 해당 코드가 먼저 배포되어야 한다.
2. 앱 Redirect URI에 `https://YOUR-SITE/__nakwol/callback`을 정확히 등록한다.
3. 현재 앱 소유자 또는 AUTH 운영자가 관리 API에서 해당 HTTPS origin의 서버 credential을 발급한다.
   관리 bearer는 `nakwol-connect-admin`용이며 최근 인증·Origin·사유 검사를 거친다.
   `POST /developer/v1/apps/:clientId/site-credentials`, JSON `{ "siteOrigin": "https://YOUR-SITE", "reason": "서버 갱신 활성화" }`.
4. 응답의 `secret`은 한 번만 표시된다. 사이트 호스팅의 Secret `NAKWOL_SITE_CREDENTIAL`에 저장한다.
   저장소, 공개 설정, 브라우저 번들에 넣지 않는다. AUTH의 Discord secret과 다른 별도 credential이다.
5. 공식 Connect 패키지를 업데이트하고 게이트를 생성·재빌드·배포한다. 로컬 후보 버전을 운영에
   설치하라는 의미는 아니다. 공개 릴리스가 확인된 뒤 기존 release 절차를 따른다.
6. `protect verify`와 정상 계정의 로그인·재방문·파일 접근을 확인한다.

Workers/Pages는 런타임 env에서, Vercel 공식 어댑터는 `process.env`에서 Secret을 전달한다.
직접 연결한 호스트는 `createGate` 호출에 `siteCredential`을 전달한다. Secret이 없으면 기존
토큰 기반 최대 1시간 세션을 유지한다. 잘못된 Secret을 넣었을 때 기존 방식으로 우회하지 않는다.

## 수명과 회수

세션 idle/absolute 정책을 중앙이 강제한다. 최대 30일을 넘지 않고, 정책을 줄이면 기존 경계를
줄일 수 있지만 다시 늘려도 만료·회수된 세션이 살아나지 않는다. 중앙 SSO family 폐기, 사용자
비활성화, 앱 차단, credential 폐기, 명시적 deny는 이후 갱신을 거부한다.

이미 발급된 로컬 증명은 최대 300초 동안 남을 수 있다. T08의 짧은 제어 전파는 아직 별도다.
T07 중앙 OAuth credential이 활성화된 사용자는 역할 증거를 최대15분 사용하며 자동 갱신한다.
기존 사용자의24시간 규칙은 migration0017의 유한한 전환 기한까지만 적용한다.
[역할 자동 갱신 설정](DISCORD_MEMBERSHIP_REFRESH.md)을 함께 적용해야 하며,
운영 배포 전에는 운영 사용자의 역할 신선도가15분으로 바뀌었다고 표시하지 않는다.

사이트 로그아웃은 해당 서버 세션을 중앙에서 회수하고 쿠키를 삭제한다. 중앙 전체 로그아웃과
구별된다. AUTH 장애 시 만료 증명을 연장하거나 콘텐츠를 공개하지 않는다.

만료 증명의 중앙 갱신이 401/403 또는 통신·응답 오류 503으로 끝나면 같은 앱·사이트·AUTH·정책·
사이트 credential·세션 핸들에 대해 isolate 안에서 실패 결과를 최대 1초 재사용한다. 그 뒤 첫 요청이
중앙 확인을 다시 시도한다. 따라서 역할 부여나 장애 복구 후 같은 핸들의 재시도 지연은 완료된
실패 응답으로부터 최대 1초다. 다른 세션·credential과 새 로그인 콜백은 이 대기를 공유하지 않는다.
실패 기록은 isolate당 최대 512건이며, 축출된 기록은 다시 중앙 확인한다. 승인 증명의 최대 300초
고정 만료는 그대로다. `bounded-control`의 401/403은 해당 제어 epoch에 한해 기존 최대 30초를
사용하고, 제어 epoch가 바뀌면 재확인한다. 이 프로필의 갱신 오류 503도 최대 1초 대기한다.

## 키 회전과 복구

`NAKWOL_SESSION_SECRET`은 현재 쿠키 키다. 정상 회전 시 이전 키를
`NAKWOL_SESSION_PREVIOUS_SECRET`, 그 키를 읽을 마지막 Unix 시각(밀리초)을
`NAKWOL_SESSION_PREVIOUS_UNTIL`에 설정한다. 이전 키의 허용 기간은 유한하며 기존 쿠키만 읽는다.
긴급 폐기 시 이전 키를 제거한다. 키가 맞지 않는 쿠키로 AUTH 요청을 보내지 않는다.

사이트 credential 회수는 `POST /developer/v1/apps/:clientId/site-credentials/:credentialId/revoke`
(JSON `reason`)로 수행한다. 새 credential 발급·호스팅 Secret 교체와 별개이며, 예전 credential에
결합된 세션은 다시 로그인해야 한다. 안정 핸들 탈취는 bearer 탈취이므로 키·credential·만료·회수
경계를 모두 유지한다.

## 브라우저 연동

공식 Embed는 서버 갱신 모드의 `/__nakwol/status`로 승인된 최소 사용자 상태를 읽고 중복 Discord
로그인을 시작하지 않는다. 이 endpoint는 승인 없이 사용자를 반환하지 않는다. 서버 세션에서
브라우저 DATA용 bearer를 만들어 내지는 않는다. DATA API의 별도 토큰 계약은 그대로다.

콜백은 state와 서버 보관 PKCE를 검증하고 저장된 같은 origin의 경로·query·hash로만 복귀한다.
인증 실패와 자산 subrequest는 보호 자료를 포함하지 않는다. 운영 OAuth와 실제 호스팅 검증은
로컬 fixture 결과와 따로 기록해야 한다.
