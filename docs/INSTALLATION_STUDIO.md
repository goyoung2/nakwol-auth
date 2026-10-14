# 설치 스튜디오

CLI와 웹은 같은 `buildInstallationPlan`을 사용합니다. 웹 경로는 `/developer/install`이며 내 서비스 관리에서 이동할 수 있습니다.

## CLI

프로젝트 루트에서 공식 CLI의 `wizard` 명령을 실행합니다.

```sh
npx --yes nakwol-connect@0.7.8 wizard
npx --yes nakwol-connect@0.7.8 wizard --plan --url https://example.com/ --provider cloudflare-pages --assets dist --project-name example
```

일반 터미널은 번호 선택과 단계별 안내를 보여줍니다. `--json`/`--plan`/`--offline`은 계획만 반환하며 외부 등록이나 로컬 설치를 수행하지 않습니다. `--apply`는 기존 공식 명령을 호출해 연결 또는 저장된 게이트 갱신을 수행합니다. 배포와 Secret 등록은 직접 실행하고 실제 검증 결과를 확인합니다.

## 웹

1. 운영할 루트 URL, 호스팅, 빌드 폴더와 정책을 선택합니다.
2. 맞춤 설치 안내를 생성하고 단계별 설명과 명령을 확인합니다.
3. 명령 복사, LLM용 전체 지시문 복사 또는 안내 파일 내려받기를 사용합니다.
4. 앱 연결 후 `/developer/apps`에서 본인 서비스의 멤버 자격을 선택합니다.
5. 터미널의 실제 배포·차단 검사와 브라우저 로그인 결과를 확인합니다.

브라우저는 로컬 프로젝트를 읽거나 Secret을 입력받지 않습니다. 웹에서 계획을 만든 것은 설치·배포 완료가 아닙니다. 계획 API는 같은 AUTH origin만 허용하며 공개 설정만 받습니다. URL에 계정 정보를 넣거나 명령 치환 문자를 넣을 수 없습니다.

Cloudflare Workers·Pages 정적 빌드 외의 서버는 공통 `createGate` 어댑터를 기존 서버에 연결합니다. GitHub Pages는 서버가 있는 호스팅으로 이전하도록 안내합니다. 기존 앱 ID·콜백·Secret을 보존합니다.

Connect 0.7.8부터 제공합니다. 웹 주소는 https://nakwol-auth.sepsd21.workers.dev/developer/install 입니다. 신규 기본 인증 서버는 Cloudflare이고 Vercel은 운영자 관리 백업입니다. Vercel 웹 스튜디오에서도 생성되는 신규 계획의 AUTH 주소는 Cloudflare로 고정됩니다. 기존 설치의 인증 주소는 CLI에서 보존하며 자동으로 바꾸지 않습니다. 자동 장애 전환이나 Cloudflare DB로부터 독립된 백업은 이번 릴리스에 포함되지 않습니다.
