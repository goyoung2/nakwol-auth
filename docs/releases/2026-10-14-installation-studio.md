# AUTH 0.2.8 / Connect 0.7.8 — 설치 스튜디오와 Cloudflare 기본 인증

- CLI `wizard`: 단계별 질문, 상세 설명, 호스팅별 실행 명령, 기존 연결 설정 유지. 웹 `/developer/install`: 설정 입력, 단계 탐색, 명령 복사, LLM 지시문, 안내 다운로드.
- CLI와 웹은 같은 계획 생성기를 사용한다. 웹을 Vercel에서 열어도 신규 인증 주소는 `https://nakwol-auth.sepsd21.workers.dev`로 고정된다. 웹 입력으로 인증 서버를 변경할 수 없다.
- Vercel AUTH는 동일 코드와 공유 D1을 사용하는 운영자 관리 백업으로 유지한다. 자동 장애 전환이나 독립 DB 재해 복구는 제공하지 않는다. 기존에 Vercel 주소를 명시한 소비자는 자동으로 옮기지 않는다.
- `--json`·`--plan`·`--offline`은 `--apply`가 있어도 읽기 전용이다. 실제 적용은 기존 init/update 경로를 사용하며 배포·Secret 등록을 자동으로 수행하지 않는다. 수행하지 않은 보호 검사를 성공으로 표시하지 않는다.
- 기본 required/member, 서버 쿠키 암호화, 앱/사이트 바인딩, fail-closed, 1시간 권한 lease, GET/HEAD/Range 보호와 SDK 0.3.4는 유지한다. DATA/DB 스키마 변경은 없다.
- 기존 사이트는 AUTH 배포만으로 게이트가 바뀌지 않는다. 이미 0.7.7을 적용한 사이트에 이번 마법사 때문에 재설치를 요구하지 않는다. 신규 CLI는 npm0.7.8을 사용하고 생성 게이트 버전은0.7.8이다.
- 게시 전 전체 npm 테스트, 타입 검사, Vercel 어댑터 검사와 번들 검사를 수행한다. 운영에서는 양쪽 health/manifest/wizard를 확인하고 Vercel에서 생성한 계획도 Cloudflare를 가리키는지 검사한다.
- 직전 운영 AUTH0.2.7 source bda5667420e73ee05c0ef5631a68b8c023cd1b10 및 Connect0.7.7은 롤백 기준이다. 새 설치 패키지는0.7.8이며 이미 게시된 패키지를 덮어쓰지 않는다.
