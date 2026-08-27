export type DeckStatus = 'active'|'candidate'|'research'|'archived';
export type DeckVisibility = 'private'|'alliance'|'public';

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

function red():never { throw new Error('NOT_IMPLEMENTED'); }
export function normalizeCreateDeckInput(_input:Record<string,unknown>):CreateDeckInput { return red(); }
export function normalizePatchDeckInput(_input:Record<string,unknown>):PatchDeckInput { return red(); }
export function normalizeReplaceCompositionInput(_input:Record<string,unknown>):ReplaceCompositionInput { return red(); }
export function normalizeCreateSnapshotInput(_input:Record<string,unknown>):CreateSnapshotInput { return red(); }
