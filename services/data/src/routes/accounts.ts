import { newDataId, normalizeGameAccountInput } from '../domain.ts';
import { runAuthedHandler } from '../http.ts';
import { createGameAccount, listGameAccounts } from '../store.ts';
import type { DataEnv } from '../types.ts';
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export async function handleListGameAccounts(request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response>{ return runAuthedHandler(request,env,'profile:read',async(principal)=>Response.json({ok:true,data:await listGameAccounts(env,principal.userId)}),fetcher); }
export async function handleCreateGameAccount(request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response>{
  return runAuthedHandler(request,env,'profile:write',async(principal)=>{ let raw:any; try{raw=await request.json();}catch{return Response.json({ok:false,error:{code:'INVALID_JSON',message:'JSON body가 필요합니다.'}},{status:400});} try{ const input=normalizeGameAccountInput(raw??{}); const account=await createGameAccount(env,principal.userId,{id:newDataId('gac'),...input}); return Response.json({ok:true,data:account},{status:201}); }catch(error){ const code=error instanceof Error?error.message:'INVALID_GAME_ACCOUNT'; return Response.json({ok:false,error:{code,message:'게임 계정 정보를 확인해 주세요.'}},{status:400}); } },fetcher);
}
