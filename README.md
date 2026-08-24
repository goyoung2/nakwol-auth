# NAKWOL AUTH

낙월(落月) 서비스들의 중앙 인증·SSO 인프라입니다.

## 역할

- Discord OAuth 진입점
- NAKWOL ID 발급 및 사용자 식별
- 낙월 길드/역할 기반 membership 판정
- Authorization Code + PKCE
- 앱별 access token 및 `/me`
- 중앙 SSO session
- NAKWOL AUTH Web SDK 배포
- NAKWOL Connect 앱 등록/설치 가이드/연동 진단

## 운영 엔드포인트

- Auth origin: `https://nakwol-auth.sepsd21.workers.dev`
- Health: `/api/health`
- Demo: `/demo`
- NAKWOL Connect 관리자: `/admin/apps`
- Universal Embed: `/connect/v1.js`
- Connect manifest: `/connect/manifest.json`
- SDK manifest: `/sdk/manifest.json`
- Web SDK v0.1.0: `/sdk/v0.1.0/nakwol-auth-web.js`

## 가장 쉬운 앱 연동

운영자가 `/admin/apps`에서 앱을 등록하면 개발 환경에 맞는 설치 위치와 복사 가능한 코드를 자동 생성합니다. 일반 HTML/Vite/React/Vue 계열은 보통 공통 `index.html`의 `</body>` 바로 위에 한 덩어리만 넣으면 됩니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="my-app"
  data-redirect-uri="https://my-app.pages.dev/">
</script>
```

상세 내용은 [CONNECT.md](./CONNECT.md)와 [WEB_SDK.md](./WEB_SDK.md)를 참고합니다.

## 저장소 경계

이 저장소만 AUTH Worker, D1 migrations, Web SDK, NAKWOL Connect의 소유권을 가집니다. 각 앱은 NAKWOL AUTH의 공개 API/SDK만 사용하며 AUTH D1에 직접 접근하지 않습니다.

## 배포 원칙

기존 Cloudflare Worker `nakwol-auth`와 기존 D1 `nakwol-auth`를 그대로 사용합니다. 저장소 이관은 인프라 재생성이 아니라 소스/배포 소유권의 이동입니다.

Discord Client Secret 및 기타 비밀값은 GitHub 코드에 저장하지 않고 Cloudflare Worker secrets/variables에 유지합니다.
