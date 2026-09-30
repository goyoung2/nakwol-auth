# 서비스 설치·재설정 마법사

`/developer/setup`에서 서비스 소유자가 중앙 설정을 준비하고 공식 서버 게이트를 설치합니다. Connect CLI 0.14.0부터 `--setup-file`을 지원합니다. 운영 활성화에는 0022 마이그레이션, AUTH Worker 배포와 CLI 게시가 필요합니다.

## 흐름

1. 개발자 계정으로 서비스를 선택하거나 만듭니다. 새 서비스는 `member`이며 중앙 시즌3 조건을 사용합니다. 생성 ID는 고정되고 재시도해도 다른 ID를 붙여 앱을 추가 생성하지 않습니다.
2. HTTPS origin, 호스팅, 빌드 결과 폴더를 지정합니다. 저장 시 사이트 루트와 `/__nakwol/callback`을 추가하며 기존 등록 주소는 보존합니다.
3. 위젯 표시·구성·배치와 테마를 미리보고 저장·게시합니다. 로그인 전/확인 중/거부/장애/정상 사용자와 모바일 미리보기를 제공합니다. 로고·문구 등은 연결된 세부 편집기에서 관리합니다.
4. 유지·미사용 만료·권한 재확인 간격을 설정하고 실효값을 확인한 뒤 저장합니다. 2시간은 7,200초입니다. 중앙 상한과 필수 회원 조건은 완화할 수 없습니다.
5. 변경 비교 후 `nakwol-setup.json`을 프로젝트 루트에 다운로드합니다. 공개 빌드 폴더에 넣지 않습니다.
6. 로컬 변경 검토, 서버 게이트 설치, Secret 설정, 빌드, 배포, 차단 검증과 정상 로그인을 완료합니다.

중앙 저장, 로컬 설치·빌드, 배포, 미인증 차단, 정상 사용자 수용은 각각 다른 상태입니다. 마법사는 단계를 넘겼다는 이유로 배포·검증을 완료로 표시하지 않습니다.

## CLI와 재설정

먼저 프로젝트의 의존성을 설치하고 정적 빌드를 실행해 지정한 폴더에 `index.html`을 만듭니다. 프로젝트 고유의 빌드 명령을 따르세요. 게이트 설치 이후에는 수정된 로그인 연동이 반영되도록 다시 빌드합니다.

```sh
npm run build
npx --yes nakwol-connect@~0.14.0 protect plan --setup-file nakwol-setup.json
npx --yes nakwol-connect@~0.14.0 protect install --setup-file nakwol-setup.json
# 기존 설치 재설정에는 install 대신:
npx --yes nakwol-connect@~0.14.0 protect update --setup-file nakwol-setup.json
npm run build
```

`plan`은 현재 로컬 설정과의 차이를 보여 주며 설치 파일을 쓰지 않습니다. `install/update`는 기존 어댑터의 자산 검사·생성 파일 해시·관리 버전 검사를 수행합니다. 호스팅·출력 폴더·앱 변경 또는 수정된 게이트 파일은 자동 덮어쓰지 않습니다. 관계없는 CI, managed 채널의 exact dependency와 lockfile은 자동 변경하지 않습니다.

설정 JSON은 인증 수단이 아닙니다. CLI는 별도 개발자 로그인을 요구하고 중앙에서 현재 소유권과 해당 사용자가 만든 재개 기록을 확인합니다. 같은 앱의 다른 소유자도 타인의 재개 ID로 설치할 수 없습니다. 원본 작성 계정으로 승인하거나 자신의 새 설치 설정을 준비해야 합니다.

신규 마법사 설치는 AUTH 전용입니다. `dataIntegration: "none"`과 빈 scope일 때 doctor는 DATA 등록 검사만 생략합니다. 앱 상태·등록 URL·정책·게이트·미인증 차단은 계속 검사합니다. 기존 DATA 설정은 보존하고 `data set`으로 활성화하면 일반 DATA 검사가 복원됩니다.

## Secret과 재개

`NAKWOL_SESSION_SECRET`은 별도로 생성한 무작위 32자 이상 값을 호스팅 Secret에 등록합니다. `NAKWOL_SITE_CREDENTIAL`은 중앙에서 발급한 해당 앱·origin의 서버 갱신 자격증명입니다. 긴 로그인 유지에는 이 설정과 지원 게이트가 필요합니다.

자격증명 원문은 최초 발급 응답 한 번만 제공합니다. 같은 재개 작업이 동시에 실행돼도 발급은 하나이며 이후에는 ID와 발급 상태만 반환합니다. 원문은 서버 기록·JSON·URL·브라우저 저장소에 넣지 않습니다. 원문을 잃거나 해지한 경우 자동 재발급하지 않습니다. 명시적인 기존 자격증명 해지·신규 발급은 [서버 세션 문서](SERVER_SESSION_REFRESH.md)를 따릅니다. 발급한 설정을 다른 origin으로 옮길 수 없으며 별도 설치와 이전 배포 폐쇄 검증이 필요합니다.

각 저장 단계는 서버에 보관됩니다. 서비스를 다시 선택하면 본인이 최근 저장한 설정을 이어갑니다. 쓰기에는 현재 소유권·허용 Origin·최근 중앙 재인증·변경 사유가 필요합니다. `SETUP_CONFLICT_OR_STALE`(409)는 저장 버전 또는 중앙 정책·게시 디자인이 바뀌었다는 뜻입니다. 최신 값을 비교한 뒤 다시 저장하고 JSON도 새로 다운로드하세요. secret·알 수 없는 필드·완료 상태는 브라우저와 CLI의 동일 검증기가 거부합니다.

## 배포와 수용 검증

플랫폼별 Secret·배포 명령은 마법사와 설치 결과에 표시됩니다. Cloudflare Pages는 Functions fail-open을 비활성화하고 운영 브랜치를 지정합니다. Vercel은 필요한 환경의 Secret을 설정하며 등록하지 않은 preview origin은 차단됩니다.

```sh
npx --yes nakwol-connect@~0.14.0 doctor --url https://SITE/
npx --yes nakwol-connect@~0.14.0 protect verify --url https://SITE/
npx --yes nakwol-connect@~0.14.0 protect manifest --deployment-id ACTUAL_DEPLOYMENT_ID --output-file .nakwol-protection-manifest.json
npx --yes nakwol-connect@~0.14.0 protect verify --url https://SITE/ --manifest .nakwol-protection-manifest.json --session-cookie-env NAKWOL_TEST_SESSION
```

정상 사용자의 사이트 쿠키는 환경 변수로 별도 전달하며 JSON·명령줄 인자·저장소에 넣지 않습니다. manifest는 실제 배포한 동일 빌드와 실제 배포 ID에 묶습니다. 비로그인 차단만 통과한 결과는 출시 합격이 아닙니다. 정상 세션으로 파일 해시까지 일치해야 `releaseAccepted`가 됩니다. 실제 브라우저 로그인·새로고침·로그아웃·재로그인도 확인합니다.

이전 배포·미리보기·원본 저장소·별도 도메인은 자동 폐쇄되지 않습니다. `--alternate-origins`, `--origins-file`과 [보호 연동 문서](CONNECT_SERVER_PROTECTION.md)를 사용합니다. Workers Static Assets·Pages·Vercel 정적 빌드가 자동 설치 대상입니다. GitHub Pages의 보호 자료는 서버가 있는 호스팅으로 옮겨야 합니다. 다른 서버 환경은 `nakwol-connect/server` 연결과 별도 검증이 필요하며 Embed만으로 보호 완료가 되지 않습니다.

## 기존 서비스 영향

마법사 추가만으로 설치된 사이트의 게이트가 바뀌지는 않습니다. 지원하는 정책·디자인은 기존 계약대로 적용되며 자산 요청마다 마법사 API를 호출하지 않습니다. 구 renderer/adapter는 공식 update와 재배포가 필요합니다. 저장 성공은 모든 배포의 적용 증거가 아닙니다.
