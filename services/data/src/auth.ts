import type { DataEnv, DataPrincipal } from './types.ts';

export class DataAuthError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'DataAuthError';
    this.code = code;
    this.status = status;
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  return header.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export async function verifyPrincipal(request: Request, env: Pick<DataEnv,'AUTH_ORIGIN'|'AUTH_SERVICE'>, fetcher: Fetcher = fetch): Promise<DataPrincipal> {
  const token = bearerToken(request);
  const clientId = request.headers.get('X-NAKWOL-CLIENT-ID')?.trim() ?? '';
  if (!token || !clientId) throw new DataAuthError('UNAUTHORIZED',401,'NAKWOL access token과 client id가 필요합니다.');
  const authOrigin = env.AUTH_ORIGIN.replace(/\/$/,'');
  const authUrl = `${authOrigin}/me?client_id=${encodeURIComponent(clientId)}`;
  const headers = new Headers({ Authorization:`Bearer ${token}` });
  const origin = request.headers.get('Origin');
  if (origin) headers.set('Origin',origin);
  let response: Response;
  try {
    response = env.AUTH_SERVICE
      ? await env.AUTH_SERVICE.fetch(new Request(authUrl, { headers }))
      : await fetcher(authUrl, { headers });
  }
  catch { throw new DataAuthError('AUTH_UNAVAILABLE',503,'NAKWOL AUTH에 연결할 수 없습니다.'); }
  if (!response.ok) throw new DataAuthError('AUTH_REJECTED',response.status,'NAKWOL AUTH가 요청을 거부했습니다.');
  let payload: any;
  try { payload = await response.json(); }
  catch { throw new DataAuthError('INVALID_AUTH_RESPONSE',502,'NAKWOL AUTH 응답을 해석할 수 없습니다.'); }
  const data = payload?.data;
  const role = data?.membership?.role;
  if (payload?.ok !== true || typeof data?.id !== 'string' || typeof data?.display_name !== 'string' || !['user','member','admin'].includes(role)) {
    throw new DataAuthError('INVALID_AUTH_RESPONSE',502,'NAKWOL AUTH 사용자 응답이 올바르지 않습니다.');
  }
  return { userId:data.id, clientId, displayName:data.display_name, avatarUrl:typeof data.avatar_url === 'string' ? data.avatar_url : null, membershipRole:role };
}
