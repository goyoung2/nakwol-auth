import type { Context } from 'hono';
import type { Env, ApplicationRow } from './types';

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

export function sessionCookie(token: string, secure: boolean, maxAgeSeconds: number): string {
  const parts = [
    `nakwol_sid=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = ['nakwol_sid=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function jsonError(c: Context<{ Bindings: Env }>, status: number, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status as any);
}

export async function getApplication(env: Env, clientId: string): Promise<ApplicationRow | null> {
  return env.DB.prepare(
    `SELECT client_id, name, redirect_uris, status FROM applications WHERE client_id = ?`
  ).bind(clientId).first<ApplicationRow>();
}

export function getRedirectUris(app: ApplicationRow): string[] {
  try {
    const parsed = JSON.parse(app.redirect_uris);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function isAllowedRedirect(app: ApplicationRow, redirectUri: string): boolean {
  return app.status === 'active' && getRedirectUris(app).includes(redirectUri);
}

export function isAllowedOrigin(app: ApplicationRow, origin: string): boolean {
  if (!origin) return false;
  return getRedirectUris(app).some((uri) => {
    try { return new URL(uri).origin === origin; } catch { return false; }
  });
}

export function redirectWithParams(redirectUri: string, params: Record<string, string | undefined | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value != null) url.searchParams.set(key, value);
  return url.toString();
}

export function withCorsHeaders(response: Response, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  headers.set('Access-Control-Max-Age', '600');
  headers.append('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
