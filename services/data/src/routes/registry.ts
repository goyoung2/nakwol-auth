import { runAuthedHandler } from '../http.ts';
import { getRegistrySummary, listRegistry, type RegistryKind } from '../store.ts';
import type { DataEnv, DataScope } from '../types.ts';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type RegistryRouteKind = RegistryKind;

const scopes: Record<RegistryRouteKind, DataScope> = {
  generals:'roster:read',
  tactics:'roster:read',
  equipment:'equipment:read',
  stats:'equipment:read',
  formations:'decks:read',
  warbooks:'decks:read',
};

export async function handleRegistryList(kind: RegistryRouteKind, request: Request, env: DataEnv, fetcher: Fetcher = fetch): Promise<Response> {
  const includeHidden = kind === 'generals' && new URL(request.url).searchParams.get('include_hidden') === '1';
  return runAuthedHandler(request, env, scopes[kind], async () => Response.json({ ok:true, data:await listRegistry(env, kind, { includeHidden }) }), fetcher);
}

export async function handleRegistrySummary(request: Request, env: DataEnv, fetcher: Fetcher = fetch): Promise<Response> {
  return runAuthedHandler(request, env, null, async () => Response.json({ ok:true, data:await getRegistrySummary(env) }), fetcher);
}
