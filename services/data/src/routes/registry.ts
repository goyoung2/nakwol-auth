import { runAuthedHandler } from '../http.ts';
import { listEquipmentTraitsRegistry } from '../equipment-traits-store.ts';
import { getRegistrySummary, listRegistry, type RegistryKind } from '../store.ts';
import type { DataEnv, DataScope } from '../types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RegistryRouteKind = RegistryKind | 'equipment_traits';

const scopes: Record<RegistryRouteKind, DataScope> = {
  generals:'roster:read',
  tactics:'roster:read',
  equipment:'equipment:read',
  equipment_traits:'equipment:read',
  stats:'equipment:read',
  formations:'decks:read',
  warbooks:'decks:read',
};

export async function handleRegistryList(kind: RegistryRouteKind, request: Request, env: DataEnv, fetcher: Fetcher = fetch): Promise<Response> {
  const includeHidden = kind === 'generals' && new URL(request.url).searchParams.get('include_hidden') === '1';
  return runAuthedHandler(request, env, scopes[kind], async () => {
    const data = kind === 'equipment_traits'
      ? await listEquipmentTraitsRegistry(env)
      : await listRegistry(env, kind, { includeHidden });
    return Response.json({ ok:true, data });
  }, fetcher);
}

export async function handleRegistrySummary(request: Request, env: DataEnv, fetcher: Fetcher = fetch): Promise<Response> {
  return runAuthedHandler(request, env, null, async () => Response.json({ ok:true, data:await getRegistrySummary(env) }), fetcher);
}
