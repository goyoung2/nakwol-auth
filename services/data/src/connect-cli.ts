import { DATA_SCOPES, isDataScope } from './domain.ts';
import { getDataApplicationState, replaceDataApplicationScopes } from './store.ts';
import type { DataEnv, DataScope } from './types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type ManagedAuthApp = { client_id: string; status: 'active' | 'disabled' };

function bearer(request: Request): string | null {
  const value = request.headers.get('Authorization') || '';
  return value.match(/^Bearer\s+(.+)$/i)?.[1] || null;
}
function jsonError(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}
export async function verifyManagedAuthApp(request: Request, env: Pick<DataEnv,'AUTH_ORIGIN'>, clientId: string, fetcher: Fetcher = fetch): Promise<ManagedAuthApp | Response> {
  const token = bearer(request);
  if (!token) return jsonError(401, 'UNAUTHORIZED', 'Connect CLI token이 필요합니다.');
  let response: Response;
  try {
    response = await fetcher(`${env.AUTH_ORIGIN.replace(/\/$/,'')}/connect/cli/apps/${encodeURIComponent(clientId)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    return jsonError(503, 'AUTH_UNAVAILABLE', 'NAKWOL AUTH에 연결할 수 없습니다.');
  }
  let payload: any = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) {
    const error = payload?.error;
    return jsonError(response.status, error?.code || 'AUTH_REJECTED', error?.message || 'NAKWOL AUTH가 요청을 거부했습니다.');
  }
  const app = payload?.data;
  if (payload?.ok !== true || app?.client_id !== clientId || !['active','disabled'].includes(app?.status)) {
    return jsonError(502, 'INVALID_AUTH_RESPONSE', 'NAKWOL AUTH 앱 응답이 올바르지 않습니다.');
  }
  return { client_id: app.client_id, status: app.status };
}
function shape(clientId: string, state: { registered:boolean; status:'active'|'disabled'|null; scopes:string[] }) {
  return { ok:true, data:{ client_id:clientId, registered:state.registered, status:state.status, scopes:[...state.scopes].sort(), available_scopes:[...DATA_SCOPES] } };
}
export async function handleConnectCliGetScopes(clientId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  const managed = await verifyManagedAuthApp(request, env, clientId, fetcher);
  if (managed instanceof Response) return managed;
  return Response.json(shape(clientId, await getDataApplicationState(env, clientId)));
}
export async function handleConnectCliPutScopes(clientId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  const managed = await verifyManagedAuthApp(request, env, clientId, fetcher);
  if (managed instanceof Response) return managed;
  let body:any;
  try { body = await request.json(); } catch { return jsonError(400, 'INVALID_JSON', 'JSON body가 필요합니다.'); }
  if (!Array.isArray(body?.scopes)) return jsonError(400, 'INVALID_SCOPES', 'scopes 배열이 필요합니다.');
  const raw = body.scopes.map((value:unknown)=>String(value).trim()).filter(Boolean);
  if (raw.some((scope:string)=>!isDataScope(scope))) return jsonError(400, 'INVALID_SCOPES', '지원하지 않는 DATA scope가 포함되어 있습니다.');
  const scopes = [...new Set(raw as DataScope[])].sort();
  const state = await replaceDataApplicationScopes(env, clientId, managed.status, scopes);
  return Response.json(shape(clientId, state));
}
