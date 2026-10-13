import type { Context } from 'hono';
import { sha256Base64Url } from './crypto';
import type { Env } from './types';

export const SERVER_STAGES = ['authorize', 'discord_code_exchange', 'discord_identity', 'discord_member', 'membership_db', 'policy', 'code_creation', 'session_creation', 'token', 'me'] as const;
export type DiagnosticStage = typeof SERVER_STAGES[number];
export type DiagnosticStatus = 'ok' | 'denied' | 'error';
type Measurement = { stage: DiagnosticStage; status: DiagnosticStatus; duration_ms: number; recorded_at: number };
export const diagnosticReference = (value: string | undefined): value is string => typeof value === 'string' && /^dg_[A-Za-z0-9_-]{24}$/.test(value);

/** Only coarse infrastructure metadata. No IP, URL, user, credential, or raw error. */
export function diagnosticNetwork(request: Request, source: 'browser_auth' | 'site_backend' | 'oauth_navigation') {
  const cf = request.cf;
  const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, max) : null;
  return { source, asn: typeof cf?.asn === 'number' && Number.isSafeInteger(cf.asn) ? cf.asn : null,
    asOrganization: clean(cf?.asOrganization, 120), colo: clean(cf?.colo, 16),
    cf_ray: clean(request.headers.get('CF-Ray'), 64) };
}

/** Catch only at this optional telemetry boundary. Authentication operations propagate unchanged. */
export async function optionalDiagnostic<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try { return await operation(); } catch { return fallback; } // no-excuse-ok: catch
}

export class DiagnosticTrace {
  private readonly measurements: Measurement[] = [];
  constructor(private readonly c: Context<{ Bindings: Env }>, readonly reference: string) {}
  add(stage: DiagnosticStage, start: number, status: DiagnosticStatus = 'ok'): void {
    if (this.measurements.length < 16) this.measurements.push({ stage, status, duration_ms: Math.max(0, Math.min(120000, Math.round(performance.now() - start))), recorded_at: Date.now() });
  }
  async run<T>(stage: DiagnosticStage, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try { const result = await operation(); this.add(stage, start, result === false ? 'denied' : 'ok'); return result; }
    catch (error) { this.add(stage, start, 'error'); throw error; }
  }
  async finish(): Promise<void> {
    const network = JSON.stringify(diagnosticNetwork(this.c.req.raw, this.c.req.header('Origin') ? 'browser_auth' : this.c.req.path === '/auth/discord/callback' || this.c.req.path === '/authorize' ? 'oauth_navigation' : 'site_backend'));
    const deadline = Date.now() + 3000;
    const persist = optionalDiagnostic(async () => {
      for (const m of this.measurements) {
        if (Date.now() >= deadline) break;
        await this.c.env.DB.prepare(`INSERT INTO diagnostic_stages(reference,stage,status,duration_ms,recorded_at,network_json)
          SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM diagnostic_reports WHERE reference=? AND expires_at>?)
          AND (SELECT COUNT(*) FROM diagnostic_stages WHERE reference=?)<48`)
          .bind(this.reference,m.stage,m.status,m.duration_ms,m.recorded_at,network,this.reference,Date.now(),this.reference).run();
      }
    }, undefined);
    // Bound our continuation below Workers' waitUntil limit. Missing test context uses the same safe promise.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bounded = Promise.race([persist, new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); })]).finally(() => { if (timer) clearTimeout(timer); });
    try { this.c.executionCtx.waitUntil(bounded); } catch { await bounded; } // no-excuse-ok: catch
  }
}

export async function resolveDiagnostic(c: Context<{ Bindings: Env }>, reference: string | undefined, clientId: string, origin?: string, capability?: string): Promise<DiagnosticTrace | undefined> {
  if (!diagnosticReference(reference)) return undefined;
  return optionalDiagnostic(async () => {
    const row = await c.env.DB.prepare('SELECT origin,capability_hash FROM diagnostic_reports WHERE reference=? AND client_id=? AND expires_at>?').bind(reference, clientId, Date.now()).first<{origin:string;capability_hash:string}>();
    if (!row || (origin && row.origin !== origin) || (capability !== undefined && await sha256Base64Url(capability) !== row.capability_hash)) return undefined;
    return new DiagnosticTrace(c, reference);
  }, undefined);
}

export function measured<T>(trace: DiagnosticTrace | undefined, stage: DiagnosticStage, operation: () => Promise<T>): Promise<T> {
  return trace ? trace.run(stage, operation) : operation();
}
