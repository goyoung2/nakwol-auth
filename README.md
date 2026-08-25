# NAKWOL AUTH

낙월(落月) 서비스들의 중앙 인증·SSO 및 NAKWOL Connect Control Plane입니다.

## 역할

- Discord OAuth 진입점
- NAKWOL ID 발급 및 사용자 식별
- 낙월 길드/역할 기반 membership 판정
- Authorization Code + PKCE
- 앱별 access token 및 `/me`
- 중앙 SSO session
- NAKWOL AUTH Web SDK 배포
- NAKWOL Connect 앱/개발자/CLI 관리
- 코딩 LLM용 agent-first 앱 등록·자동 설치

## 운영 엔드포인트

- Auth origin: `https://nakwol-auth.sepsd21.workers.dev`
- Health: `/api/health`
- Demo: `/demo`
- 앱 관리자: `/admin/apps`
- CLI 개발자 관리자: `/admin/developers`
- CLI device 승인: `/connect/device`
- CLI manifest: `/connect/cli/manifest.json`
- CLI v0.2.0 tarball: `/connect/cli/v0.2.0/nakwol-connect.tgz`
- 새 프로젝트 agent contract: `/connect/agent`
- 등록 앱 agent contract: `/connect/agent/{client_id}`
- LLM discovery: `/llms.txt`
- Universal Embed fallback: `/connect/v1.js`
- Web SDK manifest: `/sdk/manifest.json`
- Web SDK v0.1.0: `/sdk/v0.1.0/nakwol-auth-web.js`

## Agent-first 앱 연동

새 프로젝트에서 코딩 LLM에게 다음 명령을 실행시키는 것이 기본 경로입니다.

```bash
npx --yes https://nakwol-auth.sepsd21.workers.dev/connect/cli/v0.2.0/nakwol-connect.tgz init
```

CLI가 프로젝트를 분석하고, 필요하면 브라우저 device authorization을 요청하고, 중앙 Worker에 앱을 등록한 뒤, 소스 수정과 `doctor` 검증까지 수행합니다.

사람은 처음 CLI 승인 때 NAKWOL 로그인 후 **이 CLI 허용**을 누르는 것만 정상적인 interactive 단계입니다.

자세한 내용:

- [CLI.md](./CLI.md) — LLM/CLI 사용법
- [CONNECT.md](./CONNECT.md) — Connect 구조와 fallback
- [WEB_SDK.md](./WEB_SDK.md) — 저수준 Web SDK

## 권한

- `owner` / `operator` / Discord `admin`: 전체 Connect 관리
- `developer`: 현재 낙월 맹원인 동안 CLI 사용 + 자기 소유 앱 관리
- 일반 `member`: 앱 사용

운영자는 `/admin/developers`에서 developer 권한을 부여/해제합니다. 해제 시 해당 사용자의 CLI token도 revoke됩니다.

## 저장소 경계

이 저장소만 AUTH Worker, D1 migrations, Web SDK, NAKWOL Connect Control Plane, Connect CLI 소스의 소유권을 가집니다. 각 앱과 각 코딩 LLM은 공개 API/SDK/CLI만 사용하며 AUTH D1이나 Cloudflare 계정에 직접 접근하지 않습니다.

## 배포 원칙

기존 Cloudflare Worker `nakwol-auth`와 기존 D1 `nakwol-auth`를 그대로 사용합니다. GitHub Actions가 CLI npm tarball을 빌드하고 Worker asset으로 포함한 뒤 기존 Worker에 `--keep-vars`로 배포합니다.

Discord Client Secret은 Cloudflare Worker secret에만, Cloudflare CI API Token은 GitHub Actions secret에만 유지합니다. Connect CLI에는 둘 다 전달하지 않습니다.
