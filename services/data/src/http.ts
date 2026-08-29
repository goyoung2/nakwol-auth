import { DATA_SCHEMA_VERSION, DATA_SCOPES, DATA_SERVICE_VERSION, type DataScope } from './domain.ts';
import { DataAuthError, verifyPrincipal } from './auth.ts';
import { hasDataScope, upsertDataUser } from './store.ts';
import type { DataEnv, DataPrincipal } from './types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export class DataAccessError extends Error {
  code:string; status:number;
  constructor(code:string,status:number,message:string){ super(message); this.name='DataAccessError'; this.code=code; this.status=status; }
}
export function publicHealthResponse():Response { return Response.json({ ok:true, service:'nakwol-data', version:DATA_SERVICE_VERSION, schema_version:DATA_SCHEMA_VERSION }); }
export function publicSchemaResponse():Response { return Response.json({ ok:true, service:'nakwol-data', version:DATA_SERVICE_VERSION, schema_version:DATA_SCHEMA_VERSION, scopes:DATA_SCOPES, openapi_path:'/openapi.json', openapi_version:'3.1.0' }); }
export function preflightResponse(request:Request):Response {
  const origin=request.headers.get('Origin')??'*';
  return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,PATCH,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,X-NAKWOL-CLIENT-ID','Access-Control-Max-Age':'600',Vary:'Origin'}});
}
function applyCors(request:Request,response:Response){ const origin=request.headers.get('Origin'); if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');} return response; }
function errorResponse(request:Request,status:number,code:string,message:string){ return applyCors(request,Response.json({ok:false,error:{code,message}},{status})); }
export async function runAuthedHandler(request:Request,env:DataEnv,scope:DataScope|null,operation:(principal:DataPrincipal)=>Promise<Response>,fetcher:Fetcher=fetch):Promise<Response>{
  try { const principal=await verifyPrincipal(request,env,fetcher); await upsertDataUser(env,principal); if(scope&&!await hasDataScope(env,principal.clientId,scope)) throw new DataAccessError('SCOPE_DENIED',403,`DATA scope ${scope} 권한이 없습니다.`); return applyCors(request,await operation(principal)); }
  catch(error){ if(error instanceof DataAuthError||error instanceof DataAccessError) return errorResponse(request,error.status,error.code,error.message); console.error(error); return errorResponse(request,500,'INTERNAL_ERROR','NAKWOL DATA 내부 오류가 발생했습니다.'); }
}
export async function handleMe(request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response>{ return runAuthedHandler(request,env,null,async(principal)=>Response.json({ok:true,data:{id:principal.userId,client_id:principal.clientId,display_name:principal.displayName,avatar_url:principal.avatarUrl,membership_role:principal.membershipRole}}),fetcher); }
