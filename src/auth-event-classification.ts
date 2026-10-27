// Read-time classification keeps the historical event type and payload intact.
export const AUTH_EVENT_CATEGORY_SQL = `CASE
  WHEN e.event_type IN ('authorize.access_denied','discord.login.access_denied')
    AND CASE WHEN json_valid(e.detail) THEN json_extract(e.detail, '$.diagnosis.reason') END
      IN ('MEMBERSHIP_REFRESH_REQUIRED','REAUTHENTICATION_REQUIRED') THEN 'refresh'
  WHEN e.event_type IN ('authorize.access_denied','discord.login.access_denied') THEN 'denied'
  WHEN e.event_type = 'discord.login.error' THEN 'error'
  ELSE 'other' END`;

export function currentAccessState(diagnosis: { readonly allowed: boolean; readonly reason: string }): 'allowed' | 'refresh' | 'blocked' {
  if (diagnosis.allowed) return 'allowed';
  return ['MEMBERSHIP_REFRESH_REQUIRED', 'REAUTHENTICATION_REQUIRED'].includes(diagnosis.reason) ? 'refresh' : 'blocked';
}
