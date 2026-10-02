export class SetupError extends Error { readonly code: string; readonly field: string; constructor(code: string, field?: string); }
export interface SetupDocument {
 readonly schemaVersion: 1; readonly clientId: string; readonly siteOrigin: string;
 readonly provider: 'cloudflare-workers' | 'cloudflare-pages' | 'vercel'; readonly buildDirectory: string;
 readonly presentationVersion: number; readonly policyVersion: number;
 readonly step: 'service' | 'hosting' | 'presentation' | 'policy' | 'review' | 'install' | 'verify'; readonly idempotencyKey: string;
}
export const SETUP_PROVIDERS: readonly string[];
export const SETUP_STEPS: readonly string[];
export function parseSetup(value: unknown): SetupDocument;
