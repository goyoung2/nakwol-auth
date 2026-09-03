import type { Env } from './types';

export type ConnectDeveloperRole = 'developer' | 'operator';
export type ConnectDeveloperStatus = 'active' | 'disabled';

export function isDiscordUserId(value: string): boolean {
  return /^\d{15,22}$/.test(value.trim());
}

export async function applyDiscordDeveloperPregrant(
  env: Env,
  discordUserId: string,
  userId: string,
): Promise<ConnectDeveloperRole | null> {
  const grant = await env.DB.prepare(
    `SELECT role, status, created_by_user_id
       FROM connect_developer_pregrants
      WHERE discord_user_id = ?`,
  ).bind(discordUserId).first<{ role: ConnectDeveloperRole; status: ConnectDeveloperStatus; created_by_user_id: string | null }>();

  if (!grant || grant.status !== 'active') return null;

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO connect_developers(
         user_id, role, status, created_at, updated_at, created_by_user_id, grant_source, discord_user_id
       ) VALUES (?, ?, 'active', ?, ?, ?, 'discord_pregrant', ?)
       ON CONFLICT(user_id) DO UPDATE SET
         role = excluded.role,
         status = 'active',
         updated_at = excluded.updated_at,
         grant_source = 'discord_pregrant',
         discord_user_id = excluded.discord_user_id`,
    ).bind(userId, grant.role, now, now, grant.created_by_user_id, discordUserId),
    env.DB.prepare(
      `UPDATE connect_developer_pregrants
          SET linked_user_id = ?, linked_at = COALESCE(linked_at, ?), updated_at = ?
        WHERE discord_user_id = ?`,
    ).bind(userId, now, now, discordUserId),
  ]);

  return grant.role;
}

export async function ensureDiscordDeveloperPregrantForUser(
  env: Env,
  userId: string,
): Promise<ConnectDeveloperRole | null> {
  const identity = await env.DB.prepare(
    `SELECT provider_user_id
       FROM auth_identities
      WHERE user_id = ? AND provider = 'discord'`,
  ).bind(userId).first<{ provider_user_id: string }>();

  if (!identity?.provider_user_id) return null;
  return applyDiscordDeveloperPregrant(env, identity.provider_user_id, userId);
}

export async function grantDiscordDeveloperPregrant(
  env: Env,
  input: { discordUserId: string; role: ConnectDeveloperRole; createdByUserId: string },
): Promise<{ linkedUserId: string | null }> {
  const discordUserId = input.discordUserId.trim();
  const now = Date.now();

  await env.DB.prepare(
    `INSERT INTO connect_developer_pregrants(
       discord_user_id, role, status, linked_user_id, created_at, updated_at, linked_at, created_by_user_id
     ) VALUES (?, ?, 'active', NULL, ?, ?, NULL, ?)
     ON CONFLICT(discord_user_id) DO UPDATE SET
       role = excluded.role,
       status = 'active',
       updated_at = excluded.updated_at,
       created_by_user_id = excluded.created_by_user_id`,
  ).bind(discordUserId, input.role, now, now, input.createdByUserId).run();

  const identity = await env.DB.prepare(
    `SELECT user_id
       FROM auth_identities
      WHERE provider = 'discord' AND provider_user_id = ?`,
  ).bind(discordUserId).first<{ user_id: string }>();

  if (identity?.user_id) {
    await applyDiscordDeveloperPregrant(env, discordUserId, identity.user_id);
    return { linkedUserId: identity.user_id };
  }

  return { linkedUserId: null };
}

export async function updateDiscordDeveloperPregrant(
  env: Env,
  input: { discordUserId: string; role: ConnectDeveloperRole; status: ConnectDeveloperStatus },
): Promise<boolean> {
  const now = Date.now();
  const result = await env.DB.prepare(
    `UPDATE connect_developer_pregrants
        SET role = ?, status = ?, updated_at = ?
      WHERE discord_user_id = ?`,
  ).bind(input.role, input.status, now, input.discordUserId).run();

  if (Number(result.meta?.changes ?? 0) < 1) return false;

  if (input.status === 'active') {
    const linked = await env.DB.prepare(
      `SELECT linked_user_id
         FROM connect_developer_pregrants
        WHERE discord_user_id = ?`,
    ).bind(input.discordUserId).first<{ linked_user_id: string | null }>();
    if (linked?.linked_user_id) {
      await applyDiscordDeveloperPregrant(env, input.discordUserId, linked.linked_user_id);
    }
  } else {
    await env.DB.prepare(
      `UPDATE connect_developers
          SET role = ?, status = 'disabled', updated_at = ?
        WHERE grant_source = 'discord_pregrant' AND discord_user_id = ?`,
    ).bind(input.role, now, input.discordUserId).run();
  }

  return true;
}