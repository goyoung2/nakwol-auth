import { readProjectConfig } from './config.mjs';
import { ConnectDataApi } from './data-api.mjs';
import { DEFAULT_DATA_ORIGIN, parseDataScopes } from './scopes.mjs';

export function validateDataOpenApi(document, configuredScopes = []) {
  const version = typeof document?.openapi === 'string' ? document.openapi : '';
  if (!version.startsWith('3.1.')) return { ok:false, detail:`DATA OpenAPI 3.1이 필요합니다. received=${version || 'missing'}` };
  const declared = Array.isArray(document?.['x-nakwol-data-scopes'])
    ? document['x-nakwol-data-scopes'].map((value) => String(value))
    : [];
  const missing = parseDataScopes(configuredScopes).filter((scope) => !declared.includes(scope));
  if (missing.length) return { ok:false, detail:`OpenAPI에 선언되지 않은 DATA scope: ${missing.join(', ')}` };
  return { ok:true, detail:`OpenAPI ${version}; ${declared.length} DATA scopes` };
}

export async function dataDescribeProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const dataOrigin = String(options.dataOrigin || config?.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/, '');
  const api = new ConnectDataApi({ dataOrigin, fetchImpl: options.fetchImpl || globalThis.fetch });
  const document = await api.describe();
  return { ok:true, dataOrigin, openapiUrl:`${dataOrigin}/openapi.json`, document };
}
