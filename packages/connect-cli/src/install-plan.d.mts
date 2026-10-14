export type InstallationStep = { readonly id: string; readonly title: string; readonly description: string; readonly commands: readonly string[]; readonly manual: boolean };
export function quoteArgument(value: unknown): string;
export function buildInstallationPlan(options?: Readonly<Record<string, unknown>>): {
  readonly ok: boolean; readonly kind: string; readonly completed: boolean;
  readonly provider: string; readonly url: string; readonly assets: string;
  readonly projectName: string; readonly accessPolicy: string; readonly authMode: string;
  readonly authOrigin: string; readonly steps: readonly InstallationStep[];
};
