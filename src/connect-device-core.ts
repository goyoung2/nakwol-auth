const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type DeviceStateRow = {
  status: string;
  expires_at: number;
  consumed_at: number | null;
};

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function createUserCode(source: (length: number) => Uint8Array = randomBytes): string {
  const bytes = source(8);
  let raw = '';
  for (let i = 0; i < 8; i += 1) raw += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function deviceEffectiveStatus(row: DeviceStateRow, now = Date.now()): string {
  if (row.consumed_at != null || row.status === 'consumed') return 'consumed';
  if (row.status === 'denied') return 'denied';
  if (row.expires_at <= now) return 'expired';
  return row.status;
}

export function isDeviceRequestConsumable(row: DeviceStateRow, now = Date.now()): boolean {
  return deviceEffectiveStatus(row, now) === 'approved';
}
