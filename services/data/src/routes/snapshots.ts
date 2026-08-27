import { normalizeCreateSnapshotInput } from '../decks-domain.ts';
import { createDeckSnapshot, getDeckSnapshot, listDeckSnapshots } from '../snapshots-store.ts';
import { DataAccessError, runAuthedHandler } from '../http.ts';
import type { DataEnv } from '../types.ts';

type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;

async function parseJson(request:Request):Promise<Record<string,unknown>|Response> {
  try {
    const value=await request.json();
    if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('INVALID_JSON');
    return value as Record<string,unknown>;
  } catch {
    return Response.json({ok:false,error:{code:'INVALID_JSON',message:'JSON object body가 필요합니다.'}},{status:400});
  }
}

function validationResponse(error:unknown):Response {
  const code=error instanceof Error?error.message:'INVALID_SNAPSHOT';
  const messages:Record<string,string>={
    INVALID_SNAPSHOT_VISIBILITY:'스냅샷 공개 범위를 확인해 주세요.',
  };
  return Response.json({ok:false,error:{code,message:messages[code]??'스냅샷 정보를 확인해 주세요.'}},{status:400});
}

export async function handleCreateDeckSnapshot(accountId:string,deckId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:write',async(principal)=>{
    const raw=await parseJson(request);
    if(raw instanceof Response) return raw;
    let input;
    try { input=normalizeCreateSnapshotInput(raw); }
    catch(error){ return validationResponse(error); }
    const result=await createDeckSnapshot(env,principal.userId,accountId,deckId,input);
    if(result.kind==='deck_not_found') throw new DataAccessError('DECK_NOT_FOUND',404,'덱을 찾을 수 없습니다.');
    return Response.json({ok:true,data:result.data},{status:201});
  },fetcher);
}

export async function handleListDeckSnapshots(request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:read',async(principal)=>Response.json({ok:true,data:await listDeckSnapshots(env,principal.userId)}),fetcher);
}

export async function handleGetDeckSnapshot(snapshotId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:read',async(principal)=>{
    const data=await getDeckSnapshot(env,principal.userId,snapshotId);
    if(!data) throw new DataAccessError('SNAPSHOT_NOT_FOUND',404,'스냅샷을 찾을 수 없습니다.');
    return Response.json({ok:true,data});
  },fetcher);
}
