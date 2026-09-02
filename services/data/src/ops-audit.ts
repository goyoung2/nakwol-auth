import type { DataEnv, DataPrincipal } from './types.ts';

export type DataOpsAuditAction = 'SEARCH_ACCOUNT' | 'VIEW_ACCOUNT' | 'VIEW_DECK';

type AuditTarget = {
  action: DataOpsAuditAction;
  targetUserId: string | null;
  targetAccountId: string | null;
};

function newAuditId(): string {
  return `opa_${crypto.randomUUID()}`;
}

function newRequestId(): string {
  return `ops_${crypto.randomUUID()}`;
}

function pathSegments(request: Request): string[] {
  return new URL(request.url).pathname.split('/').filter(Boolean);
}

async function successfulTarget(request: Request, response: Response): Promise<AuditTarget | null> {
  if (request.method !== 'GET' || !response.ok) return null;
  const parts = pathSegments(request);
  if (parts.length === 3 && parts[0] === 'internal' && parts[1] === 'ops' && parts[2] === 'accounts') {
    return { action: 'SEARCH_ACCOUNT', targetUserId: null, targetAccountId: null };
  }

  if (parts.length === 4 && parts[0] === 'internal' && parts[1] === 'ops' && parts[2] === 'accounts') {
    const payload = await response.clone().json() as any;
    const account = payload?.data?.account;
    if (!account?.id || !account?.user_id) throw new Error('OPS_AUDIT_TARGET_MISSING');
    return { action: 'VIEW_ACCOUNT', targetUserId: String(account.user_id), targetAccountId: String(account.id) };
  }

  if (parts.length === 6 && parts[0] === 'internal' && parts[1] === 'ops' && parts[2] === 'accounts' && parts[4] === 'decks') {
    const payload = await response.clone().json() as any;
    const deck = payload?.data?.deck;
    if (!deck?.account_id || !deck?.user_id) throw new Error('OPS_AUDIT_TARGET_MISSING');
    return { action: 'VIEW_DECK', targetUserId: String(deck.user_id), targetAccountId: String(deck.account_id) };
  }

  return null;
}

export async function auditSuccessfulDataOpsRead(
  request: Request,
  response: Response,
  env: Pick<DataEnv, 'DB'>,
  principal: DataPrincipal,
): Promise<void> {
  const target = await successfulTarget(request, response);
  if (!target) return;
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO data_ops_audit_log(
      id, operator_user_id, target_user_id, target_account_id, action, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    newAuditId(),
    principal.userId,
    target.targetUserId,
    target.targetAccountId,
    target.action,
    newRequestId(),
    now,
  ).run();
}