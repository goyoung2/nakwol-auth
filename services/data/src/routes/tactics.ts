import { normalizeOwnedTacticInput } from '../domain.ts';
import { DataAccessError, runAuthedHandler } from '../http.ts';
import { deleteOwnedTactic, listOwnedTactics, upsertOwnedTactic } from '../store.ts';
import type { DataEnv } from '../types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function decodeId(value:string):string {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function handleListOwnedTactics(accountId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'roster:read', async (principal) => {
    const rows = await listOwnedTactics(env, principal.userId, accountId);
    if (rows === null) throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND', 404, '게임 계정을 찾을 수 없습니다.');
    return Response.json({ ok:true, data:rows });
  }, fetcher);
}

export async function handlePutOwnedTactic(accountId:string, rawTacticId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'roster:write', async (principal) => {
    let raw:any;
    try { raw = await request.json(); }
    catch { return Response.json({ ok:false, error:{ code:'INVALID_JSON', message:'JSON body가 필요합니다.' } }, { status:400 }); }
    let input;
    try { input = normalizeOwnedTacticInput(raw ?? {}); }
    catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_OWNED_TACTIC';
      return Response.json({ ok:false, error:{ code, message:'전법 보유 정보를 확인해 주세요.' } }, { status:400 });
    }
    const tacticId = decodeId(rawTacticId);
    const result = await upsertOwnedTactic(env, principal.userId, accountId, tacticId, input);
    if (result.kind === 'account_not_found') throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND', 404, '게임 계정을 찾을 수 없습니다.');
    if (result.kind === 'tactic_not_found') throw new DataAccessError('TACTIC_NOT_FOUND', 404, '등록 가능한 전법을 찾을 수 없습니다.');
    return Response.json({ ok:true, data:result.data });
  }, fetcher);
}

export async function handleDeleteOwnedTactic(accountId:string, rawTacticId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'roster:write', async (principal) => {
    const tacticId = decodeId(rawTacticId);
    const result = await deleteOwnedTactic(env, principal.userId, accountId, tacticId);
    if (result.kind === 'account_not_found') throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND', 404, '게임 계정을 찾을 수 없습니다.');
    return Response.json({ ok:true, data:result.data });
  }, fetcher);
}
