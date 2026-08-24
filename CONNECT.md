# NAKWOL Connect v0.1

NAKWOL AUTH를 다른 개발자가 쉽게 붙일 수 있게 하는 앱 등록/설치 도구입니다.

## 운영자

배포 후 다음 주소를 사용합니다.

```text
https://nakwol-auth.sepsd21.workers.dev/admin/apps
```

최초 1회에는 낙월 맹원 한 명이 `첫 운영자로 등록`을 눌러 owner가 됩니다. 그 뒤에는 등록된 operator 또는 Discord admin 역할만 앱을 관리할 수 있습니다.

관리 화면에서 입력하는 값:

- 앱 이름
- Client ID
- 서비스 주소
- Redirect URI 1~10개
- 개발 환경
- 접근 정책(public / member / admin)
- active / disabled 상태

앱을 저장하면 프레임워크별 설치 위치와 복사 가능한 코드가 자동 생성됩니다.

## 가장 쉬운 연동

일반 HTML, Vite, React, Vue 등은 공통 HTML의 `</body>` 바로 위에 다음 스크립트를 넣습니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="my-app"
  data-redirect-uri="https://my-app.pages.dev/">
</script>
```

스크립트가 자동으로 NAKWOL AUTH Web SDK v0.1.0을 로드하고 로그인 위젯, PKCE callback, `/me`, logout을 처리합니다.

로그인 사용자 정보가 필요하면:

```js
window.addEventListener('nakwol-ready', (event) => {
  const user = event.detail;
  console.log(user?.id, user?.display_name, user?.membership);
});
```

UI 없이 인증만 사용할 경우:

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="my-app"
  data-redirect-uri="https://my-app.pages.dev/"
  data-ui="none">
</script>
```

이 경우 `window.NAKWOL_CONNECT.login()`, `logout()`, `getMe()`를 사용할 수 있습니다.

## Next.js

관리 화면이 `app/layout.tsx` 또는 `pages/_app.tsx`용 `next/script` 예제를 자동 생성합니다.

## 접근 정책

- `public`: Discord 로그인만 되면 사용 가능
- `member`: 현재 낙월 맹원(`membership.is_member`)만 authorization code 발급 가능
- `admin`: 현재 `membership.role === 'admin'`만 사용 가능

정책은 UI 표시용이 아니라 `/authorize`와 `/me`에서 서버가 강제합니다.

기존 `siege-calculator`는 호환성 유지를 위해 `public`으로 migration에 명시되어 있습니다.

## 연동 진단

관리 화면의 `연동 상태 확인`은 다음을 검사합니다.

- 앱 등록 상태
- Redirect URI 유효성
- 서비스 URL HTTP 응답
- HTML에서 `/connect/v1.js` 발견 여부
- HTML에서 해당 Client ID 발견 여부

Next.js 등 런타임 주입 방식에서는 정적 HTML 검사 결과가 제한적일 수 있습니다.

## 보안

- 브라우저 앱에는 Discord Client Secret을 넣지 않습니다.
- Universal Embed도 Authorization Code + PKCE(S256)를 사용합니다.
- 운영 API는 `nakwol-connect-admin` access token + operator/admin 권한을 요구합니다.
- operator가 0명일 때만 최초 맹원 bootstrap이 가능합니다.
- Client ID와 Redirect URI는 서버의 `applications` 테이블에 저장되며 exact-match 검증을 사용합니다.
