import { DataAuthError, verifyPrincipal } from './auth.ts';
import { auditSuccessfulDataOpsRead } from './ops-audit.ts';
import type { DataEnv, DataPrincipal } from './types.ts';

export const DATA_OPS_CLIENT_ID = 'nakwol-data-ops';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function requireDataOpsPrincipal(
  request: Request,
  env: Pick<DataEnv, 'AUTH_ORIGIN' | 'AUTH_SERVICE'>,
  fetcher: Fetcher = fetch,
): Promise<DataPrincipal> {
  const clientId = request.headers.get('X-NAKWOL-CLIENT-ID')?.trim() ?? '';
  if (clientId !== DATA_OPS_CLIENT_ID) {
    throw new DataAuthError('OPS_CLIENT_DENIED', 403, 'DATA Ops 전용 client id가 필요합니다.');
  }

  const principal = await verifyPrincipal(request, env, fetcher);
  if (principal.clientId !== DATA_OPS_CLIENT_ID) {
    throw new DataAuthError('OPS_CLIENT_DENIED', 403, 'DATA Ops app binding이 일치하지 않습니다.');
  }
  if (principal.membershipRole !== 'admin') {
    throw new DataAuthError('OPS_ADMIN_REQUIRED', 403, 'NAKWOL membership admin만 DATA Ops에 접근할 수 있습니다.');
  }
  return principal;
}

export async function runDataOpsHandler(
  request: Request,
  env: DataEnv,
  operation: (principal: DataPrincipal) => Promise<Response>,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  try {
    const principal = await requireDataOpsPrincipal(request, env, fetcher);
    const response = await operation(principal);
    await auditSuccessfulDataOpsRead(request, response, env, principal);
    return response;
  } catch (error) {
    if (error instanceof DataAuthError) {
      return Response.json({ ok: false, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    console.error(error);
    return Response.json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'DATA Ops 내부 오류가 발생했습니다.' } }, { status: 500 });
  }
}