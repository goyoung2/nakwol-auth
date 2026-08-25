export type DevicePollStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired';

export function normalizeClientId(input: string): string {
  const normalized = input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
    .replace(/-$/g, '');
  return normalized || 'nakwol-app';
}

export function validateConnectRedirectUri(value: string):
  | { ok: true; value: string }
  | { ok: false; code: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, code: 'INVALID_REDIRECT_URI' };
  }

  if (url.protocol === 'https:') return { ok: true, value: url.toString() };
  const localhost = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (url.protocol === 'http:' && localhost.has(url.hostname)) {
    return { ok: true, value: url.toString() };
  }
  return { ok: false, code: url.protocol === 'http:' ? 'HTTPS_REQUIRED' : 'INVALID_REDIRECT_URI' };
}

export function resolveDevicePollStatus(status: string, expiresAt: number, now: number): DevicePollStatus {
  if (status === 'pending' && expiresAt <= now) return 'expired';
  if (status === 'approved' || status === 'denied' || status === 'consumed' || status === 'expired') return status;
  return 'pending';
}

export function canDeveloperManageApp(input: {
  isOperator: boolean;
  userId: string;
  ownerUserIds: string[];
}): boolean {
  return input.isOperator || input.ownerUserIds.includes(input.userId);
}
