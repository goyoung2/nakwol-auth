# 서버 API 보호 (T10, Connect 0.14.0 로컬 후보)

`nakwol-connect/server`의 `protectHandler`는 기존 공식 게이트의 암호화 쿠키·앱/origin 바인딩·승인 lease·갱신·선택형 bounded-control을 사용합니다. 각 사이트가 Discord OAuth를 구현하거나 사용자 헤더를 신뢰할 필요가 없습니다. 운영 게시 전 후보 기능이며 기존 설치에 자동 적용되지 않습니다.

## Workers의 API와 정적 파일 연결

```js
import {createGate, protectHandler} from 'nakwol-connect/server';
const settings = {
  clientId: 'YOUR_CLIENT_ID', siteUrl: 'https://YOUR_SITE/',
  authOrigin: 'https://nakwol-auth.sepsd21.workers.dev', accessPolicy: 'member',
};
const assets = createGate(settings);
const decks = protectHandler(async (request, principal, context) => {
  // 이 handler에는 인증이 성공한 요청만 도착합니다.
  // JSON parsing과 DB 쓰기는 서비스가 여기에서 수행합니다.
  return Response.json({userId: principal.userId});
}, {
  ...settings,
  authorizeResource: async (request, principal, context) => {
    const deckId = new URL(request.url).pathname.split('/').at(-1);
    const deck = await context.env.DB.prepare('SELECT owner_id FROM decks WHERE id=?')
      .bind(deckId).first();
    return deck?.owner_id === principal.userId;
  },
});
export default {
  fetch(request, env, ctx) {
    const context = {
      env, sessionSecret: env.NAKWOL_SESSION_SECRET,
      siteCredential: env.NAKWOL_SITE_CREDENTIAL,
      controlProfile: env.NAKWOL_CONTROL_PROFILE,
      controlPublicKeys: env.NAKWOL_CONTROL_PUBLIC_KEYS,
      sessionPreviousSecret: env.NAKWOL_SESSION_PREVIOUS_SECRET,
      sessionPreviousUntil: Number(env.NAKWOL_SESSION_PREVIOUS_UNTIL),
      waitUntil: ctx.waitUntil.bind(ctx), serveAsset: r => env.ASSETS.fetch(r),
    };
    return new URL(request.url).pathname.startsWith('/api/')
      ? decks(request, context) : assets(request, context);
  },
};
```

Workers는 `assets.run_worker_first=true`와 모든 보호 경로 라우팅이 필요합니다. 자동 생성된 정적 Worker를 임의 수정하면 `protect update`가 덮어쓰기를 거부하므로, API 서비스는 서비스 소유 entrypoint에서 위와 같이 공식 함수를 조합하고 패키지를 exact dependency/lockfile로 관리합니다. `protect install`이 기존 API나 DB 정책을 자동 작성했다고 표시하지 않습니다.

Pages advanced Worker도 같은 `fetch(request, env, ctx)` 조합을 사용하며 `_routes.json`에 모든 보호 경로를 포함합니다. Vercel의 실제 API 함수에서는 Web Request/Response 형식으로 `decks(request, context)`를 호출하고 환경변수로 context를 구성합니다. 정적 전용 Vercel 설치기는 기존 `api/`·서버 라우팅을 덮어쓰지 않습니다. Next SSR/프레임워크 어댑터 인증이나 모든 호스팅 지원을 주장하지 않습니다. Node의 IncomingMessage는 해당 플랫폼의 Web Request 어댑터로 변환해야 합니다.

정적 게이트의 `createGate`는 POST 등을 405로 거부합니다. 이미 설치된 정적 미들웨어에 API를 추가할 때는 API 요청을 해당 보호 함수로 라우팅해야 합니다. Vercel에서 API 함수가 직접 인증한다면, 모든 API 진입점에 wrapper가 연결되어 있음을 먼저 확인한 뒤 정적 미들웨어와의 경로 분담을 구성하세요. wrapper 없는 API 경로를 단순 제외하면 보호되지 않습니다. 미들웨어와 함수가 같은 세션을 사용하려면 clientId/siteUrl/secret/control 설정도 일치해야 합니다.

## 권한 계약

- `GET/HEAD/POST/PUT/PATCH/DELETE`를 핸들러 호출 전에 인증합니다. OPTIONS와 미지원 메서드는 405입니다. GET은 데이터 변경에 사용하면 안 됩니다.
- POST/PUT/PATCH/DELETE의 Origin은 정확한 서비스 origin이어야 하고 `Sec-Fetch-Site: cross-site`는 403입니다. Origin 없는 변경 요청도 거부합니다. 브라우저 fetch는 same-origin 쿠키를 사용하고 서버 클라이언트도 Origin을 명시해야 합니다. 범용 bearer API/CORS 허가는 제공하지 않습니다.
- 요청 body를 인증 전에 읽지 않습니다. 인증 후 JSON parsing·크기 제한·입력 검증은 서비스의 책임입니다. `authorizeResource`에서는 URL·principal·DB로 판정하고 본문을 소비하지 마세요.
- `X-User`, `X-User-*`, `X-Role`, `X-Roles`, 해당 접두사의 확장 및 `X-Nakwol-*`는 서비스 handler에 전달하기 전에 제거합니다. 다른 임의 헤더도 사용자 권한으로 해석하면 안 됩니다.
- principal은 server-only `{userId, clientId, scopes, policyVersion}`입니다. 토큰·refresh handle·Secret은 포함하지 않습니다. 현재 앱 로그인 증명은 DATA scope 위임이 아니므로 `scopes`는 빈 배열입니다. 이를 DATA API 승인으로 사용하면 안 됩니다. 구 AUTH 증명의 정책 버전은 0입니다.
- 로그인은 row-level 권한을 부여하지 않습니다. 사용자 A의 member 세션으로 사용자 B의 덱을 수정할 수 없어야 합니다. 위 예시처럼 서비스가 소유권을 확인하거나 handler 내부에서 검사합니다. 원자적 DB 쓰기에서도 `owner_id`를 조건에 넣어 검사와 쓰기 사이 경쟁을 막으세요.
- `authorizeResource`의 정확한 `true`만 허용하며 거부하면 403입니다. callback이 없으면 앱 접근 인증만 제공하므로 서비스가 별도의 리소스 권한 검사를 해야 합니다.
- API 응답은 ETag가 있어도 `private, no-store, max-age=0`이며 CDN-Cache-Control/Cloudflare-CDN-Cache-Control/Surrogate-Control도 같은 정책으로 고정합니다. 쿠키 갱신·Vary·보안 헤더를 적용하고 서비스의 Set-Cookie도 보존합니다. 일반 정적 GET/HEAD/Range의 private 재검증 계약은 유지합니다.
- `/__nakwol/*`는 인증 시스템용입니다. API wrapper에서는 404이며 로그인·callback·logout은 `createGate`로 라우팅합니다.
- WebSocket Upgrade/Connection:upgrade, SSE Accept와 SSE 응답은 501입니다. 장기 연결의 지속 승인 프로토콜을 지원하지 않으며 일반 GET으로 우회시키지 않습니다.
- AUTH/제어 문서 장애는 기존 lease/control 계약대로 차단합니다. 유효 lease 중에는 로컬 검사하며, 만료 후 재검증 실패는 503이고 서비스 handler를 호출하지 않습니다. 일반 lease의 권한 회수 반영 지연은 최대 300초로 기존과 같습니다.

## 낮은 수준의 인증 hook

`authorizeRequest(request, {settings, sessionSecret, siteCredential, ...context})`는
`{allowed:false,response}` 또는 `{allowed:true,principal,request,responseHeaders}`를 반환합니다.
승인 시 반환된 **정리된 request**와 principal을 사용하고 최종 응답에 **모든 responseHeaders**를 적용해야 합니다. 특히 갱신 Set-Cookie와 no-store를 빠뜨리면 안 됩니다. 원래 클라이언트 request의 사용자 헤더를 사용하지 마세요. 최종 응답 결합이 필요한 보통의 서비스는 `protectHandler`를 권장합니다. hook 자체가 리소스 소유권을 검사하거나 장기 스트림을 승인하지는 않습니다.

## 직접 원본·우회 경로 검증

SDK 함수가 보호하는 것은 실제 호출된 경로입니다. 동일 DB/파일을 제공하는 공개 원본 API·이전 배포·다른 도메인은 모두 폐쇄하거나 같은 wrapper와 정확한 origin 제한을 적용해야 합니다. 공개 원본이 남아 있으면 설치 완료가 아닙니다.

기존 `protect manifest`와 `protect verify --manifest ... --origins-file ... --session-cookie-env ...`로 정적 파일과 알려진 원본의 차단/정상 해시를 검증합니다. 동적 API는 추가로 비로그인 GET·HEAD·Range·변경 요청, 위조 사용자 헤더, cross-site POST, 사용자 A/B의 동일 리소스 접근을 실행하고 **거부 요청의 handler/DB 쓰기 0**을 확인해야 합니다. 정적 verify 성공만으로 동적 소유권 검증 완료를 표시하지 마세요. 로컬 재현은 `node --test packages/connect-cli/test/server-api.test.mjs`입니다.
