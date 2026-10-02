# 안전한 관리형 업데이트 보강

기준: `c348f4e4d61caba2b2925b2c5689e0d1510696e9`. 기존 상용 설계 §12와 T12의
하위 구현이다. 사용자가 승인한 자동 업데이트 방향과 다양한 호스팅 조건을 따른다.
운영 배포, 외부 사이트 수정, npm 발행, GitHub 권한 변경은 이 구현에 포함하지 않는다.

## 계약

- 자동 병합은 명시적 opt-in이며 기존 설치는 그대로 유지한다.
- 자동 대상은 nakwol-connect 하나의 동일 major/minor 패치이다. 정책, Secret,
  호스팅 설정, 스크립트, 다른 dependency 변경은 자동 승인하지 않는다.
- GitHub의 실제 PR/실행/브랜치 보호와 npm 배포 metadata를 조회한다. 이벤트의
  주장이나 PR artifact를 신뢰하지 않는다. 권한 있는 job은 PR 코드를 실행하지 않는다.
- 호스팅 독립 `protect rollout`은 사이트 소유자가 검토한 Node adapter를 통해
  capabilities/current/deploy/rollback을 호출한다. provider/resource/origin을 고정하고
  adapter 소스 hash를 고정한다. 배포 credentials는 사이트 CI의 명시한 환경 변수에만 둔다.
- 모든 배포 경로의 외부 직렬화와 compare-before-write는 adapter 책임이다. 이를
  제공할 수 없는 호스팅은 자동 모드를 활성화하지 않는다. 호스팅 이름만으로 지원을 추정하지 않는다.
- 이전 정상 manifest/report의 강한 증거와 현재 serving deployment를 먼저 확인하고,
  인증된 파일 hash와 익명 GET/HEAD/Range/잘못된 쿠키/캐시 검사를 다시 수행한다.
- 새 배포도 동일하게 검사한다. 실패 시 현재 배포가 이 작업의 배포일 때만 이전 검증
  artifact로 복구하고 다시 검사한다. 회복되어도 해당 릴리스는 실패이다.
- 새 공개 origin, 동시 외부 배포, adapter timeout의 불확실한 변경은 성공으로 처리하지 않는다.
- 이 기능은 게이트 요청 hot path와 정책 TTL/캐시를 수정하지 않는다.

## 실행 작업

1. [x] provider 독립 adapter와 rollout 상태 머신: 실제 child process/HTTP 검증 및 실패 경계.
2. [x] 엄격한 패치 PR 판정 및 exact HEAD 원자 병합: 파일/lock/registry/CI/보호 규칙 검증.
3. [x] CLI·기존 automate 연결, 호스팅별 연결 안내 및 README/설치 안내.
4. [x] 관련 패키지 회귀·포장 실행·독립 리뷰·수정·로컬 커밋·체크포인트.

## 검증

이전 정상본 미검증/잘못된 앱·origin/오래된 배포/adapter 변조/누락된 자격/비직렬화는
배포 전 거부한다. 새 배포의 노출/항상401/5xx/버전 오류/다른 배포 경합과 성공·실패·
불확실 복구를 검사한다. Cloudflare/Vercel/Netlify/사용자 provider의 동일 계약을 시험한다.
잘못된 PR은 mutation0: fork/다른 bot/다른 dependency/스크립트·정책 변경/minor/major/
registry integrity 불일치/CI head 불일치/미보호 브랜치/변경된 base.

## 범위 판단

Ruling: 기존 호스팅 배포를 소유자의 adapter 및 CI에 연결한다. SDK가 외부 계정을
자동 등록하거나 hosting Secret을 중앙 AUTH에 수집하지 않는다. 비용: 최초 연결은 필요하다.
Ruling: 기존 T11 성능/전체 Miniflare 및 T12 운영 canary의 미합격은 그대로 남긴다.
이 하위 구현의 검증을 상용 출시 승인으로 사용하지 않는다.

Ruling: 독립 리뷰의 future HEAD 승인 위험 때문에 PR-wide enableAutoMerge 대신
검증한 HEAD의 `mergePullRequest(expectedHeadOid)` 한 번만 실행한다. 다른 필수
검사/리뷰가 늦게 끝난 경우 명시적 재실행이 필요하며 자동 review/주기 재시도는 제공하지 않는다.
Ruling: v1은 고정 origin 집합과 파일당1MiB 이하를 요구한다. 새 preview URL의 자동
폐쇄 증명/네이티브 provider adapter를 구현했다고 주장하지 않는다. 미연결 환경은 수동 모드를 유지한다.

실행 결과: SDK 전체218/218, 최종 대상54/54, pack/types exit0, tarball CLI
local HTTPS 정상 배포 및 실패 복구 PASS(probe246/실패 exit1).
독립 리뷰 발견과 운영 미검증 범위는 `docs/audits/2026-10-01-safe-automatic-updates.md`.
