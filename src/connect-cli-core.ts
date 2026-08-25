export function normalizeClientId(input: string): string {
  let value = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!value) value = 'app';
  if (value.length < 3) value = `app-${value}`;
  value = value.slice(0, 63).replace(/-+$/g, '');
  return value || 'app';
}

export async function chooseAvailableClientId(
  requested: string,
  exists: (clientId: string) => Promise<boolean>,
  suffixFactory: () => string = () => Math.random().toString(36).slice(2, 6),
): Promise<string> {
  const base = normalizeClientId(requested);
  if (!await exists(base)) return base;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = String(suffixFactory()).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 6);
    const stem = base.slice(0, Math.max(1, 63 - suffix.length - 1)).replace(/-+$/g, '');
    const candidate = `${stem}-${suffix}`;
    if (!await exists(candidate)) return candidate;
  }
  throw new Error('CLIENT_ID_ALLOCATION_FAILED');
}

export type RedirectValidation =
  | { ok: true; value: string[] }
  | { ok: false; error: string };

export function validateRedirectUris(input: unknown): RedirectValidation {
  if (!Array.isArray(input) || input.length < 1) return { ok: false, error: 'redirect_uris must contain at least one URL' };
  if (input.length > 10) return { ok: false, error: 'redirect_uris supports at most 10 URLs' };
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== 'string' || !item.trim()) return { ok: false, error: 'redirect URI must be a non-empty string' };
    try {
      const url = new URL(item.trim());
      if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'redirect URI must use http or https' };
      if (url.hash) return { ok: false, error: 'redirect URI must not contain a fragment' };
      if (url.username || url.password) return { ok: false, error: 'redirect URI must not contain credentials' };
      const normalized = url.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(normalized);
      }
    } catch {
      return { ok: false, error: 'redirect URI is not a valid URL' };
    }
  }
  return { ok: true, value: result };
}
