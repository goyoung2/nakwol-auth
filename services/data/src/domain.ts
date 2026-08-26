export const DATA_SERVICE_VERSION = '0.2.0' as const;
export const DATA_SCHEMA_VERSION = 2 as const;

export const DATA_SCOPES = [
  'profile:read','profile:write','roster:read','roster:write',
  'equipment:read','equipment:write','decks:read','decks:write',
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];
export type DataIdPrefix = 'gac' | 'eqp' | 'dek' | 'dks';

export function isDataScope(value: string): value is DataScope {
  return (DATA_SCOPES as readonly string[]).includes(value);
}

export function normalizeGameAccountInput(input: { nickname?: unknown; server_code?: unknown; is_primary?: unknown; }): { nickname: string; serverCode: string; isPrimary: boolean } {
  const nickname = typeof input.nickname === 'string' ? input.nickname.trim() : '';
  const serverCode = typeof input.server_code === 'string' ? input.server_code.trim() : '';
  if (!nickname) throw new Error('INVALID_NICKNAME');
  if (!serverCode) throw new Error('INVALID_SERVER_CODE');
  return { nickname, serverCode, isPrimary: input.is_primary === true };
}

export function newDataId(prefix: DataIdPrefix): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${body}`;
}
