import type { Hono, Context } from 'hono';
import type { Env } from './types';
import { getApplication, getRedirectUris, isAllowedOrigin, withCorsHeaders } from './http';
import { randomToken, sha256Base64Url } from './crypto';
import { authenticateAccessToken } from './store';
import { isPlatformAdmin } from './policy';
import { diagnosticNetwork, diagnosticReference, optionalDiagnostic } from './diagnostic-trace';
import { diagnosticsPage } from '../packages/connect-cli/src/server/diagnostics.mjs';

const MAX_BYTES = 12288;
const RETENTION = 7 * 86400000;
const PROBES = ['site_ping', 'auth_ping', 'sdk', 'application', 'token', 'me', 'site_session', 'page_navigation'] as const;
const OUTCOMES = ['ok', 'http_error', 'timeout_or_cors', 'cancelled', 'unavailable'] as const;
type PingTiming = { dns_ms:number|null;connect_ms:number|null;tls_ms:number|null;ttfb_ms:number|null };
type Observation = { timing?: PingTiming | null; probe: typeof PROBES[number]; outcome: typeof OUTCOMES[number]; duration_ms: number; http_status: number | null };
type BrowserReport = { schema_version: 1; observations: Observation[]; browser: 'chromium' | 'firefox' | 'safari' | 'other'; platform: 'mobile' | 'desktop' | 'other' };
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
export function parseDiagnosticReport(value: unknown): BrowserReport | null {
  if (!record(value) || !keys(value,['schema_version','observations','browser','platform']) || value.schema_version !== 1
    || !['chromium','firefox','safari','other'].includes(String(value.browser)) || !['mobile','desktop','other'].includes(String(value.platform))
    || !Array.isArray(value.observations) || value.observations.length > 16) return null;
  const observations: Observation[] = [];
  for (const item of value.observations) {
    if (!record(item) || !keys(item,['probe','outcome','duration_ms','http_status','timing'])) return null;
    const probe = PROBES.find(p => p === item.probe), outcome = OUTCOMES.find(o => o === item.outcome);
    if (!probe || !outcome || typeof item.duration_ms !== 'number' || !Number.isSafeInteger(item.duration_ms) || item.duration_ms < 0 || item.duration_ms > 120000
      || !(item.http_status === null || typeof item.http_status === 'number' && Number.isSafeInteger(item.http_status) && item.http_status >= 100 && item.http_status <= 599)) return null;
    let timing: PingTiming | null | undefined;
    if (item.timing !== undefined) {
      if (item.timing === null) timing=null;
      else {
        if (!['site_ping','auth_ping'].includes(probe) || !record(item.timing) || !keys(item.timing,['dns_ms','connect_ms','tls_ms','ttfb_ms'])) return null;
        const {dns_ms,connect_ms,tls_ms,ttfb_ms}=item.timing;
        const metric=(v:unknown):v is number|null => v===null || typeof v==='number'&&Number.isSafeInteger(v)&&v>0&&v<=120000;
        if(!metric(dns_ms)||!metric(connect_ms)||!metric(tls_ms)||!metric(ttfb_ms))return null;
        timing={dns_ms,connect_ms,tls_ms,ttfb_ms};
      }
    }
    observations.push({probe,outcome,duration_ms:item.duration_ms,http_status:item.http_status,...(timing===undefined?{}:{timing})});
  }
  const browser = ['chromium','firefox','safari','other'].find(v => v === value.browser);
  const platform = ['mobile','desktop','other'].find(v => v === value.platform);
  if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'safari' && browser !== 'other') return null;
  if (platform !== 'mobile' && platform !== 'desktop' && platform !== 'other') return null;
  return {schema_version:1,observations,browser,platform};
}
async function boundedJson(request: Request): Promise<{value:unknown; tooLarge:boolean}> {
  const reader = request.body?.getReader();
  if (!reader) return {value:null,tooLarge:false};
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); return {value:null,tooLarge:true}; } chunks.push(part.value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
  try { return {value:JSON.parse(new TextDecoder().decode(bytes)),tooLarge:false}; }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return {value:null,tooLarge:false}; }
}
export async function cleanupDiagnostics(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM diagnostic_stages WHERE reference IN (SELECT reference FROM diagnostic_reports WHERE created_at<?)').bind(now-RETENTION),
    env.DB.prepare('DELETE FROM diagnostic_reports WHERE created_at<?').bind(now-RETENTION),
    env.DB.prepare('DELETE FROM diagnostic_rate_guards WHERE expires_at<=?').bind(now),
  ]);
}
async function guard(env: Env, name: string, limit: number): Promise<boolean> {
  const hour = Math.floor(Date.now()/3600000), hash = await sha256Base64Url('diagnostic:'+hour+':'+name);
  const row = await env.DB.prepare(`INSERT INTO diagnostic_rate_guards(guard_hash,count,expires_at) VALUES(?,1,?)
    ON CONFLICT(guard_hash) DO UPDATE SET count=count+1 RETURNING count`).bind(hash,(hour+1)*3600000).first<{count:number}>();
  return Boolean(row && row.count<=limit);
}
async function clientOrigin(c: Context<{Bindings:Env}>) {
  const clientId = c.req.query('client_id') || '';
  const central = new URL(c.env.AUTH_ORIGIN).origin;
  const origin = c.req.header('Origin') || (c.req.method === 'GET' && new URL(c.req.url).origin === central && c.req.header('Sec-Fetch-Site') === 'same-origin' ? central : '');
  const application = await getApplication(c.env,clientId);
  if (!application || application.status !== 'active' || !origin || !(origin === central || isAllowedOrigin(application,origin))) return null;
  return {clientId,origin};
}
export function registerDiagnosticRoutes(app: Hono<{Bindings:Env}>): void {
  app.use('/diagnostics/*',async(c,next)=>{c.header('Cache-Control','no-store'); c.header('X-Content-Type-Options','nosniff'); await next();});
  app.options('/diagnostics/*',async c=>{
    const scope=await clientOrigin(c); if (!scope) return c.body(null,403);
    const response=withCorsHeaders(new Response(null,{status:204}),scope.origin);
    response.headers.set('Access-Control-Allow-Headers','Content-Type, X-Nakwol-Diagnostic-Capability');
    return response;
  });
  app.get('/diagnostics',async c=>{
    const clientId=c.req.query('client_id') || '';
    const application=await optionalDiagnostic(() => getApplication(c.env,clientId),null);
    let siteOrigin: string | undefined;
    if (application?.status==='active') {
      for (const value of getRedirectUris(application)) {
        try {const url=new URL(value); if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password) {siteOrigin=url.origin;break;}} catch { /* Registered legacy entry is unusable. */ }
      }
    }
    c.header('Cache-Control','no-store');
    c.header('Referrer-Policy','no-referrer');
    return c.html(diagnosticsPage({clientId:/^[A-Za-z0-9_-]{1,128}$/.test(clientId)?clientId:'',authOrigin:new URL(c.req.url).origin,siteOrigin,clientName:application?.name,central:true}));
  });
  app.get('/diagnostics/ping',c=>{
    c.header('Access-Control-Allow-Origin','*');
    c.header('Timing-Allow-Origin','*');
    return c.json({ok:true,network:diagnosticNetwork(c.req.raw,'browser_auth')});
  });
  app.get('/diagnostics/application',async c=>{
    const scope=await clientOrigin(c); if(!scope) return c.json({ok:false,error:{code:'ORIGIN_DENIED'}},403);
    return withCorsHeaders(c.json({ok:true,registered:true}),scope.origin);
  });
  app.post('/diagnostics/tickets',async c=>{
    const scope=await clientOrigin(c); if(!scope) return c.json({ok:false,error:{code:'ORIGIN_DENIED'}},403);
    const respond=(response:Response)=>withCorsHeaders(response,scope.origin);
    const input=await boundedJson(c.req.raw);
    if(input.tooLarge) return respond(c.json({ok:false,error:{code:'REPORT_TOO_LARGE'}},413));
    if(!record(input.value)||Object.keys(input.value).length) return respond(c.json({ok:false,error:{code:'INVALID_REQUEST'}},400));
    await cleanupDiagnostics(c.env);
    // Global guard before network guard bounds persistent network rows, even for random addresses.
    if(!await guard(c.env,'global',300)||!await guard(c.env,'network:'+ (c.env.DIAGNOSTIC_NETWORK_KEY || c.req.header('CF-Connecting-IP') || 'unavailable'),6))
      return respond(c.json({ok:false,error:{code:'RATE_LIMITED'}},429));
    const reference='dg_'+randomToken(18), capability=randomToken(32), now=Date.now();
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO diagnostic_reports(reference,client_id,origin,capability_hash,created_at,expires_at,network_json) VALUES(?,?,?,?,?,?,?)')
        .bind(reference,scope.clientId,scope.origin,await sha256Base64Url(capability),now,now+30*60000,JSON.stringify(diagnosticNetwork(c.req.raw,'browser_auth'))),
      c.env.DB.prepare('DELETE FROM diagnostic_stages WHERE reference IN (SELECT reference FROM diagnostic_reports WHERE client_id=? ORDER BY created_at DESC,reference DESC LIMIT -1 OFFSET 200)').bind(scope.clientId),
      c.env.DB.prepare('DELETE FROM diagnostic_reports WHERE client_id=? AND reference NOT IN (SELECT reference FROM diagnostic_reports WHERE client_id=? ORDER BY created_at DESC,reference DESC LIMIT 200)').bind(scope.clientId,scope.clientId),
    ]);
    return respond(c.json({ok:true,reference,capability,expires_at:now+30*60000},201));
  });
  app.post('/diagnostics/reports/:reference',async c=>{
    const scope=await clientOrigin(c); if(!scope) return c.json({ok:false,error:{code:'ORIGIN_DENIED'}},403);
    const respond=(response:Response)=>withCorsHeaders(response,scope.origin);
    const reference=c.req.param('reference'), capability=c.req.header('X-Nakwol-Diagnostic-Capability') || '';
    if(!diagnosticReference(reference)||!/^[A-Za-z0-9_-]{43}$/.test(capability)) return respond(c.json({ok:false,error:{code:'INVALID_TICKET'}},401));
    if(c.req.header('Content-Type')?.split(';')[0]!=='application/json') return respond(c.json({ok:false,error:{code:'JSON_REQUIRED'}},415));
    const body=await boundedJson(c.req.raw);
    if(body.tooLarge) return respond(c.json({ok:false,error:{code:'REPORT_TOO_LARGE'}},413));
    const report=parseDiagnosticReport(body.value);
    if(!report) return respond(c.json({ok:false,error:{code:'INVALID_REPORT'}},400));
    const row=await c.env.DB.prepare(`UPDATE diagnostic_reports SET browser_json=?,received_at=?,writes=writes+1
      WHERE reference=? AND client_id=? AND origin=? AND capability_hash=? AND expires_at>? AND writes<4 RETURNING reference`)
      .bind(JSON.stringify(report),Date.now(),reference,scope.clientId,scope.origin,await sha256Base64Url(capability),Date.now()).first<{reference:string}>();
    if(!row) return respond(c.json({ok:false,error:{code:'INVALID_OR_EXHAUSTED_TICKET'}},401));
    return respond(c.json({ok:true,reference:row.reference},201));
  });
  app.get('/admin/api/apps/:clientId/auth-diagnostics',async c=>{
    c.header('Cache-Control','no-store');
    const token=c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const user=token?await authenticateAccessToken(c.env,token,'nakwol-connect-admin'):null;
    if(!user) return c.json({ok:false,error:{message:'운영자 로그인이 필요합니다.'}},401);
    if(!await isPlatformAdmin(c.env,user)) return c.json({ok:false,error:{message:'AUTH 운영자만 조회할 수 있습니다.'}},403);
    const clientId=c.req.param('clientId'), reference=c.req.query('reference') || '';
    if(reference&&!diagnosticReference(reference)) return c.json({ok:false,error:{message:'진단 번호 형식을 확인하세요.'}},400);
    await cleanupDiagnostics(c.env);
    const reports=await c.env.DB.prepare(`SELECT reference,created_at,received_at,browser_json,network_json FROM diagnostic_reports
      WHERE client_id=? AND (?='' OR reference=?) ORDER BY created_at DESC LIMIT 20`).bind(clientId,reference,reference).all<{reference:string;created_at:number;received_at:number|null;browser_json:string|null;network_json:string}>();
    const data=[];
    for(const report of reports.results) {
      const stages=await c.env.DB.prepare('SELECT stage,status,duration_ms,recorded_at,network_json FROM diagnostic_stages WHERE reference=? ORDER BY id LIMIT 48').bind(report.reference).all<{stage:string;status:string;duration_ms:number;recorded_at:number;network_json:string}>();
      data.push({reference:report.reference,created_at:report.created_at,received_at:report.received_at,browser:report.browser_json?JSON.parse(report.browser_json):null,
        network:JSON.parse(report.network_json),stages:stages.results.map(stage=>({...stage,network:JSON.parse(stage.network_json),network_json:undefined}))});
    }
    return c.json({ok:true,data:{reports:data,browser_evidence:'untrusted',server_evidence:'trusted'}});
  });
}
