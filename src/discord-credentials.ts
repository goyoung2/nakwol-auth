import type { DiscordOAuthTokens } from './discord';
import type { Env } from './types';

export interface StoredDiscordCredential {
  readonly user_id: string;
  readonly access_ciphertext: string;
  readonly refresh_ciphertext: string;
  readonly key_version: number;
  readonly scope: string;
  readonly access_expires_at: number;
  readonly state: 'active' | 'reauth_required';
  readonly generation: number;
  readonly lease_owner: string | null;
  readonly lease_until: number | null;
  readonly retry_after: number | null;
}

function decodeKey(value: string | undefined): Uint8Array | null {
  if (!value) return null;
  try {
    const raw = Uint8Array.from(atob(value), character => character.charCodeAt(0));
    return raw.length === 32 ? raw : null;
  } catch { return null; }
}

function version(value: string | undefined): number | null {
  const parsed = Number(value);
  return value && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function keyForVersion(env: Env, wanted: number): Uint8Array | null {
  const current = version(env.DISCORD_CREDENTIAL_KEY_VERSION);
  if (wanted === current) return decodeKey(env.DISCORD_CREDENTIAL_KEY);
  const previous = version(env.DISCORD_CREDENTIAL_PREVIOUS_VERSION);
  const until = Number(env.DISCORD_CREDENTIAL_PREVIOUS_UNTIL);
  if (wanted === previous && Number.isSafeInteger(until) && Date.now() < until) {
    return decodeKey(env.DISCORD_CREDENTIAL_PREVIOUS_KEY);
  }
  return null;
}

export function credentialEncryptionReady(env: Env): boolean {
  return version(env.DISCORD_CREDENTIAL_KEY_VERSION) !== null && decodeKey(env.DISCORD_CREDENTIAL_KEY) !== null;
}

export function credentialReadable(env: Env, keyVersion: number): boolean {
  return keyForVersion(env, keyVersion) !== null;
}

function encode(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += String.fromCharCode(byte);
  return btoa(result);
}

async function cryptKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(env: Env, userId: string, purpose: 'access' | 'refresh', token: string): Promise<string> {
  const raw = decodeKey(env.DISCORD_CREDENTIAL_KEY);
  const current = version(env.DISCORD_CREDENTIAL_KEY_VERSION);
  if (!raw || current === null) throw new Error('DISCORD_CREDENTIAL_KEY_UNAVAILABLE');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${userId}:${purpose}:${current}`) },
    await cryptKey(raw), new TextEncoder().encode(token));
  return `${encode(iv)}.${encode(new Uint8Array(data))}`;
}

export async function decryptDiscordToken(env: Env, userId: string, purpose: 'access' | 'refresh', keyVersion: number, ciphertext: string): Promise<string> {
  const raw = keyForVersion(env, keyVersion);
  const [ivText, dataText, extra] = ciphertext.split('.');
  if (!raw || !ivText || !dataText || extra) throw new Error('DISCORD_CREDENTIAL_UNREADABLE');
  try {
    const iv = Uint8Array.from(atob(ivText), character => character.charCodeAt(0));
    const data = Uint8Array.from(atob(dataText), character => character.charCodeAt(0));
    if (iv.length !== 12) throw new Error('DISCORD_CREDENTIAL_UNREADABLE');
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(`${userId}:${purpose}:${keyVersion}`) }, await cryptKey(raw), data));
  } catch { throw new Error('DISCORD_CREDENTIAL_UNREADABLE'); }
}

export async function prepareEncryptedTokens(env: Env, userId: string, tokens: DiscordOAuthTokens) {
  const keyVersion = version(env.DISCORD_CREDENTIAL_KEY_VERSION);
  if (keyVersion === null) throw new Error('DISCORD_CREDENTIAL_KEY_UNAVAILABLE');
  const [accessCiphertext, refreshCiphertext] = await Promise.all([
    encrypt(env, userId, 'access', tokens.accessToken), encrypt(env, userId, 'refresh', tokens.refreshToken),
  ]);
  return { accessCiphertext, refreshCiphertext, keyVersion,
    accessExpiresAt: Date.now() + tokens.expiresIn * 1000, scope: tokens.scope };
}

export async function saveDiscordCredentials(env: Env, userId: string, tokens: DiscordOAuthTokens): Promise<void> {
  if (!credentialEncryptionReady(env)) return;
  const encrypted = await prepareEncryptedTokens(env, userId, tokens);
  await env.DB.prepare(`INSERT INTO discord_credentials
    (user_id, access_ciphertext, refresh_ciphertext, key_version, scope, access_expires_at, state, generation, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?)
    ON CONFLICT(user_id) DO UPDATE SET access_ciphertext=excluded.access_ciphertext,
      refresh_ciphertext=excluded.refresh_ciphertext, key_version=excluded.key_version,
      scope=excluded.scope, access_expires_at=excluded.access_expires_at, state='active',
      generation=discord_credentials.generation+1, lease_owner=NULL, lease_until=NULL,
      retry_after=NULL, updated_at=excluded.updated_at`)
    .bind(userId, encrypted.accessCiphertext, encrypted.refreshCiphertext, encrypted.keyVersion,
      encrypted.scope, encrypted.accessExpiresAt, Date.now()).run();
}

export async function readDiscordCredentials(env: Env, userId: string): Promise<StoredDiscordCredential | null> {
  return env.DB.prepare(`SELECT user_id, access_ciphertext, refresh_ciphertext, key_version, scope,
    access_expires_at, state, generation, lease_owner, lease_until, retry_after
    FROM discord_credentials WHERE user_id = ?`).bind(userId).first<StoredDiscordCredential>();
}

export async function deleteDiscordCredentials(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(`UPDATE discord_credentials SET access_ciphertext='', refresh_ciphertext='',
    state='reauth_required', generation=generation+1, lease_owner=NULL, lease_until=NULL,
    retry_after=NULL, updated_at=? WHERE user_id=?`).bind(Date.now(), userId).run();
}
