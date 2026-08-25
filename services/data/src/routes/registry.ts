import { runAuthedHandler } from '../http.ts';
import { listRegistry } from '../store.ts';
import type { DataEnv } from '../types.ts';
type Fetcher=(input:RequestInfo|URL,init?:RequestInit)=>Promise<Response>;
export type RegistryRouteKind='generals'|'tactics'|'equipment';
const scopes={generals:'roster:read',tactics:'roster:read',equipment:'equipment:read'} as const;
export async function handleRegistryList(kind:RegistryRouteKind,request:Request,env:DataEnv,fetcher:Fetcher=fetch):Promise<Response>{ return runAuthedHandler(request,env,scopes[kind],async()=>Response.json({ok:true,data:await listRegistry(env,kind)}),fetcher); }
