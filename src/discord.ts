import type { DiscordGuildMember, DiscordUser, Env } from './types';

const DISCORD_API = 'https://discord.com/api/v10';

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

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Discord token exchange failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error('Discord access_token is missing.');
  return payload.access_token;
}

export async function fetchDiscordIdentity(env: Env, accessToken: string): Promise<DiscordIdentityResult> {
  const authHeaders = { Authorization: `Bearer ${accessToken}` };
  const userResponse = await fetch(`${DISCORD_API}/users/@me`, { headers: authHeaders });
  if (!userResponse.ok) throw new Error(`Discord /users/@me failed (${userResponse.status}).`);
  const user = await userResponse.json() as DiscordUser;

  const memberResponse = await fetch(`${DISCORD_API}/users/@me/guilds/${env.NAKWOL_GUILD_ID}/member`, { headers: authHeaders });
  if (memberResponse.status === 404) return { user, member: null };
  if (!memberResponse.ok) {
    const detail = await memberResponse.text();
    throw new Error(`Discord guild member lookup failed (${memberResponse.status}): ${detail.slice(0, 300)}`);
  }

  const member = await memberResponse.json() as DiscordGuildMember;
  return { user, member };
}

export function resolveNakwolRole(env: Env, member: DiscordGuildMember | null): 'user' | 'member' | 'admin' {
  if (!member) return 'user';
  const roles = new Set(member.roles ?? []);
  const adminRole = env.NAKWOL_ADMIN_ROLE_ID?.trim();
  const memberRole = env.NAKWOL_MEMBER_ROLE_ID?.trim();
  if (adminRole && roles.has(adminRole)) return 'admin';
  if (!memberRole || roles.has(memberRole)) return 'member';
  return 'user';
}

export function discordAvatarUrl(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}
