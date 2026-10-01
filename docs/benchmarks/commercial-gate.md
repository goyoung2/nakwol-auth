# T11 재현 가능한 서버 게이트 시험

상태: **로컬 시험 도구 구현. 상용 성능 승인 전.** 운영 서비스·Discord·Cloudflare 지역별 CPU를 대신하는 결과가 아닙니다.

## 실행

```sh
node scripts/benchmark-gate.mjs --profile local-lease --output .nakwol/reports/bench-local.json
node scripts/benchmark-gate.mjs --profile bounded-control --output .nakwol/reports/bench-control.json
node --test tests/fixtures/gate-benchmark/generator.test.mjs packages/connect-cli/test/benchmark.test.mjs packages/connect-cli/test/gate-benchmark-faults.test.mjs
```

기본 조건은 동시 30개, 독립 모듈 그래프 1개, 중앙 지연 100ms, 이미지 10KiB, 각 상태 warmup 10회 + 측정 30회입니다. 옵션 `--concurrency 6|30|300`, `--isolates 1|10`, `--auth-delay-ms 0|100|500`, `--image-kib 1|10|50|200`, `--states cold,warm,lease-expired,control-expired,access-expired,revisit,role-expired`로 조합을 고정합니다. `1KiB`는 빠른 보안 시험에만 사용합니다. `--samples`/`--warmups`를 줄인 smoke 결과는 30회 측정을 대체하지 않습니다.

전체 요구 행렬은 두 profile × 세 동시성 × 두 isolate 수 × 세 중앙 지연 × 세 이미지 크기입니다. 각 조합을 **같은 장비에서 순차 실행**합니다. 다른 성능 시험·전체 회귀 시험과 병렬 실행하지 않습니다. JSON에 설정과 측정 횟수가 모두 남습니다. 한 조합을 전체 행렬 합격으로 보고하지 않습니다.

```sh
for profile in local-lease bounded-control; do
  for concurrency in 6 30 300; do
    for isolates in 1 10; do
      for delay in 0 100 500; do
        for size in 10 50 200; do
          node scripts/benchmark-gate.mjs --profile "$profile" --concurrency "$concurrency" --isolates "$isolates" --auth-delay-ms "$delay" --image-kib "$size" --output ".nakwol/reports/$profile-$concurrency-$isolates-$delay-$size.json" || exit 1
        done
      done
    done
  done
done
```

## 측정 경계

- 실제 공식 `createGate`와 AES-GCM/서명 검증 코드를 그대로 실행합니다. 임시 디렉터리에 runtime 전체를 복사해 isolate별 session/control/관측 Map을 분리합니다. Node 모듈 그래프이며 실제 workerd isolate라고 부르지 않습니다.
- 사이트 요청은 실제 loopback HTTP입니다. 중앙은 통제된 `session/refresh`, code exchange, 서명된 control 응답입니다. 새 프로토콜은 `/me`를 부르지 않으므로 `/me=0`만으로 중앙 호출 0이라고 판단하지 않습니다. `refresh`, `control`, `exchange`, `observations`를 별도 기록합니다.
- 315개 파일: HTML1, JS4, CSS3, JSON4, PNG300, 원본 합성 TTF2, 다운로드1. 모든 파일은 SHA와 바이트 수를 갖습니다. 이미지 파일은 정확히 10/50/200KiB이며 합성 RGB PNG로 디코딩됩니다. 크기별 이미지 총량은 3,072,000 / 15,360,000 / 61,440,000바이트입니다. 실제 도감의 압축률·디코딩 비용을 동일하게 대표한다고 주장하지 않습니다.
- 브라우저용 화면은 1280×720, DPR1, lazy loading 없음입니다. 다운로드는 자동 다운로드하지 않으므로 브라우저의 자연 요청 수와 315개 전 파일 HTTP 시험 수는 다릅니다.
- TTFB는 응답 헤더 시각, 배치 시간은 본문 소비 완료 시각입니다. `authWallP95Ms`는 게이트 진입→자산 handler 호출까지이며 암호 연산·대기·스케줄링을 포함합니다. `processCpuMs`는 클라이언트·서버·자산 처리를 포함한 배치 CPU입니다. 둘 다 Worker의 요청당 CPU가 아닙니다. 실제 edge CPU p95≤2ms 판정은 별도입니다.
- Windows 신규 TCP 연결 300개 burst는 게이트 없는 서버에서도 232개 성공/68개 ECONNREFUSED로 재현됐습니다. 연결을 준비하면 300개 동시 요청은 성공했습니다. 측정 전 응답을 보류한 연결을 10개씩 준비하고 300개가 확보된 뒤 응답을 해제합니다. 준비 시간·요청 수·동시 보류 개수를 별도 기록하며 성능 배치에 포함하지 않습니다. 이 결과로 과거 T10의 단일 fetch 실패 원인을 확정하지 않습니다.
- `protect verify`는 전 경로의 비로그인 GET/HEAD/Range/위조 legacy cookie를 검사합니다. 정상 파일 전송은 모든 315개 경로를 별도 시험합니다. 이 통제된 fixture 결과는 운영 origin/이전 배포/실제 계정의 출시 인증이 아닙니다.

## 상태 정의

| 상태 | 시작 조건 | 기대 |
|---|---|---|
| cold | code exchange 직후, control snapshot 없음 | local lease 중앙0, bounded control isolate별 control1 |
| warm | 모든 isolate의 승인·control 준비 완료 | 중앙0 |
| lease-expired | 시간 +300,001ms | isolate당 갱신 최소1, bounded control도 갱신 |
| control-expired | 시간 +30,001ms | local lease 중앙0, bounded control isolate당 control1 |
| access-expired | 절대 세션 만료 후 | 401, 자산 본문0 |
| revisit | 유효 세션 + 정확한 If-None-Match | 304, 자산 본문0 |
| role-expired | 역할 근거 만료 후 중앙403 | 403, 자산 본문0; 거부 호출 수도 숨기지 않음 |

각 측정은 고유 synthetic session/client binding으로 시작합니다. 로그인 비용은 `login`에 따로 기록합니다. cold는 V8 프로세스 startup cold가 아닙니다. `centralWallMs`는 병렬 중앙 요청들의 시간 합이며 사용자가 기다린 지연과 같지 않습니다.

## 장애·관측·디자인 시험

`tests/fixtures/gate-benchmark/faults.mjs`의 `runFaultChecks()`는 AUTH/control 503·429·실제 7초/4초 timeout, 거부 시 handler0, 회복, 세션/서명 키 경계, pending login quota8, 공개 cache header 오설정을 검사합니다. 시험에서 발견한 공유 캐시 지시문 유지 결함은 legacy/server 세션 공통 코드에서 수정했습니다. 브라우저의 private ETag 재검증은 유지합니다.

정적 응답에서는 vendor 공유 캐시 헤더를 제거하고 API에서는 명시적 private/no-store를 유지합니다. 첫 전체 회귀에서 API 헤더를 함께 제거한 회귀를 발견해 `781ee56`에서 수정했습니다. 아래 원시 성능값은 이 수정 전 `0395375`의 정적 경로 snapshot이며 수정 후 성능값으로 소급하지 않습니다.

관측을 켠 10개 모듈 그래프가 이미지300개를 처리할 때 중앙 승인/control0, 비동기 수집10회, 같은 session bucket 중복9개를 실측합니다. collector를 보류한 채 보호 응답300개가 완료되는 것을 확인합니다. 큐128/overflow872, 수집 실패 시 retry6/손실1000, 다음 새 이벤트 회복을 검사합니다. 이는 중앙 DB의 last-observed 저장 지연 실측이 아닙니다. 디자인은 실제 공통 loader의 cold/hit/failure/recovery와 바이트를 측정하며 브라우저 bootstrap/paint 비용은 별도입니다.

Discord는 중앙 서비스 경계에 있으므로 사이트 fixture의 AUTH503/429를 Discord 장애 실측이라고 부르지 않습니다. 실제 provider quota, CDN 우회, 서비스워커, Cloudflare billing 오류도 운영 staging에서 별도 검증해야 합니다.

## 비용 근거와 예산

요금 확인일: **2026-10-01**. Workers Paid 기본 $5/월, 요청 1천만 포함, 초과 백만당 $0.30, CPU 3천만 ms 포함/초과 백만 ms당 $0.02입니다. 정적 파일이더라도 게이트 Worker를 거친 요청은 사이트 Worker 실행 수에 포함합니다. [Cloudflare Workers 공식 요금](https://developers.cloudflare.com/workers/platform/pricing/)

D1 초과 읽기 백만 rows당 $0.001, 쓰기 백만 rows당 $1, 저장 초과 GB-month당 $0.75입니다. 읽기 250억/쓰기5천만 rows 및 저장5GB 포함이며 실제 query `meta`가 필요합니다. Workers 문서의 D1 저장 요금 표와 차이가 있어 D1 전용 문서를 기준으로 기록합니다. [Cloudflare D1 공식 요금](https://developers.cloudflare.com/d1/platform/pricing/)

아래는 **일일 활성 사용자**가 매일 3페이지(cold/warm/lease-expired 각1), 로그인1, 10 isolate를 사용하는 30일 가정입니다. 실제 회원 수나 전체 청구액이 아닙니다. 315개 파일×3 + start/callback2 = 사용자당 사이트947회/일. 갱신10회, 관측10회, 디자인cold1회를 사용한 예시입니다. 중앙/관측/디자인 실측 비율을 바꿔 재산정해야 합니다.

| 일일 활성 사용자 | 사이트 요청/월 | AUTH exchange+refresh/월 | control/월(bounded) | 관측/월 | 디자인/월 |
|---:|---:|---:|---:|---:|---:|
| 100 | 2,841,000 | 33,000 | 60,000 | 30,000 | 3,000 |
| 1,000 | 28,410,000 | 330,000 | 600,000 | 300,000 | 30,000 |
| 10,000 | 284,100,000 | 3,300,000 | 6,000,000 | 3,000,000 | 300,000 |

요청 비용은 계정별 `max(0,전체요청-10,000,000)/1,000,000×$0.30`으로 산정합니다. 사이트만 사용하는 독립 Paid 계정의 요청 초과분은 각각 $0/$5.523/$82.23이며 $5 기본료·CPU·DB·다른 서비스는 별도입니다. 포함량을 사이트마다 중복 공제하지 않습니다. 중앙의 D1 rows/CPU, Discord 조회 수, 계정의 기존 이용량은 아직 실측하지 않아 총액을 제시하지 않습니다. 한도 초과 시 공개 fallback은 허용하지 않습니다. 신규 유료 플랜이나 인프라는 생성하지 않았습니다.

## 실제 측정 결과와 미완료 승인 항목

반복 측정 표와 실행 근거는 아래에 기록합니다. TTL을 늘려 목표 미달을 가리지 않습니다. 아직 전체 108조합, 실제 workerd CPU, staging3지역 Chrome/Firefox/Safari·모바일 LCP/SSO, 중앙 DB/Discord/실제 quota/CDN/관측 저장 지연을 완료하지 않았습니다. staging 주소와 지역별 실행 환경을 확보한 뒤 이 항목을 검증해야 합니다. 현재 T11 전체 완료나 출시 합격으로 표시하지 않습니다.

### 2026-10-01 로컬 반복 측정

조건: 동시300, 독립 모듈 그래프10, 합성 중앙100ms, 이미지50KiB, 상태별 warmup10+측정30. 전송량15,391,869바이트/정상 배치, 315요청. 준비된 loopback 연결이며 실제 사이트 브라우저 시간은 아닙니다.

측정 장비: AMD Ryzen7 5700X3D(논리CPU16), RAM 약48GiB, Windows10 build19045, Node22.23.1. 전원·외부 프로세스·실제 edge 배치 조건을 동일하다고 가정하지 않습니다.

| Profile / 상태 | 전체 배치 p95 ms | HTML TTFB p95 ms | 이미지 TTFB p95의 p95 ms | 인증 wall p95의 p95 ms | refresh / control 호출 범위 | 본문 bytes |
|---|---:|---:|---:|---:|---|---:|
| local-lease / cold | 335.03 | 239.86 | 305.39 | 150.95 | 0–0 / 0–0 | 15391869 |
| local-lease / warm | 369.69 | 274.05 | 333.04 | 148.70 | 0–0 / 0–0 | 15391869 |
| local-lease / lease-expired | 479.76 | 383.13 | 450.06 | 319.54 | 10–10 / 0–0 | 15391869 |
| local-lease / control-expired | 334.73 | 241.79 | 302.25 | 137.42 | 0–0 / 0–0 | 15391869 |
| local-lease / access-expired | 195.76 | 149.78 | 174.44 | 미측정 | 0–0 / 0–0 | 0 |
| local-lease / revisit | 231.67 | 191.53 | 207.83 | 104.08 | 0–0 / 0–0 | 0 |
| local-lease / role-expired | 444.65 | 285.85 | 314.95 | 미측정 | 20–20 / 0–0 | 0 |
| local-lease / 공개 baseline | 209.89 | 127.94 | 185.33 | 인증 없음 | 0 / 0 | 15391869 |
| bounded-control / cold | 503.37 | 399.68 | 473.08 | 294.25 | 0–0 / 10–10 | 15391869 |
| bounded-control / warm | 339.39 | 230.61 | 303.97 | 142.11 | 0–0 / 0–0 | 15391869 |
| bounded-control / lease-expired | 1079.63 | 633.77 | 996.43 | 785.43 | 10–10 / 10–10 | 15391869 |
| bounded-control / control-expired | 455.93 | 359.55 | 429.75 | 292.36 | 0–0 / 10–10 | 15391869 |
| bounded-control / access-expired | 200.19 | 150.16 | 177.91 | 미측정 | 0–0 / 0–0 | 0 |
| bounded-control / revisit | 255.36 | 200.52 | 230.59 | 111.36 | 0–0 / 0–0 | 0 |
| bounded-control / role-expired | 433.33 | 386.88 | 416.11 | 미측정 | 10–10 / 10–10 | 0 |
| bounded-control / 공개 baseline | 222.34 | 130.94 | 200.06 | 인증 없음 | 0 / 0 | 15391869 |

두 profile 모두 warm 중앙0, 거부 본문0, revisit304/본문0, 모든 예상 상태 코드 일치(오류0)입니다. **local-lease 추가 배치 p95=159.79ms, bounded-control=117.06ms로 허용100ms를 모두 초과했습니다. T11 성능 승인은 미달입니다.** 요청당 추가 TTFB/edge CPU/브라우저 SSO 목표도 승인하지 않았습니다. 인증 wall에는 병렬 스케줄링이 포함돼 per-request CPU로 해석하지 않습니다.

local-lease의 role-expired에서는 300동시 때20 refresh, 이전30동시 시험에서는110 refresh가 발생했습니다. 긍정 승인 갱신의 single-flight와 달리 거부 결과는 local-lease에서 후속 wave까지 캐시하지 않습니다. 이 상태의 트래픽 비용을 추가 개선 대상으로 남깁니다. 보안상 모두403이고 자산0입니다.

[local 원시 결과](results/2026-10-01-local-lease.json), [bounded 원시 결과](results/2026-10-01-bounded-control.json), [장애·관측·디자인 결과](results/2026-10-01-faults.json), [격리 TCP 진단](results/2026-10-01-transport.json), [브라우저 디코딩 QA](results/2026-10-01-browser-decoding.json). 측정 시점 HEAD40401e0와 실제 미커밋 runtime SHA를 함께 보존했습니다. 보호 자산 원본이나 사용자 토큰은 포함하지 않습니다.

공개 synthetic 브라우저 QA는 이미지300/300 decode, 원본 합성 font2 loaded, JSON4 loaded를 확인했습니다. resource timing 기본 buffer가250으로 잘려 request count 측정으로 사용하지 않았습니다. Chromium 단일 로컬 실행이며 Firefox/Safari/모바일/3지역/SSO 검증은 남아 있습니다.
