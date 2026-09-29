# 서버 보호 설치와 배포 증거 (Connect 0.8.0)

이 문서는 소스 계약입니다. npm 게시, AUTH 배포, 개별 사이트 배포 여부는 별도 기록합니다.

## Vercel 정적 빌드

```sh
nakwol-connect protect install --provider vercel --assets dist --url https://example.com/
npm install
npm run build
```

Vercel 환경 변수에 서버 전용 `NAKWOL_SESSION_SECRET`을 무작위 32자 이상으로 설정한 후 배포합니다. `middleware.js`는 `/:path*` 전체를 공통 게이트에 연결하며 `@vercel/functions@3.9.9`의 `next()`는 승인 뒤에만 호출됩니다. AUTH가 Discord OAuth를 담당합니다.

기존 middleware/proxy, vercel.json/ts, API/functions, prebuilt `.vercel/output` 설정을 자동 덮어쓰지 않습니다. Next/SSR은 이 자동 설치 대상이 아닙니다. Preview도 보호되지만 등록된 `siteUrl`과 origin이 다르면 403입니다. 별도 주소를 사용하려면 등록·배포 설정을 별도로 일치시켜야 합니다.

Workers/Pages는 기존 생성물과 공통 게이트를 사용합니다. 어댑터는 인증 로직을 따로 구현하지 않습니다. `inspect`/`doctor`/`protect status`는 기존 필드와 함께 `schemaVersion`, `capabilities`를 제공합니다.

## manifest 생성 및 검사

빌드와 게이트 갱신을 마친 뒤 배포 ID를 지정하여 공개 출력 폴더 밖에 생성합니다. 기존 파일은 덮어쓰지 않습니다.

```sh
nakwol-connect protect manifest --deployment-id DEPLOYMENT_ID --output-file evidence.json
nakwol-connect protect verify --manifest evidence.json --origins-file origins.json --session-cookie-env NAKWOL_VERIFY_COOKIE --expect-runtime installed --json
```

`NAKWOL_VERIFY_COOKIE`는 검사 전용 정상 사용자 세션의 Cookie 헤더입니다. 안전한 로컬 환경 또는 CI secret으로 공급하고 코드·명령행 인수·보고서에 넣지 않습니다. 검사기는 이 쿠키를 primary origin에만 보내며 리다이렉트에 전달하지 않습니다. manifest 없이 기존 `--paths` 검사도 사용할 수 있으나 익명 차단 검사 범위에 한정됩니다.

manifest schema 1:

- `deploymentId`, `runtimeVersion`, `capabilities`
- `files`: `{path,size,sha256,canary?}` 배열. canary는 검사 fixture용 선택값입니다.
- `buildHash`: 경로순 정렬된 `{path,size,sha256}` 배열의 JSON을 SHA256한 값
- `manifestHash`: 검사기가 manifest 원문을 해시하여 결과에 기록

설치된 파일 전체 경로·크기·해시와 manifest가 일치해야 합니다. 검사 중 manifest가 바뀌면 증거가 무효입니다. `release-check`는 플랫폼의 현재 배포 ID를 검사 전후 확인합니다. 독립 `verify`만으로 플랫폼 배포 ID를 증명하지는 않습니다.

`origins.json` 예시: `{"schemaVersion":1,"origins":["https://example.com/","https://old-deployment.example.com/"]}`.

`--discover-origins`는 명시적으로 등록한 Cloudflare Pages 프로젝트에 한하여 read-only API로 최대 100개 배포 주소를 찾습니다. 현재 등록 위치는 `.nakwol-connect.json`의 `protection.rollback`에 있는 provider/accountId/projectName이며 자동 롤백 활성화는 필요하지 않습니다. `CLOUDFLARE_API_TOKEN`은 해당 계정·프로젝트 조회 권한만 부여합니다. Workers/Vercel 발견은 `unsupported`이며 주소 파일로 입력해야 합니다. 불완전한 발견은 출시 합격으로 처리하지 않습니다. 중앙 AUTH가 사용자 URL을 가져오는 기능은 추가하지 않았습니다.

## 결과 해석

- `ok`: 열거한 경로의 익명 차단 검사. 401만으로 정상 서비스 존재를 증명하지 않습니다.
- `releaseAccepted`: manifest 전체 정상 인증 파일 해시도 확인된 경우에만 true. `release-check`의 종료 성공은 이 값을 요구합니다.
- `originResults`: `verified`, `exposed`, `unreachable`, `unknown`. 다른 origin은 정상 세션을 전달하지 않으므로 익명 차단 성공이어도 unknown일 수 있습니다. 폐쇄 증거 없이 `closed`로 추정하지 않습니다.
- `probeCount`: 논리 검사 수. `requestCount`: 리다이렉트를 포함한 실제 HTTP 요청 수.

GET/HEAD/Range/잘못된 쿠키와 manifest 모드의 원주소 캐시·조건부 요청을 검사합니다. 401 본문의 알려진 canary/파일 해시, 2xx, 익명 304, 같은 origin 리다이렉트 뒤 공개 응답은 노출입니다. 404·503·연결 실패는 검증 성공도 노출 증거도 아닙니다. 응답은 최대 1 MiB만 읽고 초과는 부분 검사로 남깁니다. 다른 origin 리다이렉트와 여러 단계 리다이렉트는 추적하지 않습니다.

중앙에는 digest·runtime·검사 수·배포 ID 요약만 전송합니다. 파일 경로·본문·쿠키를 보내지 않습니다. 기존 schema 1 보고는 읽을 수 있지만 과거의 헤더 검사 기록으로 자동 롤백을 승인하지 않습니다. 이전 배포를 새 기준으로 재검증해야 합니다. 자동 롤백은 실제 노출 증거가 있을 때만 수행합니다.

## 업데이트와 수용 범위

0.7.x 사이트는 자동으로 0.8.0으로 바뀌지 않습니다. 게시 후 명시적으로 0.8.0을 선택해 갱신·빌드·배포·검증합니다. 새로운 범위 훅은 `~0.8.0`이며 managed 모드는 exact dependency와 lockfile을 유지합니다. 5분 lease·1시간 사이트 세션·캐시 보안 계약은 유지됩니다.

로컬 Workerd와 실제 Vercel `next()` 실행은 각각 검증하지만, 실제 Vercel CDN 라우팅/304/재작성 순서와 세 플랫폼 운영 OAuth는 배포 수용 검증으로 별도 수행해야 합니다.
