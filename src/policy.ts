import type { Env } from './types';
import { getUserWithMembership } from './store';

export const NAKWOL_CONNECT_POLICY_VERSION = '0.1.0';
export type ApplicationAccessPolicy = 'public' | 'member' | 'admin';

export async function getApplicationAccessPolicy(env: Env, clientId: string): Promise<ApplicationAccessPolicy> {
  const row = await env.DB.prepare(
    `SELECT access_policy FROM application_settings WHERE client_id = ?`
  ).bind(clientId).first<{ access_policy: string }>();

  if (row?.access_policy === 'member' || row?.access_policy === 'admin') return row.access_policy;
  return 'public';
}

export async function isApplicationAccessAllowed(env: Env, userId: string, clientId: string): Promise<boolean> {
  const policy = await getApplicationAccessPolicy(env, clientId);
  if (policy === 'public') return true;

  const user = await getUserWithMembership(env, userId);
  if (!user || user.status !== 'active') return false;
  if (policy === 'member') return Boolean(user.membership?.is_member);
  return user.membership?.role === 'admin';
}
