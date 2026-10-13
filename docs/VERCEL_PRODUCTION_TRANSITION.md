# NAKWOL AUTH Vercel 운영 전환

## 목적과 현재 상태

기존 Discord 애플리케이션과 운영 D1을 유지하면서 AUTH 실행 서버를 Vercel 서울 리전으로 추가한다. 사용자/운영자/서비스 권한/앱 등록/토큰을 시험 DB로 옮기거나 새로 생성하지 않는다. 기존 Cloudflare AUTH는 복구 경로로 유지한다.

2026-10-13 준비 확인:

- 운영 Cloudflare 계정: `6bcf3763605be651b9fff67cf25f5568`.
- 운영 Worker: `nakwol-auth`, 확인 버전 `7342e4bd-3af5-4a97-979b-1cdec2bda978`.
- 운영 D1: `nakwol-auth`, `7080aed9-a837-46f3-8ec5-584496a02965`.
- 읽기 전용 집계: 사용자172, AUTH 운영자1, 앱23, 수동 접근 허용1. 집계는 시점별로 달라질 수 있다.
- 기존 Discord Client ID: `1541341243576033330`. 기존 Secret 값은 조회하지 않았다.
- Vercel 프로젝트 `nakwol-auth-vercel` 생성, Node22 설정, Production 공개 환경변수7개 등록. 런타임 설정의 리전은 `icn1`.
- 예정 운영 AUTH 주소: `https://nakwol-auth-vercel.vercel.app`. Vercel 프로젝트 domain 등록/verified=true를 확인했다. **아직 운영 AUTH 실행 코드는 배포하지 않았다.**
- 기존 Cloudflare 서버, 운영 DB 데이터/스키마, 서비스 연결 주소, Secret은 변경하지 않았다. npm 게시도 하지 않았다.
- 운영에는 진단 migration `0015_auth_diagnostics.sql`이 아직 없다. 이 소스의 OAuth callback은 `diagnostic_ref` 컬럼을 읽으므로 배포 전에 migration이 필요하다.

이 문서는 운영 전환 준비 및 실행 절차다. 실제 Discord 로그인/KT 측정/트래픽 전환 완료 보고서가 아니다.

## 실행 구조와 보안

Vercel Node Function은 동일한 `src/sdk-entry.ts`를 직접 실행한다. Discord OAuth/PKCE/member/admin 정책을 별도로 복제하지 않는다. 운영 D1만 별도 secret 인증 브리지 Worker를 통해 접근한다. 브리지는 Cloudflare API 관리 토큰을 Vercel에 보내지 않는다.

운영 런타임은 다음 조건이 하나라도 맞지 않으면 SQL 요청 전에503으로 차단한다.

- `NAKWOL_AUTH_MODE=production`, Vercel의 `VERCEL_ENV=production`.
- 정확한 HTTPS `AUTH_ORIGIN`과 실제 Host. preview 호스트/forwarded-host로 authority를 바꾸지 못한다.
- 충분한 독립 브리지 Secret, HTTPS `/rpc`, 운영 DB ID pin. canary DB ID/동시 canary 플래그는 차단한다.
- 기존 Discord 앱의 Client ID/Secret, guild `1493410906456064112`, 시즌3 role `1553600098661957643`.

브리지는 같은 DB ID header와 Secret을 확인한다. canary 브리지는 production pin 요청을 거부한다. 운영 브리지는 CRUD/SELECT/WITH 문장만 허용하고 exec/DDL은 거부한다. 제한/timeout/no-retry/원자적 D1 batch 계약은 유지한다. DB 장애는 인증 성공이 되지 않는다. 완료되지 않은 쓰기의 timeout은 결과가 불확실하므로 자동 재시도하지 않는다.

`/deployment/status`의 `configuration_ready`는 필수 환경변수 검사만 뜻한다. DB 스키마, Discord callback 등록, 실제 로그인, KT 성능이 통과했다는 의미가 아니다. 운영 auth 응답은 no-store; 공개 SDK/배포 파일의 캐시 계약은 보존한다.

### 비용과 한계

보호 사이트의 유효한 authorization lease 요청은 기존 공통 게이트에서 로컬 암호 검증 후 자산을 제공한다. 이번 수정은 lease 시간/세션 만료/정책을 완화하지 않고 자산별 D1 조회도 추가하지 않는다.

중앙 AUTH가 실제 DB를 사용할 때는 SQL 작업마다 Vercel→Cloudflare 브리지 왕복이 있다. DB까지 Vercel로 이관한 구조가 아니다. KT→Vercel의 실제 로그인/재검증 측정 후 허용할 수 있는지 판단한다. D1 장애 의존성도 남는다.

Vercel 진단 rate guard는 플랫폼이 덮어쓰는 IP header를 공식 헬퍼로 읽고 서버 HMAC 값으로만 네트워크를 구분한다. raw IP를 보고서/DB에 기록하지 않고 가짜 CF header는 제거한다. CF ASN/colo 정보를 위조하지 않는다. 기존 global300/hour 및 network6/hour 제한은 유지한다. metadata가 없는 요청은 보수적 공통 bucket을 사용한다. [Vercel header 계약](https://vercel.com/docs/headers/request-headers)

봇 없는 OAuth 로그인은 가능하다. 기존 봇을 사용하는 운영자 재조회 기능까지 Vercel에서 제공하려면 해당 Bot Secret도 새 서버에 별도 등록해야 한다. 그전에는 기존 Cloudflare 관리자 페이지를 사용하며 공유 D1에 반영되는 조치는 양쪽에 적용된다. Bot Secret을 임의로 재발급하지 않는다.

## 1. 소스와 운영 대상 확정

`BRANCHING.md`의 dev→main→stable 승격/CI를 따른다. 준비 feature의 빌드 성공을 운영 승인으로 대체하지 않는다. production 배포는 검증된 stable 소스로 진행한다. 기존 Cloudflare source/vars와 새 DB writer를 동시에 임의 변경하지 않는다.

저장소 루트에서 읽기 전용 preflight를 실행한다:

```powershell
node scripts/prepare-vercel-production.mjs --account-id 6bcf3763605be651b9fff67cf25f5568 --auth-origin https://nakwol-auth-vercel.vercel.app
```

로컬 Wrangler가 다른 위치에 있으면 `--wrangler ABSOLUTE_PATH`를 지정한다. 도구는 Worker 현재100% 버전의 D1 바인딩과 DB 이름을 대조하고 내부 앱/스키마/마이그레이션 이력/집계만 읽는다. Secret 값이나 개별 사용자/토큰을 읽지 않는다. DB create/seed/migration/update를 실행하지 않는다.

산출물은 ignored `.wrangler/vercel-production/`에만 생성한다:

- `verified-profile.json`: 시점별 확인 결과, DB/프로젝트 pin, 기존 내부 콜백에서 없는 신규 URI 목록.
- `readonly.wrangler.json`: 기존 운영 Worker/DB 이름의 읽기 점검 및 Secret 등록 대상.
- `migrations.wrangler.jsonc`: 같은 운영 DB와 repository migrations 경로가 명시된 별도 migration 대상.
- `bridge.wrangler.jsonc`: 같은 DB에 바인딩할 별도 `nakwol-auth-vercel-db` Worker.
- `vercel-server-env.json`: 공개 설정만. Secret은 포함하지 않는다.

현재 pending migration은0015 하나였다. 다른 pending migration/바인딩 변화/앱 비활성화가 보이면 그 변화부터 검토한다. 이전 seed migration을 수동 재실행하면 앱 정책/콜백을 덮어쓸 수 있으므로 하지 않는다.

## 2. 운영 artifact와 브리지 준비

```powershell
node scripts/build-vercel-auth-production.mjs
npm ci --prefix deploy/vercel-auth-production --ignore-scripts
npm run build --prefix deploy/vercel-auth-production
```

Upload는 생성된 `deploy/vercel-auth-production`만 사용한다. 공통 runtime/wrapper/build config를 재사용하며 새 인증 구현을 복사하지 않는다. `public`에는 robots.txt만 있다. 브리지 bundle, SQL, .env, .vercel, 로그는 업로드에서 제외된다. Vercel link가 만든 `.env.local`도 제외된다.

새 프로젝트의 Production 공개 설정:

| 변수 | 값 |
| --- | --- |
| NAKWOL_AUTH_MODE | production |
| AUTH_ORIGIN | https://nakwol-auth-vercel.vercel.app |
| D1_BRIDGE_DATABASE_ID | 7080aed9-a837-46f3-8ec5-584496a02965 |
| DISCORD_CLIENT_ID | 1541341243576033330 |
| NAKWOL_GUILD_ID | 1493410906456064112 |
| NAKWOL_MEMBER_ROLE_ID | 1553600098661957643 |
| D1_BRIDGE_URL | https://nakwol-auth-vercel-db.sepsd21.workers.dev/rpc |

`NAKWOL_VERCEL_CANARY=true`는 운영 환경에 넣지 않는다. VERCEL_ENV는 플랫폼이 설정하며 직접 조작하지 않는다. 별도 충분히 무작위인 D1_BRIDGE_SECRET을 생성해 새 브리지 Worker와 Vercel Production의 Sensitive Secret으로만 등록한다. 실제 운영 DB writer 배포는 검증된 stable source와 운영 적용 승인 후 진행한다.

```powershell
npx wrangler deploy --config .wrangler/vercel-production/bridge.wrangler.jsonc
npx wrangler secret put D1_BRIDGE_SECRET --config .wrangler/vercel-production/bridge.wrangler.jsonc
```

브리지 Secret이 없는 동안은 요청이503으로 차단된다. 기존 운영 Secret/DB/Worker를 교체하지 않는다. 새 브리지에 인증된 SELECT만 보내 DB ID pin과 기본 읽기를 확인한다. 무인증/잘못된 key/pin/DDL은 거부되어야 한다. 임의 사용자나 운영자 fixture를 운영에 넣지 않는다.

stable 승격으로 기존 AUTH deploy workflow가0015를 적용했다면 preflight를 다시 실행해 확인한다. 별도로 적용해야 할 경우 **현재 pending 목록이 검토한0015뿐인지 확인하고** 아래를 실행한다. 승인 없이 준비 도구가 실행하는 명령은 아니다.

```powershell
npx wrangler d1 migrations list DB --remote --config .wrangler/vercel-production/migrations.wrangler.jsonc
npx wrangler d1 migrations apply DB --remote --config .wrangler/vercel-production/migrations.wrangler.jsonc
```

이전 마이그레이션을 다시 실행하거나 bootstrap.sql로 운영 앱을 시험 origin으로 바꾸지 않는다. 준비 단계에서는 위 writes를 실행하지 않았다.

## 3. 내부 콜백을 추가하고 변경 영수증 보존

외부 개발자 서비스의 callback URI/앱 ID는 유지한다. 내부 selftest/admin/CLI/account의 새 중앙 주소 URI만 추가한다. 홈페이지/정책/소유자/운영자/수동 권한은 수정하지 않는다. 기존 Cloudflare URI는 삭제하지 않는다.

```powershell
node scripts/vercel-production-callbacks.mjs --profile .wrangler/vercel-production/verified-profile.json --action plan
```

실제 적용은 fresh profile(1시간 이내), 서버 전용 D1_BRIDGE_URL/SECRET, 명시한 DB ID 확인이 있어야 한다:

```powershell
node scripts/vercel-production-callbacks.mjs --profile .wrangler/vercel-production/verified-profile.json --action add --confirm-database 7080aed9-a837-46f3-8ec5-584496a02965
```

D1 batch로 원자적 적용한다. 재실행은 기존 URI를 중복 추가하지 않는다. 요청 전에 ignored 변경 영수증을 남기고, 응답이 확인되면 실제 changes=1인 항목만 changed에 기록한다. timeout/응답 불확실 상태는 자동 재시도/롤백하지 않는다. receipt는 이후 preflight를 다시 실행해도 유지된다.

Rollback은 새로 생성된 confirmed add receipt의 changed만 제거한다. 기존 URI와 다른 운영자가 추가한 다른 URI는 유지한다. preflight를 새로 실행해 DB 대상 확인을 갱신한 뒤:

```powershell
node scripts/vercel-production-callbacks.mjs --profile .wrangler/vercel-production/verified-profile.json --action remove --receipt PATH_TO_CONFIRMED_ADD_RECEIPT --confirm-database 7080aed9-a837-46f3-8ec5-584496a02965
```

## 4. 기존 Discord 앱의 Secret 갱신

기존 앱의 [OAuth2 설정](https://discord.com/developers/applications/1541341243576033330/oauth2)에 새 callback을 **추가**한다:

```text
https://nakwol-auth-vercel.vercel.app/auth/discord/callback
```

기존 Cloudflare callback은 유지한다. 기존 Secret을 모르는 상황에서는 새 앱을 만들지 않고, 같은 앱의 Secret을 갱신해 두 서버에 등록한다. Reset 이후 Cloudflare 갱신까지 새 로그인이 실패할 수 있으므로 source/schema/브리지/프로젝트/도메인 준비를 먼저 마친다. Secret reset 자체는 Discord 화면에서 운영자가 수행한다.

등록 도구 대상 확인은 비밀값 입력 없이 가능하다:

```powershell
./scripts/register-production-discord-secret.ps1 -Profile ./.wrangler/vercel-production/verified-profile.json -Wrangler ./node_modules/wrangler/bin/wrangler.js -PlanOnly
```

준비 완료 후 -PlanOnly를 제거하면 숨겨진 입력으로 새 Secret을 한 번 받는다. stable source, fresh profile, 스키마 준비, DB/프로젝트 pin을 확인한다. Cloudflare 기존 Worker를 먼저 갱신해 기존 로그인을 복구하고, 같은 Secret을 Vercel Production에 Sensitive로 등록한다. 값은 CLI 인자/로그/파일/채팅으로 출력하지 않는다.

Vercel 등록이 실패해도 Cloudflare의 새 Secret을 이전 값으로 되돌리지 않는다. 같은 새 Secret으로 등록만 재시도한다. Discord에서 다시 Reset하면 먼저 등록한 Cloudflare도 다시 깨진다.

Vercel 환경변수는 재배포해야 적용된다:

```powershell
npx vercel deploy deploy/vercel-auth-production --prod --yes --project nakwol-auth-vercel --scope sepsd21-3069s-projects
```

처음 배포의 alias가 예정 AUTH_ORIGIN에 실제로 연결됐는지 확인한다. 다른 generated host는 의도적으로503이다. 도메인 확보/Secret 갱신/실제 운영 배포는 준비 완료로 대신 보고하지 않는다.

## 5. 기존 SDK/사이트 전환

기존 설치 사이트는 Cloudflare AUTH를 계속 사용할 수 있다. 새 서버 배포나 npm 게시만으로 저장된 authOrigin/빌드 결과가 자동 변경되지는 않는다. workers.dev 주소를 Vercel로 DNS 변경할 수도 없다. 기존 Cloudflare를 프록시로 유지하면 해당 회선의 Cloudflare 접근 구간도 남는다.

이번 CLI 수정은 명시한 `--auth-origin`을 Embed src/data-auth-origin, 서버 게이트 설정, 로컬 project config에 함께 반영한다. 다음 기본 protect update도 저장된 origin을 유지한다. doctor는 브라우저 marker와 config의 origin 불일치를 탐지한다. SDK의 기존 immutable 버전 파일은 수정하지 않는다. 새 설치의 기본 주소를 모든 사용자에게 바꾸는 작업도 이번 준비에서 하지 않았다.

공식 생성 게이트를 쓰는 사이트는 새 CLI 소스가 정식 배포된 뒤 기존 서비스 폴더에서:

```powershell
npx nakwol-connect protect install --provider cloudflare-workers --assets dist --url https://SERVICE/ --auth-origin https://nakwol-auth-vercel.vercel.app
npm run build
```

provider/assets/site URL은 기존 설정의 값을 사용한다. Cloudflare Pages는 기존 provider/project-name을 유지한다. 이후 그 서비스의 기존 배포 절차로 재배포한다. clientId/required/member/세션 Secret은 유지한다. 실제 검증:

```powershell
npx nakwol-connect doctor --url https://SERVICE/ --json
npx nakwol-connect protect verify --url https://SERVICE/ --paths /,/data.json,/image.webp --json
```

현재 registry 패키지가 이 변경을 포함한다고 가정하지 않는다. 준비 source는 npm에 게시하지 않았다. 검증/승격 뒤 새 CLI를 배포하고 버전을 명시해 전환한다. 공통 server 모듈을 직접 연결한 Vercel/다른 호스팅은 SDK init의 authOrigin과 서버 settings.authOrigin을 같이 변경해 배포한다. 호스팅별 게이트를 제거하거나 이 문서의 AUTH Function으로 보호 사이트 자체를 대체하지 않는다.

중앙 쿠키는 host 전용이므로 기존 Cloudflare 로그인 쿠키가 새 Vercel domain으로 자동 전달되지 않는다. 전환 시 한 번 새 중앙 로그인이 필요할 수 있다. 이후 전환된 사이트들이 같은 새 authority를 사용하면 기존 SDK의 SSO를 사용한다. mixed authorities의 무조건 무로그인 이동은 구현했다고 주장하지 않는다. 사이트 세션/lease의 origin binding은 유지한다.

## 6. 운영 acceptance와 복구

소스/로컬 테스트 통과 뒤에도 운영 수용 검사는 별도로 진행한다:

- 실제 기존 Discord 계정 로그인 → 기존 user ID/서비스 권한/운영자 동일 확인.
- 실제 시즌3 회원 허용, 비회원/다른 앱 토큰/권한 회수/재인증 요청 거부.
- PKCE 단회 코드, secure/HttpOnly 쿠키, 새 alias/잘못된 Host/생성 preview URL 거부.
- 브리지 오류/timeout에서 보호 콘텐츠 fail-open 없음. Secret/SQL/사용자 상세가 오류/로그에 노출되지 않음.
- 전환 서비스의 HTML/JS/CSS/JSON/이미지/폰트/다운로드에 cookie 없음·변조·만료·GET/HEAD/Range·직접 주소 모두 차단. protect verify와 실제 member 요청 둘 다 확인.
- 동일한300 이미지 요청에서 유효 lease 동안 중앙 /me/브리지 호출0. lease 만료 동시 요청의 single-flight 유지.
- KT와 정상 회선에서 AUTH ping/앱 DB 확인/실제 로그인·재검증/전체 페이지 TTFB·로딩시간을 비교. 위 단일 로컬/다른 회선 결과를 KT 개선으로 대신 보고하지 않는다.
- 운영자 재조회/수동 권한/세션 해제 지원 확인. Bot Secret이 없으면 해당 재조회는 기존 Cloudflare 관리자로 확인.

초기에는 한 서비스씩 명시적으로 전환하고 관측한다. 이상 시 해당 서비스의 브라우저 SDK와 서버 게이트 origin을 같이 기존 Cloudflare 주소로 돌리고 재배포한다. 사용자/권한 DB는 공유하므로 DB를 되돌리거나 오래된 사본으로 교체하지 않는다. 추가 콜백은 장애 복구에 방해되지 않으며 필요하면 confirmed receipt로만 제거한다.

새 Discord Secret은 Cloudflare에 계속 유지한다. 과거 Worker 버전으로 복원할 때 그 버전의 과거 Secret을 재사용해서는 안 된다. 복구 후 반드시 현재 새 Secret과 callback 설정을 다시 확인하고 실제 로그인한다. 진단 additive schema는 데이터 삭제 rollback을 하지 않는다.

## 검증 근거

ignored `.wrangler/vercel-production/`에 preflight 집계/마이그레이션 차이, adapter/production/CLI/full-test/typecheck/fresh-install/build 로그를 보존한다. 로컬 통합은 실제 Miniflare D1과 loopback HTTP/Node wrapper를 사용하며 Discord 외부 HTTP만 모의한다. 운영 DB에는 fixture를 넣지 않았다. 실제 Secret 갱신/운영 SQL 쓰기/운영 auth 배포/KT 검사는 아직 수행하지 않았다.

### 인증 주소 변경의 원자성

보호 설치가 완료된 서비스의 인증 주소는 `protect install --auth-origin <새 주소>`로 Embed·게이트·설정을 함께 갱신합니다. `init`, `sync`, `add-url`, `data set`에서 다른 인증 주소를 지정하면 API 호출이나 파일 변경 전에 거부합니다. `protect update`는 저장된 인증 주소를 유지합니다.

운영 DB bridge는 prepared statement 한 문장만 허용합니다. SQL 본문의 세미콜론과 DDL·exec를 실행 전에 거부하며, 바인딩된 데이터의 세미콜론은 허용합니다. 스키마 마이그레이션은 Wrangler의 별도 운영 절차로 수행합니다.
