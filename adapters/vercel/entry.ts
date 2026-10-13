import app from '../../src/sdk-entry';
import { DiscordMembershipUnavailable } from '../../src/discord';
import type { Env } from '../../src/types';
import { HttpD1Database } from './d1-http';
import { BridgeError, secretValid, endpointValid } from './protocol';
import { deployment } from './deployment';
import type { ServerEnvironment } from './deployment';
export { deployment } from './deployment';
export type { ServerEnvironment } from './deployment';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const unavailable = (code: string) => json({ ok: false, error: { code } }, 503);
// The shared app handles routes/algorithms. Only this deployment's error boundary is replaced.
app.onError((error, c) => c.json({ ok: false, error: { code: error instanceof BridgeError ? 'TEST_DATABASE_UNAVAILABLE' : error instanceof DiscordMembershipUnavailable ? 'MEMBERSHIP_UNAVAILABLE' : 'INTERNAL_ERROR' } }, error instanceof BridgeError || error instanceof DiscordMembershipUnavailable ? 503 : 500));
export async function handleRequest(request: Request, values: ServerEnvironment, ctx: ExecutionContext, transport?: typeof fetch, trustedNetworkKey?: string): Promise<Response> {
  const url = new URL(request.url);
  const configured = deployment(values);
  if (!configured || url.origin !== configured.origin) return unavailable(values.NAKWOL_AUTH_MODE === 'production' ? 'AUTH_DEPLOYMENT_NOT_CONFIGURED' : 'TEST_ORIGIN_NOT_CONFIGURED');
  const bridgeConfigured = Boolean(endpointValid(values.D1_BRIDGE_URL) && values.D1_BRIDGE_SECRET && secretValid(values.D1_BRIDGE_SECRET));
  const discordConfigured = Boolean(values.DISCORD_CLIENT_ID && values.DISCORD_CLIENT_SECRET && values.NAKWOL_GUILD_ID && values.NAKWOL_MEMBER_ROLE_ID);
  const productionReady = bridgeConfigured && discordConfigured && /^\d{17,20}$/.test(values.DISCORD_CLIENT_ID || '') && values.NAKWOL_GUILD_ID === '1493410906456064112' && values.NAKWOL_MEMBER_ROLE_ID === '1553600098661957643';
  if (url.pathname === '/canary/status' && request.method === 'GET' && configured.mode === 'canary') return json({ ok: true, platform: 'vercel', canary: true, configured: { origin: true, bridge: bridgeConfigured, discord: discordConfigured }, health: 'canary_reachable' });
  if (url.pathname === '/deployment/status' && request.method === 'GET' && configured.mode === 'production') return json({ ok: true, platform: 'vercel', configured: { bridge: bridgeConfigured, discord: discordConfigured }, configuration_ready: productionReady });
  if (configured.mode === 'production' && !productionReady) return unavailable('AUTH_CONFIGURATION_MISSING');
  // An unsigned CF header is not Cloudflare metadata on Node.
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) if (name.toLowerCase().startsWith('cf-')) headers.delete(name);
  const cleanRequest = new Request(request, { headers });
  if (url.pathname === '/diagnostics/ping' && request.method === 'GET') { const response = json({ ok: true, network: { source: 'browser_auth', asn: null, asOrganization: null, colo: null, cf_ray: null } }); response.headers.set('Access-Control-Allow-Origin', '*'); response.headers.set('Timing-Allow-Origin', '*'); return response; }
  const diagnosticPath = url.pathname === '/diagnostics' || url.pathname.startsWith('/diagnostics/');
  const sdkPath = request.method === 'GET' && /^\/sdk\/(?:manifest\.json|nakwol-auth-web\.js|v0\.(?:1\.0|2\.0|3\.0|3\.1|3\.2)\/nakwol-auth-web\.js)$/.test(url.pathname);
  if (!bridgeConfigured || !discordConfigured && !diagnosticPath && !sdkPath) return unavailable('TEST_CONFIGURATION_MISSING');
  const { D1_BRIDGE_URL, D1_BRIDGE_SECRET, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, NAKWOL_GUILD_ID, NAKWOL_MEMBER_ROLE_ID } = values;
  if (!D1_BRIDGE_URL || !D1_BRIDGE_SECRET) return unavailable('TEST_CONFIGURATION_MISSING');
  try {
    const DB = new HttpD1Database(D1_BRIDGE_URL, D1_BRIDGE_SECRET, transport, configured.mode === 'production' ? configured.databaseId : undefined);
    const env: Env = { DB, DISCORD_CLIENT_ID: DISCORD_CLIENT_ID || '', DISCORD_CLIENT_SECRET: DISCORD_CLIENT_SECRET || '', NAKWOL_GUILD_ID: NAKWOL_GUILD_ID || '', NAKWOL_MEMBER_ROLE_ID, AUTH_ORIGIN: configured.origin, COOKIE_SECURE: 'true', ...(configured.mode === 'production' && trustedNetworkKey ? { DIAGNOSTIC_NETWORK_KEY: trustedNetworkKey } : {}), ...(values.DISCORD_BOT_TOKEN ? { DISCORD_BOT_TOKEN: values.DISCORD_BOT_TOKEN } : {}), ...(values.DISCORD_BOT_TOKEN2 ? { DISCORD_BOT_TOKEN2: values.DISCORD_BOT_TOKEN2 } : {}) };
    // Immutable SDK defaults point at production; this canary leaves SDK bytes intact and disables legacy Lab UI.
    if (url.pathname === '/lab' || url.pathname.startsWith('/lab/')) return json({ ok: false, error: { code: configured.mode === 'canary' ? 'LAB_DISABLED_IN_CANARY' : 'LAB_UNAVAILABLE' } }, 404);
    const response = await app.fetch(cleanRequest, env, ctx);
    if (response.status === 400 && response.headers.get('Content-Type')?.includes('application/json')) {
      const payload: unknown = await response.clone().json();
      if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'object' && payload.error !== null && 'code' in payload.error && payload.error.code === 'D1_BRIDGE_UNAVAILABLE') return unavailable('TEST_DATABASE_UNAVAILABLE');
    }
    if (configured.mode === 'production' && response.status >= 500) return unavailable('AUTH_DEPENDENCY_UNAVAILABLE');
    if (configured.mode === 'production' && !url.pathname.startsWith('/sdk/') && !url.pathname.startsWith('/connect/cli/v') && !['/connect/v1.js','/connect/manifest.json','/connect/cli/manifest.json','/connect/cli/package.tgz','/llms.txt'].includes(url.pathname)) { const privateHeaders = new Headers(response.headers); privateHeaders.set('Cache-Control', 'no-store'); return new Response(response.body, { status: response.status, statusText: response.statusText, headers: privateHeaders }); }
    return response;
  } catch (error) { if (error instanceof BridgeError || error instanceof TypeError) return unavailable(configured.mode === 'production' ? 'AUTH_DEPENDENCY_UNAVAILABLE' : 'TEST_DATABASE_UNAVAILABLE'); throw error; }
}
