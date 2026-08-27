export const DATA_SERVICE_VERSION = '0.6.0' as const;
export const DATA_SCHEMA_VERSION = 2 as const;

export const DATA_SCOPES = [
  'profile:read','profile:write','roster:read','roster:write',
  'equipment:read','equipment:write','decks:read','decks:write',
] as const;
export type DataScope = (typeof DATA_SCOPES)[number];
export type DataIdPrefix = 'gac' | 'eqp' | 'dek' | 'dks';
export function isDataScope(value: string): value is DataScope { return (DATA_SCOPES as readonly string[]).includes(value); }
export function normalizeGameAccountInput(input:{nickname?:unknown;server_code?:unknown;is_primary?:unknown;}):{nickname:string;serverCode:string;isPrimary:boolean}{
  const nickname=typeof input.nickname==='string'?input.nickname.trim():'';
  const serverCode=typeof input.server_code==='string'?input.server_code.trim():'';
  if(!nickname) throw new Error('INVALID_NICKNAME');
  if(!serverCode) throw new Error('INVALID_SERVER_CODE');
  return {nickname,serverCode,isPrimary:input.is_primary===true};
}
export interface OwnedGeneralInput { breakthrough:number; promotion:number; favorite:boolean; note:string|null; }
export function normalizeOwnedGeneralInput(input:{breakthrough?:unknown;promotion?:unknown;favorite?:unknown;note?:unknown;}):OwnedGeneralInput{
  const breakthrough=input.breakthrough??0;
  const promotion=input.promotion??0;
  if(!Number.isInteger(breakthrough)||Number(breakthrough)<0||Number(breakthrough)>5) throw new Error('INVALID_BREAKTHROUGH');
  if(!Number.isInteger(promotion)||Number(promotion)<0) throw new Error('INVALID_PROMOTION');
  if(input.favorite!==undefined&&typeof input.favorite!=='boolean') throw new Error('INVALID_FAVORITE');
  if(input.note!==undefined&&input.note!==null&&typeof input.note!=='string') throw new Error('INVALID_NOTE');
  const note=typeof input.note==='string'?(input.note.trim()||null):null;
  return {breakthrough:Number(breakthrough),promotion:Number(promotion),favorite:input.favorite===true,note};
}
export interface OwnedTacticInput { breakthrough:number; favorite:boolean; note:string|null; }
export function normalizeOwnedTacticInput(input:{breakthrough?:unknown;favorite?:unknown;note?:unknown;}):OwnedTacticInput{
  const breakthrough=input.breakthrough??0;
  if(!Number.isInteger(breakthrough)||Number(breakthrough)<0||Number(breakthrough)>5) throw new Error('INVALID_BREAKTHROUGH');
  if(input.favorite!==undefined&&typeof input.favorite!=='boolean') throw new Error('INVALID_FAVORITE');
  if(input.note!==undefined&&input.note!==null&&typeof input.note!=='string') throw new Error('INVALID_NOTE');
  const note=typeof input.note==='string'?(input.note.trim()||null):null;
  return {breakthrough:Number(breakthrough),favorite:input.favorite===true,note};
}
export function isCanonicalOwnableTacticMetadata(metadata:Record<string,unknown>):boolean{
  return metadata.class===5
    && metadata.learn===1
    && metadata.get===3
    && (metadata.copy??0)===0
    && Number(metadata.chip??0)>0;
}

function normalizeOptionalNickname(value:unknown):string|null {
  if(value===undefined||value===null) return null;
  if(typeof value!=='string') throw new Error('INVALID_NICKNAME');
  return value.trim()||null;
}
function assertEquipmentOptionsUnsupported(input:Record<string,unknown>):void {
  if(Object.prototype.hasOwnProperty.call(input,'stats')||Object.prototype.hasOwnProperty.call(input,'traits')) throw new Error('EQUIPMENT_OPTIONS_UNSUPPORTED');
}
export interface CreateEquipmentInput { templateId:string; nickname:string|null; locked:boolean; favorite:boolean; }
export function normalizeCreateEquipmentInput(input:Record<string,unknown>):CreateEquipmentInput {
  assertEquipmentOptionsUnsupported(input);
  const templateId=typeof input.template_id==='string'?input.template_id.trim():'';
  if(!templateId) throw new Error('INVALID_EQUIPMENT_TEMPLATE');
  if(input.locked!==undefined&&typeof input.locked!=='boolean') throw new Error('INVALID_LOCKED');
  if(input.favorite!==undefined&&typeof input.favorite!=='boolean') throw new Error('INVALID_FAVORITE');
  return {templateId,nickname:normalizeOptionalNickname(input.nickname),locked:input.locked===true,favorite:input.favorite===true};
}
export interface PatchEquipmentInput {
  hasNickname:boolean; nickname:string|null;
  hasLocked:boolean; locked:boolean;
  hasFavorite:boolean; favorite:boolean;
}
export function normalizePatchEquipmentInput(input:Record<string,unknown>):PatchEquipmentInput {
  assertEquipmentOptionsUnsupported(input);
  if(Object.prototype.hasOwnProperty.call(input,'template_id')) throw new Error('EQUIPMENT_TEMPLATE_IMMUTABLE');
  const hasNickname=Object.prototype.hasOwnProperty.call(input,'nickname');
  const hasLocked=Object.prototype.hasOwnProperty.call(input,'locked');
  const hasFavorite=Object.prototype.hasOwnProperty.call(input,'favorite');
  if(!hasNickname&&!hasLocked&&!hasFavorite) throw new Error('EMPTY_EQUIPMENT_PATCH');
  if(hasLocked&&typeof input.locked!=='boolean') throw new Error('INVALID_LOCKED');
  if(hasFavorite&&typeof input.favorite!=='boolean') throw new Error('INVALID_FAVORITE');
  return {
    hasNickname,nickname:hasNickname?normalizeOptionalNickname(input.nickname):null,
    hasLocked,locked:input.locked===true,
    hasFavorite,favorite:input.favorite===true,
  };
}
export function newDataId(prefix:DataIdPrefix):string{const bytes=new Uint8Array(12);crypto.getRandomValues(bytes);const body=Array.from(bytes,(v)=>v.toString(16).padStart(2,'0')).join('');return `${prefix}_${body}`;}
