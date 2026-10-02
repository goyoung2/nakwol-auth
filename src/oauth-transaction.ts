import { randomToken, safeEqual, sha256Base64Url } from './crypto';

const PREFIX = '__Host-nakwol_oauth_';
const LOCAL_PREFIX = 'nakwol_oauth_';
const TTL_SECONDS = 600;
const MAX_PENDING = 5;
const STATE = /^req_([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/;

function cookieName(id: string, secure: boolean): string {
  return `${secure ? PREFIX : LOCAL_PREFIX}${id}`;
}
function cookie(name: string, value: string, secure: boolean, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function createOAuthTransaction(header: string | undefined, secure: boolean) {
  const existing = (header ?? '').split(';').filter(part => {
    const name = part.trim().split('=')[0];
    return name.startsWith(PREFIX) || name.startsWith(LOCAL_PREFIX);
  });
  if (existing.length >= MAX_PENDING) return null;
  const id = randomToken(18);
  const secret = randomToken(32);
  return { state: `req_${id}.${await sha256Base64Url(secret)}`, cookie: cookie(cookieName(id, secure), secret, secure, TTL_SECONDS) };
}

export async function validateOAuthTransaction(state: string, header: string | undefined, secure: boolean): Promise<string | null> {
  const match = STATE.exec(state);
  if (!match) return null;
  const name = cookieName(match[1], secure);
  const entries = (header ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (entries.length !== 1) return null;
  const value = entries[0].slice(name.length + 1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value) || !safeEqual(await sha256Base64Url(value), match[2])) return null;
  return cookie(name, '', secure, 0);
}
