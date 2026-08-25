# NAKWOL Connect v0.2

NAKWOL AUTH를 낙월 웹도구에 연결하는 통합 계층입니다.

v0.2의 기본 경로는 **사람이 코드를 복사해 넣는 것**이 아니라 **코딩 LLM이 공식 CLI를 실행해 프로젝트 분석 → 앱 등록 → 코드 수정 → 검증까지 수행하는 것**입니다.

## LLM에게 맡기기

새 프로젝트에서 다음 요청만 전달하면 됩니다.

```text
이 프로젝트에 NAKWOL Connect를 붙여줘.
다음 명령을 실행하고 프로젝트 분석, 앱 등록, 코드 수정, doctor 검증까지 끝까지 수행해.
파일 위치를 나에게 묻지 말고 프로젝트 구조를 직접 분석해.

npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

첫 CLI 사용 시에는 브라우저 승인 URL이 열립니다. 사람은 **NAKWOL 로그인 → 이 CLI 허용**만 누릅니다. Cloudflare API Token, Discord Client Secret, 별도 관리자 비밀번호는 LLM에 주지 않습니다.

자세한 CLI 문서: `CLI.md`

## 중앙 관리

Worker `nakwol-auth`가 NAKWOL Connect Control Plane입니다.

```text
LLM / CLI
   ↓ HTTPS
nakwol-auth Worker
   ↓
D1 applications / application_settings / CLI auth state
```

앱 등록/Client ID 발급/Redirect URI/접근 정책/소유권은 Worker API가 D1에 저장합니다.

### 앱 관리

```text
https://nakwol-auth.sepsd21.workers.dev/admin/apps
```

### CLI 개발자 권한 관리

```text
https://nakwol-auth.sepsd21.workers.dev/admin/developers
```

권한:

- owner / operator / Discord admin: 전체 Connect 관리
- developer: 현재 낙월 맹원인 동안 CLI 사용 + 자신이 만든 앱만 관리
- 일반 member: 앱 사용만 가능

## Machine contracts

새 프로젝트:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/agent
```

등록된 앱:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/agent/{client_id}
```

LLM discovery:

```text
https://nakwol-auth.sepsd21.workers.dev/llms.txt
```

CLI manifest:

```text
https://nakwol-auth.sepsd21.workers.dev/connect/cli/manifest.json
```

## 사람이 직접 붙이는 fallback

v0.1 Universal Embed는 계속 유지됩니다.

```html
<script
  src="https://nakwol-auth.sepsd21.workers.dev/connect/v1.js"
  data-client-id="my-app"
  data-redirect-uri="https://my-app.pages.dev/">
</script>
```

로그인 결과:

```js
window.addEventListener('nakwol-ready', (event) => {
  console.log(event.detail);
});
```

## 접근 정책

- `public`: Discord 로그인 사용자
- `member`: 현재 낙월 맹원
- `admin`: Discord 기준 admin

정책은 UI 표시용이 아니라 `/authorize`와 `/me`에서 서버가 강제합니다.

기존 `siege-calculator`는 호환성을 위해 `public`으로 유지합니다.

## 보안

- Discord Client Secret은 중앙 Worker에만 존재
- Cloudflare CI Token은 GitHub Actions에만 존재
- device code/CLI token은 D1에 hash만 저장
- CLI session token은 project 밖 사용자 홈 디렉터리에 저장
- `.nakwol-connect.json`에는 비밀값 없음
- developer 해제 시 CLI token revoke
- production URL은 CLI가 추측하지 않음
