import { BRIDGE_PATH, BridgeError, LIMITS, boundedText, parseRpc, secretValid } from './protocol';
import type { Rpc, Statement } from './protocol';
interface BridgeEnv { readonly DB: D1Database; readonly D1_BRIDGE_SECRET: string; readonly NAKWOL_D1_TEST_BRIDGE: string }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function authorized(header: string | null, secret: string): Promise<boolean> {
  if (!secretValid(secret) || !header || header.length > 300) return false;
  // Fixed-size digests prevent secret length/content dependent comparison exits.
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [expected, received] = await Promise.all([digest(`Bearer ${secret}`), digest(header)]);
  let difference = 0; for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ received[i];
  return difference === 0;
}
function prepare(env: BridgeEnv, input: Statement): D1PreparedStatement {
  return env.DB.prepare(input.query).bind(...input.params.map(value => typeof value === 'object' && value !== null ? new Uint8Array(value.bytes).buffer : value));
}
async function execute(env: BridgeEnv, rpc: Rpc): Promise<unknown> {
  switch (rpc.method) {
    case 'first': return rpc.column === undefined ? prepare(env, rpc.statement).first() : prepare(env, rpc.statement).first(rpc.column);
    case 'all': return prepare(env, rpc.statement).all();
    case 'run': return prepare(env, rpc.statement).run();
    case 'raw': return rpc.columnNames ? prepare(env, rpc.statement).raw({ columnNames: true }) : prepare(env, rpc.statement).raw();
    case 'batch': return env.DB.batch(rpc.statements.map(input => prepare(env, input)));
    case 'exec': return env.DB.exec(rpc.query);
  }
}
export default {
  async fetch(request: Request, env: BridgeEnv): Promise<Response> { // no-excuse-ok: catch -- HTTP boundary sanitizes all SQL failures.
    const url = new URL(request.url);
    if (url.pathname !== BRIDGE_PATH || url.search || request.method !== 'POST') return json({ ok: false }, 404);
    if (env.NAKWOL_D1_TEST_BRIDGE !== 'true' || !secretValid(env.D1_BRIDGE_SECRET || '')) return json({ ok: false }, 503);
    if (!await authorized(request.headers.get('Authorization'), env.D1_BRIDGE_SECRET)) return json({ ok: false }, 401);
    if (request.headers.get('Content-Type')?.split(';')[0] !== 'application/json') return json({ ok: false }, 415);
    const deadline = Date.now() + LIMITS.deadline;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = async () => {
        const text = await boundedText(request.body, LIMITS.body);
        let input: unknown; try { input = JSON.parse(text); } catch (error) { if (error instanceof SyntaxError) throw new BridgeError('INVALID_REQUEST'); throw error; }
        const rpc = parseRpc(input);
        if (Date.now() >= deadline) throw new BridgeError('UNAVAILABLE');
        const result = await execute(env, rpc);
        const payload = JSON.stringify({ ok: true, result });
        if (new TextEncoder().encode(payload).byteLength > LIMITS.response) throw new BridgeError('LIMIT_EXCEEDED');
        return new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
      };
      return await Promise.race([operation(), new Promise<Response>(resolve => { timer = setTimeout(() => resolve(json({ ok: false }, 504)), LIMITS.deadline); })]);
    } catch (error) {
      return json({ ok: false }, error instanceof BridgeError ? error.code === 'LIMIT_EXCEEDED' ? 413 : 400 : 503);
    } finally { if (timer) clearTimeout(timer); }
  },
};
