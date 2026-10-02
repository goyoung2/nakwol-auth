export type PresentationState = 'login'|'checking'|'denied'|'unavailable';
export interface PresentationScreen {readonly serviceName:string;readonly title:string;readonly copy:string;readonly logoAssetId:string|null;readonly backgroundAssetId:string|null;readonly layout:'center'|'left'}
export interface Presentation {readonly schemaVersion:1;readonly version:number;readonly widget:{readonly visibility:'visible'|'hidden';readonly variant:'button'|'compact'|'menu';readonly placement:'inline'|'fixed'|'sticky';readonly position:'top-left'|'top-right'|'bottom-left'|'bottom-right';readonly margin:number;readonly showName:boolean};readonly theme:{readonly mode:'light'|'dark'|'system';readonly background:string;readonly surface:string;readonly text:string;readonly muted:string;readonly accent:string;readonly radius:8|12|16|24;readonly size:'sm'|'md'|'lg'};readonly screens:Readonly<Record<PresentationState,PresentationScreen>>;readonly support:{readonly url:string|null;readonly label:string}}
export const PRESENTATION_SCHEMA_VERSION:1;
export const PRESENTATION_STATES:readonly PresentationState[];
export function defaultPresentation():Presentation;
export function parsePresentation(value:unknown):Presentation;
