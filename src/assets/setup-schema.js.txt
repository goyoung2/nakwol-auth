export class SetupError extends Error {
  constructor(code, field = '') { super(field ? `${code}: ${field}` : code); this.code = code; this.field = field; }
}

export const SETUP_PROVIDERS = Object.freeze(['cloudflare-workers', 'cloudflare-pages', 'vercel']);
export const SETUP_STEPS = Object.freeze(['service', 'hosting', 'presentation', 'policy', 'review', 'install', 'verify']);
const keys = ['schemaVersion', 'clientId', 'siteOrigin', 'provider', 'buildDirectory', 'presentationVersion', 'policyVersion', 'step', 'idempotencyKey'];

// This portable document contains configuration references, never authority or secrets.
export function parseSetup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SetupError('SETUP_INVALID_DOCUMENT');
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new SetupError('SETUP_UNKNOWN_FIELDS');
  if (value.schemaVersion !== 1) throw new SetupError('SETUP_UNSUPPORTED_SCHEMA', 'schemaVersion');
  if (typeof value.clientId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.clientId)) throw new SetupError('SETUP_INVALID_CLIENT', 'clientId');
  let origin;
  try { origin = new URL(value.siteOrigin); } catch { throw new SetupError('SETUP_INVALID_ORIGIN', 'siteOrigin'); }
  if (origin.protocol !== 'https:' || origin.origin !== value.siteOrigin || origin.username || origin.password) throw new SetupError('SETUP_INVALID_ORIGIN', 'siteOrigin');
  if (!SETUP_PROVIDERS.includes(value.provider)) throw new SetupError('SETUP_UNSUPPORTED_PROVIDER', 'provider');
  if (typeof value.buildDirectory !== 'string' || value.buildDirectory.length > 180 || !value.buildDirectory.split('/').every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part))) throw new SetupError('SETUP_INVALID_BUILD_DIRECTORY', 'buildDirectory');
  for (const key of ['presentationVersion', 'policyVersion']) if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw new SetupError('SETUP_INVALID_VERSION', key);
  if (!SETUP_STEPS.includes(value.step)) throw new SetupError('SETUP_INVALID_STEP', 'step');
  if (typeof value.idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey)) throw new SetupError('SETUP_INVALID_KEY', 'idempotencyKey');
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}
