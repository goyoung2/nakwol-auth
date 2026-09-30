import { DiscordRefreshError, fetchOAuthGuildMember, refreshDiscordTokens, resolveNakwolRole } from './discord';
import { credentialEncryptionReady, credentialReadable, decryptDiscordToken, prepareEncryptedTokens, readDiscordCredentials } from './discord-credentials';
import { randomToken } from './crypto';
import type { Env } from './types';

const FRESH_MS = 15 * 60 * 1000;
const REFRESH_AFTER_MS = 14 * 60 * 1000;
const LEASE_MS = 15 * 1000;
const flights = new WeakMap<D1Database, Map<string, Promise<MembershipRefreshResult>>>();

export type MembershipRefreshResult =
  | { readonly kind: 'fresh'; readonly checkedAt: number; readonly validUntil: number }
  | { readonly kind: 'reauth-required'; readonly checkedAt: number | null; readonly validUntil: number }
  | { readonly kind: 'unavailable'; readonly checkedAt: number | null; readonly validUntil: number; readonly retryAfter: number | null };

async function lastChecked(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT checked_at FROM memberships WHERE user_id = ? AND guild_id = ?')
    .bind(userId, env.NAKWOL_GUILD_ID).first<{ checked_at: number }>();
  return row?.checked_at ?? null;
}

export async function legacyMembershipDeadline(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT legacy_deadline_at FROM membership_refresh_policy WHERE id = ?')
    .bind(1).first<{ legacy_deadline_at: number }>();
  const configured = Number(env.LEGACY_MEMBERSHIP_DEADLINE_AT);
  return Math.min(row?.legacy_deadline_at ?? 0,
    env.LEGACY_MEMBERSHIP_DEADLINE_AT && Number.isSafeInteger(configured) && configured > 0 ? configured : Infinity);
}

export async function membershipCredentialStatus(env: Env, userId: string): Promise<'automatic' | 'reauth-required' | 'legacy'> {
  const row = await readDiscordCredentials(env, userId);
  if (!row) return (await legacyMembershipDeadline(env)) > Date.now() ? 'legacy' : 'reauth-required';
  return row.state === 'active' && credentialEncryptionReady(env) && credentialReadable(env, row.key_version)
    ? 'automatic' : 'reauth-required';
}

export async function ensureFreshMembership(env: Env, userId: string,
  options: { readonly maxAgeMs?: number; readonly force?: boolean } = {}): Promise<MembershipRefreshResult> {
  let databaseFlights = flights.get(env.DB);
  if (!databaseFlights) { databaseFlights = new Map(); flights.set(env.DB, databaseFlights); }
  const key = `${userId}:${options.force ? 'force' : 'normal'}:${options.maxAgeMs ?? REFRESH_AFTER_MS}`;
  const existing = databaseFlights.get(key);
  if (existing) return existing;
  const flight = refreshMembershipOnce(env, userId, options);
  databaseFlights.set(key, flight);
  try { return await flight; }
  finally { if (databaseFlights.get(key) === flight) databaseFlights.delete(key); }
}

async function refreshMembershipOnce(env: Env, userId: string,
  options: { readonly maxAgeMs?: number; readonly force?: boolean }): Promise<MembershipRefreshResult> {
  const now = Date.now();
  const checkedAt = await lastChecked(env, userId);
  const requested = await env.DB.prepare('SELECT requested_at, completed_at FROM user_reauthentication WHERE user_id=?')
    .bind(userId).first<{requested_at:number;completed_at:number|null}>();
  if (requested && (!requested.completed_at || requested.completed_at <= requested.requested_at)) {
    return { kind: 'reauth-required', checkedAt, validUntil: 0 };
  }
  const credential = await readDiscordCredentials(env, userId);
  if (!credential) {
    const deadline = await legacyMembershipDeadline(env);
    const validUntil = Math.min((checkedAt ?? 0) + 24 * 60 * 60 * 1000, deadline);
    return !options.force && checkedAt && checkedAt <= now && validUntil > now ? { kind: 'fresh', checkedAt, validUntil }
      : { kind: 'reauth-required', checkedAt, validUntil };
  }
  const validUntil = (checkedAt ?? 0) + FRESH_MS;
  if (credential.state === 'reauth_required' || !credentialEncryptionReady(env) || !credentialReadable(env, credential.key_version)) {
    return { kind: 'reauth-required', checkedAt, validUntil };
  }
  const maxAgeMs = Math.min(options.maxAgeMs ?? REFRESH_AFTER_MS, FRESH_MS);
  if (!options.force && checkedAt && checkedAt <= now && now - checkedAt < maxAgeMs) {
    return { kind: 'fresh', checkedAt, validUntil };
  }
  if (credential.retry_after && credential.retry_after > now) {
    return { kind: 'unavailable', checkedAt, validUntil, retryAfter: credential.retry_after };
  }
  const owner = randomToken(16);
  const lease = await env.DB.prepare(`UPDATE discord_credentials SET lease_owner = ?, lease_until = ?
    WHERE user_id = ? AND generation = ? AND state = 'active'
      AND (lease_until IS NULL OR lease_until < ?) AND (retry_after IS NULL OR retry_after <= ?)`)
    .bind(owner, now + LEASE_MS, userId, credential.generation, now, now).run();
  if (lease.meta.changes !== 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const latestCredential = await readDiscordCredentials(env, userId);
      const latest = await lastChecked(env, userId);
      const latestUntil = (latest ?? 0) + FRESH_MS;
      if (latestCredential?.state === 'reauth_required') return { kind: 'reauth-required', checkedAt: latest, validUntil: latestUntil };
      if (latest && latest > (checkedAt ?? 0) && latestUntil > Date.now()) {
        return { kind: 'fresh', checkedAt: latest, validUntil: latestUntil };
      }
      if (!latestCredential?.lease_owner) break;
    }
    return { kind: 'unavailable', checkedAt, validUntil, retryAfter: now + 1000 };
  }
  let generation = credential.generation;
  try {
    const refreshToken = await decryptDiscordToken(env, userId, 'refresh', credential.key_version, credential.refresh_ciphertext);
    let activeRefreshToken = refreshToken;
    let accessToken: string;
    let rotated: Awaited<ReturnType<typeof prepareEncryptedTokens>> | null = null;
    if (credential.access_expires_at > Date.now() + 30000) {
      accessToken = await decryptDiscordToken(env, userId, 'access', credential.key_version, credential.access_ciphertext);
      if (credential.key_version !== Number(env.DISCORD_CREDENTIAL_KEY_VERSION)) {
        rotated = await prepareEncryptedTokens(env, userId, { accessToken, refreshToken, scope: credential.scope,
          expiresIn: Math.max(1, Math.floor((credential.access_expires_at - Date.now()) / 1000)) });
      }
    } else {
      const tokens = await refreshDiscordTokens(env, refreshToken);
      accessToken = tokens.accessToken;
      activeRefreshToken = tokens.refreshToken;
      rotated = await prepareEncryptedTokens(env, userId, tokens);
    }
    const persistRotation = async (value: Awaited<ReturnType<typeof prepareEncryptedTokens>>) => {
      const persisted = await env.DB.prepare(`UPDATE discord_credentials SET access_ciphertext=?, refresh_ciphertext=?,
        key_version=?, scope=?, access_expires_at=?, generation=generation+1, updated_at=?
        WHERE user_id=? AND generation=? AND lease_owner=? AND lease_until>? AND state='active'`)
        .bind(value.accessCiphertext, value.refreshCiphertext, value.keyVersion, value.scope,
          value.accessExpiresAt, Date.now(), userId, generation, owner, Date.now()).run();
      if (persisted.meta.changes !== 1) throw new DiscordRefreshError('unavailable');
      generation += 1;
    };
    if (rotated) await persistRotation(rotated);
    let member;
    try {
      member = await fetchOAuthGuildMember(env, accessToken);
    } catch (error) {
      if (!(error instanceof DiscordRefreshError) || error.kind !== 'access_expired') throw error;
      const tokens = await refreshDiscordTokens(env, activeRefreshToken);
      await persistRotation(await prepareEncryptedTokens(env, userId, tokens));
      member = await fetchOAuthGuildMember(env, tokens.accessToken);
    }
    const checked = Date.now();
    const role = resolveNakwolRole(env, member);
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships(user_id, guild_id, is_guild_member, role, status, checked_at, role_ids)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM discord_credentials
        WHERE user_id=? AND generation=? AND lease_owner=? AND lease_until>? AND state='active')
      ON CONFLICT(user_id, guild_id) DO UPDATE SET
      is_guild_member=excluded.is_guild_member, role=excluded.role, status=excluded.status,
      checked_at=excluded.checked_at, role_ids=excluded.role_ids
      WHERE memberships.checked_at <= excluded.checked_at`)
      .bind(userId, env.NAKWOL_GUILD_ID, member ? 1 : 0, role, role === 'member' ? 'active' : 'inactive',
        checked, JSON.stringify(member?.roles ?? []), userId, generation, owner, checked),
      env.DB.prepare(`UPDATE discord_credentials SET generation=generation+1, lease_owner=NULL, lease_until=NULL,
        retry_after=NULL, last_error=NULL, updated_at=? WHERE user_id=? AND generation=? AND lease_owner=? AND lease_until>? AND state='active'`)
        .bind(checked, userId, generation, owner, checked),
    ]);
    if (results[0]?.meta.changes !== 1 || results[1]?.meta.changes !== 1) {
      return { kind: 'unavailable', checkedAt, validUntil, retryAfter: null };
    }
    return { kind: 'fresh', checkedAt: checked, validUntil: checked + FRESH_MS };
  } catch (error) {
    const kind = error instanceof DiscordRefreshError ? error.kind : 'unavailable';
    const retryAfter = kind === 'rate_limited' ? Date.now() + Math.max(error instanceof DiscordRefreshError ? error.retryAfterMs : 0, 1000)
      : kind === 'unavailable' || kind === 'access_expired' ? Date.now() + 30000 : null;
    await env.DB.prepare(`UPDATE discord_credentials SET state=?, retry_after=?, last_error=?, lease_owner=NULL, lease_until=NULL,
      updated_at=? WHERE user_id=? AND generation=? AND lease_owner=?`)
      .bind(kind === 'reauth_required' ? 'reauth_required' : 'active', retryAfter, kind, Date.now(), userId,
        generation, owner).run();
    return kind === 'reauth_required' ? { kind: 'reauth-required', checkedAt, validUntil }
      : { kind: 'unavailable', checkedAt, validUntil, retryAfter };
  }
}
