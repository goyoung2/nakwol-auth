import type { Hono } from 'hono';
import sdkSource from './assets/nakwol-auth-web.js.txt';

export const NAKWOL_AUTH_WEB_SDK_VERSION = '0.1.0';

function javascriptResponse(source: string, cacheControl: string): Response {
  return new Response(source, {
    status: 200,
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function registerSdkRoutes(app: Hono<any>) {
  app.get('/sdk/v0.1.0/nakwol-auth-web.js', () =>
    javascriptResponse(sdkSource, 'public, max-age=31536000, immutable')
  );

  app.get('/sdk/nakwol-auth-web.js', () =>
    javascriptResponse(sdkSource, 'public, max-age=300')
  );

  app.get('/sdk/manifest.json', (c) => {
    const response = c.json({
      ok: true,
      name: 'nakwol-auth-web',
      stable: NAKWOL_AUTH_WEB_SDK_VERSION,
      module: '/sdk/v0.1.0/nakwol-auth-web.js',
      alias: '/sdk/nakwol-auth-web.js',
      format: 'browser-esm',
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=300');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  });
}
