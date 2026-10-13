export type ServerEnvironment = Readonly<Record<string, string | undefined>>;
export const CANARY_ORIGIN = 'https://nakwol-auth-vercel-test.vercel.app';
export const CANARY_DATABASE_ID = '7b3849c6-7d11-41ba-983f-b4ea3876f24f';
export const uuidValid = (value: string | undefined): value is string => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) && value !== '00000000-0000-0000-0000-000000000000');
export function productionOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password || value === CANARY_ORIGIN || !url.hostname.includes('.') || url.hostname.endsWith('.workers.dev')) return null;
    return value;
  } catch (error) { if (error instanceof TypeError) return null; throw error; }
}
export type Deployment = { readonly mode: 'canary'; readonly origin: typeof CANARY_ORIGIN } | { readonly mode: 'production'; readonly origin: string; readonly databaseId: string };
export function deployment(values: ServerEnvironment): Deployment | null {
  if (values.NAKWOL_AUTH_MODE === 'production') {
    const origin = productionOrigin(values.AUTH_ORIGIN);
    const id = values.D1_BRIDGE_DATABASE_ID;
    if (!origin || values.VERCEL_ENV !== 'production' || values.NAKWOL_VERCEL_CANARY === 'true' || !uuidValid(id) || id.toLowerCase() === CANARY_DATABASE_ID) return null;
    return { mode: 'production', origin, databaseId: id.toLowerCase() };
  }
  if (values.NAKWOL_AUTH_MODE !== undefined && values.NAKWOL_AUTH_MODE !== 'canary') return null;
  return values.NAKWOL_VERCEL_CANARY === 'true' && values.AUTH_ORIGIN === CANARY_ORIGIN ? { mode: 'canary', origin: CANARY_ORIGIN } : null;
}
