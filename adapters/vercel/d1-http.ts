import { BRIDGE_PATH, BridgeError, LIMITS, boundedText, parseRpc, secretValid } from './protocol';
import type { Rpc, Statement, Value } from './protocol';
import { uuidValid } from './deployment';
type Transport = typeof fetch;
function encodeValue(value: unknown): Value {
  if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof ArrayBuffer) return { bytes: Array.from(new Uint8Array(value)) };
  if (ArrayBuffer.isView(value)) return { bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  throw new BridgeError('INVALID_REQUEST');
}
class HttpStatement implements D1PreparedStatement {
  constructor(readonly database: HttpD1Database, readonly input: Statement) {}
  bind(...values: unknown[]): HttpStatement { return new HttpStatement(this.database, { query: this.input.query, params: values.map(encodeValue) }); }
  first<T = Record<string, unknown>>(column?: string): Promise<T | null> { return this.database.rpc({ method: 'first', statement: this.input, ...(column === undefined ? {} : { column }) }); }
  run<T = Record<string, unknown>>(): Promise<D1Result<T>> { return this.database.rpc({ method: 'run', statement: this.input }); }
  all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return this.database.rpc({ method: 'all', statement: this.input }); }
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> { return this.database.rpc({ method: 'raw', statement: this.input, columnNames: options?.columnNames === true }); }
}
export class HttpD1Database implements D1Database {
  constructor(readonly endpoint: string, private readonly secret: string, private readonly transport: Transport = fetch, private readonly databaseId?: string) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== BRIDGE_PATH || !secretValid(secret)) throw new BridgeError('INVALID_REQUEST');
    if (databaseId !== undefined && !uuidValid(databaseId)) throw new BridgeError('INVALID_REQUEST');
  }
  prepare(query: string): D1PreparedStatement { return new HttpStatement(this, { query, params: [] }); }
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const inputs = statements.map(statement => { if (!(statement instanceof HttpStatement) || statement.database !== this) throw new BridgeError('INVALID_REQUEST'); return statement.input; });
    return this.rpc({ method: 'batch', statements: inputs });
  }
  exec(query: string): Promise<D1ExecResult> { return this.rpc({ method: 'exec', query }); }
  withSession(): D1DatabaseSession { throw new BridgeError('UNSUPPORTED'); }
  dump(): Promise<ArrayBuffer> { return Promise.reject(new BridgeError('UNSUPPORTED')); }
  async rpc<T>(request: Rpc): Promise<T> { // no-excuse-ok: catch -- Transport boundary exposes only a sanitized typed failure.
    const body = JSON.stringify(parseRpc(request));
    if (new TextEncoder().encode(body).byteLength > LIMITS.body) throw new BridgeError('LIMIT_EXCEEDED');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), LIMITS.deadline);
    try {
      // Exactly one attempt. A timeout does not establish whether an auth write committed.
      const response = await this.transport(this.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.secret}`, 'Content-Type': 'application/json', ...(this.databaseId ? { 'X-Nakwol-Database-ID': this.databaseId } : {}) }, body, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new BridgeError('UNAVAILABLE');
      const text = await boundedText(response.body, LIMITS.response);
      const envelope: unknown = JSON.parse(text);
      if (typeof envelope !== 'object' || envelope === null || !('ok' in envelope) || envelope.ok !== true || !('result' in envelope)) throw new BridgeError('UNAVAILABLE');
      // Row generics are the caller's D1 contract; the bridge forwards D1's JSON result without reshaping it.
      const result: T = JSON.parse(JSON.stringify(envelope.result));
      return result;
    } catch (error) { if (error instanceof BridgeError) throw error; throw new BridgeError('UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }
}
