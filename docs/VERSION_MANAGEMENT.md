# 구성 요소 버전과 배포 확인

AUTH, Connect CLI·서버 게이트, Web SDK, DATA, DATA 스키마는 독립적으로 버전이 올라갑니다. 모든 숫자를 한 버전으로 합치지 않습니다.

## 소스의 기준

- AUTH: 루트 `package.json`과 AUTH health 응답 선언.
- Connect: `packages/connect-cli/package.json`. 배포 manifest와 공통 게이트 버전이 반드시 일치해야 합니다.
- Web SDK: `src/sdk.ts`의 stable 선언과 해당 버전 자산.
- DATA: `services/data/package.json`, `services/data/src/domain.ts`의 서비스·스키마 버전.
- README의 구성 요소 표는 `npm run versions:sync`로 생성합니다. `npm run versions:check`와 전체 CI는 불일치를 거부합니다.

이 표는 브랜치의 소스 상태입니다. 운영이나 npm 게시 여부는 별도로 확인합니다. 개발판·릴리스 후보를 운영판으로 표기하지 않습니다. 과거 태그와 릴리스 증거는 당시 상태를 보존합니다.

## npm 게시 안전장치

`stable` 승격 검사, 전체 테스트와 타입 검사 뒤 공식 레지스트리를 읽습니다. 네트워크 오류·401·403·429·5xx는 미게시로 해석하지 않습니다. 게시 workflow는 직렬 실행합니다.

이미 게시된 정확한 버전은 소유 저장소와 tarball 주소, 무결성 및 파일 목록·내용을 검증합니다. 압축 메타데이터 차이는 파일 내용 대조로 구분합니다. Git 텍스트 파일의 Windows CRLF/LF 차이만 정규화하고, 그 밖의 파일 내용이 다르면 새 버전이 필요합니다. 같은 내용은 다시 게시하지 않습니다. 새로 게시하는 이전 버전이 `latest`를 낮추는 경우도 거부합니다.

게시 뒤 최대 24회·5초 간격으로 공개 레지스트리의 정확한 버전을 확인하고 해당 버전의 CLI를 실행합니다. 조회되지 않으면 실패로 기록하며 게시 성공이나 운영 기준으로 기록하지 않습니다. 수동 재실행에서도 같은 검사를 사용합니다.

## 배포 순서

1. 기능 변경에 맞는 구성 요소만 버전을 올리고 source/runtime 정합성을 맞춥니다. 패키지 파일을 변경하면서 기존 npm 버전을 재사용하지 않습니다.
2. `npm run versions:sync`, `npm test`, `npm run typecheck`를 수행합니다.
3. `fix/* -> dev -> main -> stable`의 검토·승격 경로를 따릅니다.
4. stable의 명시된 배포·게시 경로를 실행합니다. AUTH 배포 검사는 package manifest에서 기대 Connect 버전을 읽습니다.
5. AUTH `/api/health`, `/sdk/manifest.json`, `/connect/cli/manifest.json`, DATA `/api/health`, npm의 정확한 버전을 각각 확인합니다.
6. 필요한 운영 검증이 완료된 뒤에만 component tag와 GitHub Release를 기록합니다.

버전이 같다는 사실은 전체 기능·보안·성능 검증을 대신하지 않습니다. 소비자 서버 게이트는 중앙 AUTH 배포만으로 교체되지 않으며 패키지 업데이트·빌드·재배포가 필요합니다. `0.x` minor 상승은 별도 호환성 검토가 필요합니다.
