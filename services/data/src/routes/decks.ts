import { normalizeCreateDeckInput, normalizePatchDeckInput, normalizeReplaceCompositionInput } from '../decks-domain.ts';
import { createDeck, deleteDeck, getDeck, listDecks, patchDeck, replaceDeckComposition } from '../decks-store.ts';
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
  const code=error instanceof Error?error.message:'INVALID_DECK';
  const messages:Record<string,string>={
    INVALID_DECK_NAME:'덱 이름을 확인해 주세요.',
    INVALID_DECK_STATUS:'덱 상태를 확인해 주세요.',
    INVALID_DECK_VISIBILITY:'덱 공개 범위를 확인해 주세요.',
    INVALID_SEASON:'시즌 정보를 확인해 주세요.',
    INVALID_NOTE:'덱 메모를 확인해 주세요.',
    INVALID_IS_PRIMARY:'대표 덱 값은 boolean이어야 합니다.',
    EMPTY_DECK_PATCH:'변경할 덱 필드가 없습니다.',
    INVALID_COMPOSITION:'덱 구성을 확인해 주세요.',
    INVALID_GENERAL_POSITION:'장수 위치는 1~3이어야 합니다.',
    DUPLICATE_GENERAL_POSITION:'같은 장수 위치를 두 번 지정할 수 없습니다.',
    DUPLICATE_GENERAL_IN_DECK:'같은 장수를 한 덱의 여러 위치에 배치할 수 없습니다.',
    INVALID_TACTIC_SLOT:'전법 슬롯은 1~2이어야 합니다.',
    DUPLICATE_TACTIC_SLOT:'같은 전법 슬롯을 두 번 지정할 수 없습니다.',
    DUPLICATE_EQUIPMENT_IN_DECK:'같은 장비 인스턴스를 한 덱에서 여러 번 사용할 수 없습니다.',
    EQUIPMENT_TYPE_MISMATCH:'장비 종류와 슬롯이 맞지 않습니다.',
  };
  return Response.json({ok:false,error:{code,message:messages[code]??'덱 정보를 확인해 주세요.'}},{status:400});
}

export async function handleListDecks(accountId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:read',async(principal)=>{
    const rows=await listDecks(env,principal.userId,accountId);
    if(rows===null) throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND',404,'게임 계정을 찾을 수 없습니다.');
    return Response.json({ok:true,data:rows});
  },fetcher);
}

export async function handleCreateDeck(accountId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:write',async(principal)=>{
    const raw=await parseJson(request); if(raw instanceof Response) return raw;
    let input; try { input=normalizeCreateDeckInput(raw); } catch(error){ return validationResponse(error); }
    const result=await createDeck(env,principal.userId,accountId,input);
    if(result.kind==='account_not_found') throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND',404,'게임 계정을 찾을 수 없습니다.');
    if(result.kind==='season_not_found') return validationResponse(new Error('INVALID_SEASON'));
    return Response.json({ok:true,data:result.data},{status:201});
  },fetcher);
}

export async function handleGetDeck(accountId:string,deckId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:read',async(principal)=>{
    const result=await getDeck(env,principal.userId,accountId,deckId);
    if(result.kind==='deck_not_found') throw new DataAccessError('DECK_NOT_FOUND',404,'덱을 찾을 수 없습니다.');
    return Response.json({ok:true,data:result.data});
  },fetcher);
}

export async function handlePatchDeck(accountId:string,deckId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:write',async(principal)=>{
    const raw=await parseJson(request); if(raw instanceof Response) return raw;
    let input; try { input=normalizePatchDeckInput(raw); } catch(error){ return validationResponse(error); }
    const result=await patchDeck(env,principal.userId,accountId,deckId,input);
    if(result.kind==='deck_not_found') throw new DataAccessError('DECK_NOT_FOUND',404,'덱을 찾을 수 없습니다.');
    if(result.kind==='season_not_found') return validationResponse(new Error('INVALID_SEASON'));
    return Response.json({ok:true,data:result.data});
  },fetcher);
}

export async function handleDeleteDeck(accountId:string,deckId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:write',async(principal)=>{
    const result=await deleteDeck(env,principal.userId,accountId,deckId);
    if(result.kind==='deck_not_found') throw new DataAccessError('DECK_NOT_FOUND',404,'덱을 찾을 수 없습니다.');
    return Response.json({ok:true,data:result.data});
  },fetcher);
}

export async function handlePutDeckComposition(accountId:string,deckId:string,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request,env,'decks:write',async(principal)=>{
    const raw=await parseJson(request); if(raw instanceof Response) return raw;
    let input; try { input=normalizeReplaceCompositionInput(raw); } catch(error){ return validationResponse(error); }
    const result=await replaceDeckComposition(env,principal.userId,accountId,deckId,input);
    if(result.kind==='deck_not_found') throw new DataAccessError('DECK_NOT_FOUND',404,'덱을 찾을 수 없습니다.');
    if(result.kind==='general_not_found') throw new DataAccessError('GENERAL_NOT_FOUND',404,'사용 가능한 장수를 찾을 수 없습니다.');
    if(result.kind==='tactic_not_found') throw new DataAccessError('TACTIC_NOT_FOUND',404,'장착 가능한 전법을 찾을 수 없습니다.');
    if(result.kind==='equipment_not_found') throw new DataAccessError('EQUIPMENT_NOT_FOUND',404,'해당 게임 계정의 장비를 찾을 수 없습니다.');
    if(result.kind==='equipment_type_mismatch') return validationResponse(new Error('EQUIPMENT_TYPE_MISMATCH'));
    return Response.json({ok:true,data:result.data});
  },fetcher);
}
