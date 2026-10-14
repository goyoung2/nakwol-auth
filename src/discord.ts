import { measured, type DiagnosticTrace } from './diagnostic-trace';
import type { DiscordGuildMember, DiscordUser, Env } from './types';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_REQUEST_TIMEOUT_MS = 5000;
const DISCORD_RESPONSE_MAX_BYTES = 64 * 1024;

type DiscordOperation = 'token' | 'identity' | 'member';
type DiscordFailure = 'timeout' | 'network' | 'http' | 'invalid_response' | 'response_too_large';

export class DiscordRequestError extends Error {
  readonly name = 'DiscordRequestError';
  constructor(readonly operation: DiscordOperation, readonly code: DiscordFailure, readonly httpStatus?: number) {
    super(`DISCORD_${operation.toUpperCase()}_${code.toUpperCase()}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
  }
}

async function requestDiscordJson(operation: DiscordOperation, url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DiscordRequestError(operation, 'timeout'));
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
    }, DISCORD_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await fetch(url, { ...init, signal: controller.signal, redirect: 'manual' });
      if (operation === 'member' && response.status === 404) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        return null;
      }
      if (!response.ok) {
        if (response.body) void response.body.cancel().catch(() => undefined);
        throw new DiscordRequestError(operation, 'http', response.status);
      }
      if (!response.body) throw new DiscordRequestError(operation, 'invalid_response');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > DISCORD_RESPONSE_MAX_BYTES) throw new DiscordRequestError(operation, 'response_too_large');
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try {
        const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
        if (payload === null) throw new DiscordRequestError(operation, 'invalid_response');
        return payload;
      }
      catch (error) {
        if (error instanceof Error) throw new DiscordRequestError(operation, 'invalid_response');
        throw error;
      }
    })()]);
  } catch (error) {
    if (error instanceof DiscordRequestError) throw error;
    throw new DiscordRequestError(operation, controller.signal.aborted ? 'timeout' : 'network');
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => undefined);
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string';
}

function parseDiscordMember(value: unknown): DiscordGuildMember | null {
  if (value === null) return null;
  if (!record(value) || !Array.isArray(value.roles)
      || !value.roles.every((role: unknown): role is string => typeof role === 'string' && /^\d{17,20}$/.test(role))
      || !optionalText(value.nick) || !optionalText(value.avatar)) {
    throw new DiscordRequestError('member', 'invalid_response');
  }
  return { roles: value.roles, nick: value.nick, avatar: value.avatar };
}

export interface DiscordIdentityResult {
  user: DiscordUser;
  member: DiscordGuildMember | null;
}

export function buildDiscordAuthorizeUrl(env: Env, requestId: string): string {
  const callback = `${env.AUTH_ORIGIN.replace(/\/$/, '')}/auth/discord/callback`;
  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callback);
  url.searchParams.set('scope', 'identify guilds.members.read');
  url.searchParams.set('state', requestId);
  return url.toString();
}

export async function exchangeDiscordCode(env: Env, code: string): Promise<string> {
  const callback = `${env.AUTH_ORIGIN.replace(/\/$/, '')}/auth/discord/callback`;
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: callback,
  });

  const payload = await requestDiscordJson('token', 'https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!record(payload) || typeof payload.access_token !== 'string' || !payload.access_token.trim()) {
    throw new DiscordRequestError('token', 'invalid_response');
  }
  return payload.access_token;
}

export async function fetchDiscordIdentity(env: Env, accessToken: string, trace?: DiagnosticTrace): Promise<DiscordIdentityResult> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const [user, member] = await Promise.all([
    measured(trace, 'discord_identity', async (): Promise<DiscordUser> => {
      const payload = await requestDiscordJson('identity', `${DISCORD_API}/users/@me`, { headers: authHeaders });
      if (!record(payload) || typeof payload.id !== 'string' || !/^\d{17,20}$/.test(payload.id)
          || typeof payload.username !== 'string' || !payload.username.trim()
          || !optionalText(payload.global_name) || !optionalText(payload.avatar)) {
        throw new DiscordRequestError('identity', 'invalid_response');
      }
      return { id: payload.id, username: payload.username, global_name: payload.global_name, avatar: payload.avatar };
    }),
    measured(trace, 'discord_member', async () => {
      const payload = await requestDiscordJson('member', `${DISCORD_API}/users/@me/guilds/${env.NAKWOL_GUILD_ID}/member`, { headers: authHeaders });
      return parseDiscordMember(payload);
    }),
  ]);
  return { user, member };
}

export function resolveNakwolRole(env: Env, member: DiscordGuildMember | null): 'user' | 'member' {
  if (!member) return 'user';
  const roles = new Set(member.roles ?? []);
  const memberRole = env.NAKWOL_MEMBER_ROLE_ID?.trim();
  if (memberRole && /^\d{17,20}$/.test(memberRole) && roles.has(memberRole)) return 'member';
  return 'user';
}

export class DiscordMembershipUnavailable extends Error {
  constructor(readonly httpStatus?: number) {
    super(`DISCORD_MEMBERSHIP_UNAVAILABLE${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    this.name = 'DiscordMembershipUnavailable';
  }
}

/** No positive cache: each authorization observes Discord's current membership. */
export async function fetchCurrentGuildMember(env: Env, discordUserId: string): Promise<DiscordGuildMember | null> {
  const botToken = env.DISCORD_BOT_TOKEN2 || env.DISCORD_BOT_TOKEN;
  if (!botToken || !/^\d{17,20}$/.test(env.NAKWOL_GUILD_ID)
      || !/^\d{17,20}$/.test(discordUserId)) throw new DiscordMembershipUnavailable();
  try {
    const payload = await requestDiscordJson('member', `${DISCORD_API}/guilds/${env.NAKWOL_GUILD_ID}/members/${discordUserId}`, {
      headers: { Authorization: `Bot ${botToken}`, 'Cache-Control': 'no-cache' },
    });
    return parseDiscordMember(payload);
  } catch (error) {
    if (error instanceof DiscordRequestError) throw new DiscordMembershipUnavailable(error.httpStatus);
    if (error instanceof Error) throw new DiscordMembershipUnavailable();
    throw error;
  }
}

export function discordAvatarUrl(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}
