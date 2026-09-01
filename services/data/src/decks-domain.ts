export type DeckStatus = 'active'|'candidate'|'research'|'archived';
export type DeckVisibility = 'private'|'alliance'|'public';

const DECK_STATUSES = new Set<DeckStatus>(['active','candidate','research','archived']);
const DECK_VISIBILITIES = new Set<DeckVisibility>(['private','alliance','public']);

export interface CreateDeckInput {
  name:string;
  seasonId:string|null;
  status:DeckStatus;
  visibility:DeckVisibility;
  note:string|null;
  isPrimary:boolean;
}

export interface PatchDeckInput {
  hasName:boolean; name:string;
  hasSeasonId:boolean; seasonId:string|null;
  hasStatus:boolean; status:DeckStatus;
  hasVisibility:boolean; visibility:DeckVisibility;
  hasNote:boolean; note:string|null;
  hasIsPrimary:boolean; isPrimary:boolean;
}

export interface CompositionTacticInput { slot:number; tacticId:string; }
export interface CompositionGeneralInput {
  position:number;
  generalId:string;
  weaponInstanceId:string|null;
  mountInstanceId:string|null;
  tactics:CompositionTacticInput[];
}
export interface ReplaceCompositionInput { generals:CompositionGeneralInput[]; }
export interface CreateSnapshotInput { visibility:'alliance'|'public'; }

function has(input:Record<string,unknown>,key:string):boolean { return Object.prototype.hasOwnProperty.call(input,key); }
function normalizeRequiredString(value:unknown,code:string):string {
  if(typeof value!=='string') throw new Error(code);
  const normalized=value.trim();
  if(!normalized) throw new Error(code);
  return normalized;
}
function normalizeNullableString(value:unknown,code:string):string|null {
  if(value===undefined||value===null) return null;
  if(typeof value!=='string') throw new Error(code);
  return value.trim()||null;
}
function normalizeStatus(value:unknown,defaultValue:DeckStatus):DeckStatus {
  if(value===undefined) return defaultValue;
  if(typeof value!=='string'||!DECK_STATUSES.has(value as DeckStatus)) throw new Error('INVALID_DECK_STATUS');
  return value as DeckStatus;
}
function normalizeVisibility(value:unknown,defaultValue:DeckVisibility):DeckVisibility {
  if(value===undefined) return defaultValue;
  if(typeof value!=='string'||!DECK_VISIBILITIES.has(value as DeckVisibility)) throw new Error('INVALID_DECK_VISIBILITY');
  return value as DeckVisibility;
}
function normalizeBoolean(value:unknown,defaultValue:boolean,code:string):boolean {
  if(value===undefined) return defaultValue;
  if(typeof value!=='boolean') throw new Error(code);
  return value;
}
function asRecord(value:unknown):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new Error('INVALID_COMPOSITION');
  return value as Record<string,unknown>;
}

export function normalizeCreateDeckInput(input:Record<string,unknown>):CreateDeckInput {
  return {
    name:normalizeRequiredString(input.name,'INVALID_DECK_NAME'),
    seasonId:normalizeNullableString(input.season_id,'INVALID_SEASON'),
    status:normalizeStatus(input.status,'active'),
    visibility:normalizeVisibility(input.visibility,'private'),
    note:normalizeNullableString(input.note,'INVALID_NOTE'),
    isPrimary:normalizeBoolean(input.is_primary,false,'INVALID_IS_PRIMARY'),
  };
}

export function normalizePatchDeckInput(input:Record<string,unknown>):PatchDeckInput {
  const hasName=has(input,'name');
  const hasSeasonId=has(input,'season_id');
  const hasStatus=has(input,'status');
  const hasVisibility=has(input,'visibility');
  const hasNote=has(input,'note');
  const hasIsPrimary=has(input,'is_primary');
  if(!hasName&&!hasSeasonId&&!hasStatus&&!hasVisibility&&!hasNote&&!hasIsPrimary) throw new Error('EMPTY_DECK_PATCH');
  return {
    hasName,name:hasName?normalizeRequiredString(input.name,'INVALID_DECK_NAME'):'',
    hasSeasonId,seasonId:hasSeasonId?normalizeNullableString(input.season_id,'INVALID_SEASON'):null,
    hasStatus,status:hasStatus?normalizeStatus(input.status,'active'):'active',
    hasVisibility,visibility:hasVisibility?normalizeVisibility(input.visibility,'private'):'private',
    hasNote,note:hasNote?normalizeNullableString(input.note,'INVALID_NOTE'):null,
    hasIsPrimary,isPrimary:hasIsPrimary?normalizeBoolean(input.is_primary,false,'INVALID_IS_PRIMARY'):false,
  };
}

export function normalizeReplaceCompositionInput(input:Record<string,unknown>):ReplaceCompositionInput {
  if(!Array.isArray(input.generals)) throw new Error('INVALID_COMPOSITION');
  const positions=new Set<number>();
  const generalIds=new Set<string>();
  const equipmentIds=new Set<string>();
  const generals:CompositionGeneralInput[]=[];
  for(const rawGeneral of input.generals){
    const general=asRecord(rawGeneral);
    const position=general.position;
    if(!Number.isInteger(position)||Number(position)<1||Number(position)>3) throw new Error('INVALID_GENERAL_POSITION');
    const pos=Number(position);
    if(positions.has(pos)) throw new Error('DUPLICATE_GENERAL_POSITION');
    positions.add(pos);

    const generalId=normalizeRequiredString(general.general_id,'INVALID_COMPOSITION');
    if(generalIds.has(generalId)) throw new Error('DUPLICATE_GENERAL_IN_DECK');
    generalIds.add(generalId);

    const weaponInstanceId=normalizeNullableString(general.weapon_instance_id,'INVALID_COMPOSITION');
    const mountInstanceId=normalizeNullableString(general.mount_instance_id,'INVALID_COMPOSITION');
    for(const equipmentId of [weaponInstanceId,mountInstanceId]){
      if(!equipmentId) continue;
      if(equipmentIds.has(equipmentId)) throw new Error('DUPLICATE_EQUIPMENT_IN_DECK');
      equipmentIds.add(equipmentId);
    }

    const rawTactics=general.tactics===undefined?[]:general.tactics;
    if(!Array.isArray(rawTactics)) throw new Error('INVALID_COMPOSITION');
    const tacticSlots=new Set<number>();
    const tactics:CompositionTacticInput[]=[];
    for(const rawTactic of rawTactics){
      const tactic=asRecord(rawTactic);
      if(!Number.isInteger(tactic.slot)||Number(tactic.slot)<1||Number(tactic.slot)>2) throw new Error('INVALID_TACTIC_SLOT');
      const slot=Number(tactic.slot);
      if(tacticSlots.has(slot)) throw new Error('DUPLICATE_TACTIC_SLOT');
      tacticSlots.add(slot);
      tactics.push({slot,tacticId:normalizeRequiredString(tactic.tactic_id,'INVALID_COMPOSITION')});
    }
    tactics.sort((a,b)=>a.slot-b.slot);
    generals.push({position:pos,generalId,weaponInstanceId,mountInstanceId,tactics});
  }
  generals.sort((a,b)=>a.position-b.position);
  return {generals};
}

export function normalizeCreateSnapshotInput(input:Record<string,unknown>):CreateSnapshotInput {
  const value=input.visibility===undefined?'alliance':input.visibility;
  if(value!=='alliance'&&value!=='public') throw new Error('INVALID_SNAPSHOT_VISIBILITY');
  return {visibility:value};
}
