# NAKWOL AUTH Web SDK v0.1.0

낙월 서비스용 브라우저 인증 SDK입니다. 각 서비스가 Discord OAuth를 직접 구현하지 않고 중앙 `NAKWOL AUTH`를 사용하도록 합니다.

## 배포 URL

버전 고정(권장):

```text
https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js
```

stable 별칭(개발/실험용):

```text
https://nakwol-auth.sepsd21.workers.dev/sdk/nakwol-auth-web.js
```

manifest:

```text
https://nakwol-auth.sepsd21.workers.dev/sdk/manifest.json
```

운영 서비스는 버전 고정 URL을 사용합니다. stable 별칭은 향후 SDK 업데이트 때 내용이 바뀔 수 있습니다.

## 사전 조건

NAKWOL AUTH의 `applications` 테이블에 다음이 등록되어 있어야 합니다.

- `client_id`: 앱의 고유 ID
- `redirect_uris`: callback으로 허용할 정확한 URL 목록
- `status`: `active`

브라우저 앱에는 Discord Client Secret이나 NAKWOL AUTH 비밀값을 넣지 않습니다.

## 가장 빠른 연결

```html
<script type="module">
  import {
    NakwolAuthClient,
    mountNakwolAuthWidget,
  } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js';

  const auth = new NakwolAuthClient({
    clientId: 'my-app',
    redirectUri: 'https://my-app.pages.dev/',
  });

  const widget = mountNakwolAuthWidget(auth);
  const user = await widget.ready;

  if (user?.membership?.is_member) {
    console.log('낙월 맹원', user.id);
  }
</script>
```

## Headless 사용

UI를 앱에서 직접 만들 경우 widget을 사용하지 않습니다.

```js
import { NakwolAuthClient } from 'https://nakwol-auth.sepsd21.workers.dev/sdk/v0.1.0/nakwol-auth-web.js';

const auth = new NakwolAuthClient({
  clientId: 'my-app',
  redirectUri: 'https://my-app.pages.dev/',
});

const user = await auth.bootstrap();

if (!user) {
  loginButton.onclick = () => auth.login();
} else {
  console.log(user.id, user.display_name, user.membership.role);
}
```

## 주요 API

### `new NakwolAuthClient(options)`

필수:

- `clientId`

선택:

- `redirectUri`: 기본값은 현재 `origin + pathname`
- `authOrigin`: 기본값은 운영 NAKWOL AUTH Worker
- `storage`: 기본값은 `sessionStorage`
- `fetchImpl`: 테스트/특수 환경에서 fetch 교체용

### `await auth.bootstrap()`

한 번에 다음을 처리합니다.

1. OAuth callback 여부 확인
2. `state`와 PKCE verifier 검증
3. authorization code를 access token으로 교환
4. 기존 access token이 있으면 `/me` 조회
5. 현재 NAKWOL 사용자 또는 `null` 반환

### `await auth.login()`

PKCE verifier/challenge와 state를 생성한 뒤 `/authorize`로 이동합니다. 중앙 AUTH 세션이 이미 있으면 Discord 화면 없이 SSO로 앱에 돌아올 수 있습니다.

### `await auth.getMe()`

현재 앱 access token으로 `/me`를 조회합니다.

### `auth.getAccessToken()`

현재 유효한 앱 access token을 반환합니다. 만료되었으면 `null`입니다.

### `auth.isAuthenticated()`

현재 앱 access token 존재 여부를 반환합니다.

### `auth.isMember()`

마지막 `/me` 결과가 `member` 또는 `admin`인지 반환합니다.

### `await auth.logout()`

현재 앱의 access token만 폐기합니다. 중앙 SSO 세션은 유지되므로 다시 로그인하면 Discord 화면 없이 돌아올 수 있습니다.

### `await auth.logout({ global: true })`

현재 앱 token을 폐기한 뒤 중앙 `nakwol_sid` 세션까지 로그아웃합니다.

## 이벤트

`NakwolAuthClient`는 `EventTarget`입니다.

```js
auth.addEventListener('ready', (event) => console.log(event.detail));
auth.addEventListener('user', (event) => console.log(event.detail));
auth.addEventListener('logout', () => {});
auth.addEventListener('error', (event) => console.error(event.detail));
```

이벤트:

- `loading`
- `loginstart`
- `token`
- `user`
- `ready`
- `logout`
- `error`

## 사용자 객체

```json
{
  "id": "usr_...",
  "display_name": "Discord 표시명",
  "avatar_url": "https://cdn.discordapp.com/...",
  "status": "active",
  "membership": {
    "is_guild_member": true,
    "is_member": true,
    "role": "member",
    "checked_at": 0
  }
}
```

앱의 데이터 소유권/외래키는 Discord ID가 아니라 `user.id` (`usr_...`)를 사용합니다.

## 보안 기준

- Authorization Code + PKCE(S256)
- state 검증
- access token은 기본적으로 `sessionStorage`에만 저장
- Discord Client Secret은 중앙 Worker에만 존재
- 앱은 D1에 직접 접근하지 않음
- callback URL은 서버에 등록된 정확한 URI만 허용
- `/token`, `/me`, `/logout`의 CORS origin은 등록 앱의 redirect origin 기준으로 제한
- 사용자 표시명/프로필 데이터는 SDK widget에서 `textContent`/DOM API로 렌더링

## 버전 정책

- `v0.1.0/...`: immutable. 기존 앱이 계속 같은 SDK를 사용해야 할 때 사용
- `/sdk/nakwol-auth-web.js`: stable alias. 다음 안정 버전으로 이동 가능
- breaking change는 major/minor 버전 URL을 새로 생성하고 기존 버전 URL은 유지

## 현재 레퍼런스 앱

`siege-calculator.pages.dev`가 첫 외부 연동 검증 앱입니다.

해당 앱은 향후 테스트용 자체 인증 구현을 제거하고 이 SDK의 버전 고정 URL을 소비하도록 전환합니다.
