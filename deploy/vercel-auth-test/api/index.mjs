import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { waitUntil } from '@vercel/functions';
import { handleRequest } from '../runtime/auth-runtime.mjs';

// Vercel's Node handler supplies the actual request authority. Forwarded headers never choose AUTH_ORIGIN.
export default async function handler(incoming, outgoing) {
  try {
    const host = incoming.headers.host;
    if (host !== 'nakwol-auth-vercel-test.vercel.app') {
      outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      outgoing.end(JSON.stringify({ ok: false, error: { code: 'TEST_ORIGIN_NOT_CONFIGURED' } }));
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const method = incoming.method || 'GET';
    let body;
    if (method !== 'GET' && method !== 'HEAD') {
      if (incoming.body === undefined) body = Readable.toWeb(incoming);
      else if (Buffer.isBuffer(incoming.body) || typeof incoming.body === 'string') body = incoming.body;
      else if (headers.get('Content-Type')?.includes('application/x-www-form-urlencoded') && incoming.body !== null && typeof incoming.body === 'object') {
        const form = new URLSearchParams();
        for (const [key, value] of Object.entries(incoming.body)) {
          for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
        }
        body = form.toString();
      } else if (headers.get('Content-Type')?.includes('application/json')) body = JSON.stringify(incoming.body);
      else throw new TypeError('Unsupported parsed request body');
      headers.delete('Content-Length');
    }
    const request = new Request(new URL(incoming.url || '/', `https://${host}`), {
      method, headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body, duplex: 'half' }),
    });
    const response = await handleRequest(request, process.env, { waitUntil, passThroughOnException() {}, props: {} });
    outgoing.statusCode = response.status;
    for (const [name, value] of response.headers) if (name !== 'set-cookie') outgoing.setHeader(name, value);
    const cookies = response.headers.getSetCookie();
    if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
    if (method === 'HEAD') outgoing.end();
    else if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing);
    else outgoing.end();
  } catch {
    // No raw request, SQL, Discord error, credential, or cookie is written to logs.
    if (!outgoing.headersSent) outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    outgoing.end(JSON.stringify({ ok: false, error: { code: 'TEST_RUNTIME_UNAVAILABLE' } }));
  }
}
