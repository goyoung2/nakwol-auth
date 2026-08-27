import { normalizeCreateEquipmentInput, normalizePatchEquipmentInput } from '../domain.ts';
import { DataAccessError, runAuthedHandler } from '../http.ts';
import { createEquipment, deleteEquipment, listEquipment, patchEquipment } from '../store.ts';
import type { DataEnv } from '../types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function parseJson(request:Request):Promise<Record<string,unknown>|Response> {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON');
    return value as Record<string,unknown>;
  } catch {
    return Response.json({ ok:false, error:{ code:'INVALID_JSON', message:'JSON object body가 필요합니다.' } }, { status:400 });
  }
}

function validationResponse(error:unknown):Response {
  const code = error instanceof Error ? error.message : 'INVALID_EQUIPMENT';
  const messages:Record<string,string> = {
    EQUIPMENT_OPTIONS_UNSUPPORTED:'장비 옵션 수치와 특기는 현재 확정 Registry가 없어 아직 저장할 수 없습니다.',
    EQUIPMENT_TEMPLATE_IMMUTABLE:'생성된 장비의 템플릿은 변경할 수 없습니다.',
    INVALID_EQUIPMENT_TEMPLATE:'장비 템플릿을 확인해 주세요.',
    INVALID_NICKNAME:'장비 별칭을 확인해 주세요.',
    INVALID_LOCKED:'잠금 값은 boolean이어야 합니다.',
    INVALID_FAVORITE:'즐겨찾기 값은 boolean이어야 합니다.',
    EMPTY_EQUIPMENT_PATCH:'변경할 장비 필드가 없습니다.',
  };
  return Response.json({ ok:false, error:{ code, message:messages[code] ?? '장비 정보를 확인해 주세요.' } }, { status:400 });
}

export async function handleListEquipment(accountId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'equipment:read', async (principal) => {
    const rows = await listEquipment(env, principal.userId, accountId);
    if (rows === null) throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND', 404, '게임 계정을 찾을 수 없습니다.');
    return Response.json({ ok:true, data:rows });
  }, fetcher);
}

export async function handleCreateEquipment(accountId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'equipment:write', async (principal) => {
    const raw = await parseJson(request);
    if (raw instanceof Response) return raw;
    let input;
    try { input = normalizeCreateEquipmentInput(raw); }
    catch (error) { return validationResponse(error); }
    const result = await createEquipment(env, principal.userId, accountId, input);
    if (result.kind === 'account_not_found') throw new DataAccessError('GAME_ACCOUNT_NOT_FOUND', 404, '게임 계정을 찾을 수 없습니다.');
    if (result.kind === 'template_not_found') throw new DataAccessError('EQUIPMENT_TEMPLATE_NOT_FOUND', 404, '등록 가능한 장비 템플릿을 찾을 수 없습니다.');
    return Response.json({ ok:true, data:result.data }, { status:201 });
  }, fetcher);
}

export async function handlePatchEquipment(accountId:string, equipmentId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'equipment:write', async (principal) => {
    const raw = await parseJson(request);
    if (raw instanceof Response) return raw;
    let input;
    try { input = normalizePatchEquipmentInput(raw); }
    catch (error) { return validationResponse(error); }
    const result = await patchEquipment(env, principal.userId, accountId, equipmentId, input);
    if (result.kind === 'equipment_not_found') throw new DataAccessError('EQUIPMENT_NOT_FOUND', 404, '장비 인스턴스를 찾을 수 없습니다.');
    return Response.json({ ok:true, data:result.data });
  }, fetcher);
}

export async function handleDeleteEquipment(accountId:string, equipmentId:string, request:Request, env:DataEnv, fetcher:Fetcher=fetch):Promise<Response> {
  return runAuthedHandler(request, env, 'equipment:write', async (principal) => {
    const result = await deleteEquipment(env, principal.userId, accountId, equipmentId);
    if (result.kind === 'equipment_not_found') throw new DataAccessError('EQUIPMENT_NOT_FOUND', 404, '장비 인스턴스를 찾을 수 없습니다.');
    return Response.json({ ok:true, data:result.data });
  }, fetcher);
}
