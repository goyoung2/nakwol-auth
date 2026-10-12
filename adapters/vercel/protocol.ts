/** Private canary transport. Limits apply before SQL execution, including authenticated callers. */
export const BRIDGE_PATH = '/rpc';
export const LIMITS = { body: 262144, query: 16384, batch: 64, params: 100, response: 2097152, deadline: 10000 } as const;
export type Value = string | number | null | { readonly bytes: readonly number[] };
export type Statement = { readonly query: string; readonly params: readonly Value[] };
export type Rpc =
  | { readonly method: 'first'; readonly statement: Statement; readonly column?: string }
  | { readonly method: 'all' | 'run'; readonly statement: Statement }
  | { readonly method: 'raw'; readonly statement: Statement; readonly columnNames: boolean }
  | { readonly method: 'batch'; readonly statements: readonly Statement[] }
  | { readonly method: 'exec'; readonly query: string };

export class BridgeError extends Error {
  constructor(readonly code: 'UNAVAILABLE' | 'INVALID_REQUEST' | 'LIMIT_EXCEEDED' | 'UNSUPPORTED') {
    super(`D1_BRIDGE_${code}`);
    this.name = 'BridgeError';
  }
}
export const secretValid = (value: string): boolean => new TextEncoder().encode(value).byteLength >= 32 && value.length <= 256 && /^[\x21-\x7e]+$/.test(value);
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function queryValid(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= LIMITS.query; }
function parseValue(value: unknown): Value {
  if (value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (record(value) && Object.keys(value).length === 1 && Array.isArray(value.bytes) && value.bytes.every((n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255)) return { bytes: value.bytes };
  throw new BridgeError('INVALID_REQUEST');
}
function statement(value: unknown): Statement {
  if (!record(value) || !queryValid(value.query) || !Array.isArray(value.params) || value.params.length > LIMITS.params || Object.keys(value).some(k => !['query', 'params'].includes(k))) throw new BridgeError('INVALID_REQUEST');
  return { query: value.query, params: value.params.map(parseValue) };
}
export function parseRpc(value: unknown): Rpc {
  if (!record(value)) throw new BridgeError('INVALID_REQUEST');
  switch (value.method) {
    case 'first':
      if (Object.keys(value).some(k => !['method', 'statement', 'column'].includes(k)) || value.column !== undefined && (typeof value.column !== 'string' || value.column.length > 128)) throw new BridgeError('INVALID_REQUEST');
      return { method: 'first', statement: statement(value.statement), ...(typeof value.column === 'string' ? { column: value.column } : {}) };
    case 'all': case 'run':
      if (Object.keys(value).some(k => !['method', 'statement'].includes(k))) throw new BridgeError('INVALID_REQUEST');
      return { method: value.method, statement: statement(value.statement) };
    case 'raw':
      if (typeof value.columnNames !== 'boolean' || Object.keys(value).some(k => !['method', 'statement', 'columnNames'].includes(k))) throw new BridgeError('INVALID_REQUEST');
      return { method: 'raw', statement: statement(value.statement), columnNames: value.columnNames };
    case 'batch':
      if (!Array.isArray(value.statements) || value.statements.length < 1 || value.statements.length > LIMITS.batch || Object.keys(value).some(k => !['method', 'statements'].includes(k))) throw new BridgeError('INVALID_REQUEST');
      return { method: 'batch', statements: value.statements.map(statement) };
    case 'exec':
      if (!queryValid(value.query) || Object.keys(value).some(k => !['method', 'query'].includes(k))) throw new BridgeError('INVALID_REQUEST');
      return { method: 'exec', query: value.query };
    default: throw new BridgeError('INVALID_REQUEST');
  }
}
export async function boundedText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) throw new BridgeError('INVALID_REQUEST');
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const part = await reader.read(); if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) { await reader.cancel(); throw new BridgeError('LIMIT_EXCEEDED'); }
    chunks.push(part.value);
  }
  const buffer = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer);
}
