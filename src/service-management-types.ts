export interface ServiceActor { userId: string; isOperator: boolean }
export interface AppTarget { clientId?: string; subject?: string; sessionId?: string; operationId?: string; cursor?: string; supportCode?: string }
export class ServiceManagementError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 404 | 413 | 429) { super(code); }
}
