export interface DiagnosticSettings { clientId: string; clientName?: string; authOrigin: string; siteOrigin?: string; redirectUri?: string; sitePing?: boolean; central?: boolean; }
export function diagnosticsPage(settings: DiagnosticSettings): string;
export function diagnosticMarkup(): string;
export function diagnosticScript(settings: DiagnosticSettings): string;
export const diagnosticStyles: string;
