const identifier = /^[a-zA-Z0-9_-]{1,128}$/;

// Discovery is deliberately local, opt-in and scoped to the registered project.
// Provider inventory is not proof that an origin blocks anonymous requests.
export async function discoverProtectionOrigins(config, options = {}) {
  const provider = config?.protection?.provider || 'unknown';
  const evidence = { provider, status: 'disabled', origins: [], deploymentCount: 0 };
  const result = () => ({ origins: evidence.origins.map(item => item.origin), discoveryEvidence: evidence });
  if (options.discoverOrigins !== true) return result();
  if (provider !== 'cloudflare-pages') {
    evidence.status = 'unsupported';
    evidence.detail = 'Automatic origin inventory is supported only for registered Cloudflare Pages projects. Supply other origins explicitly.';
    return result();
  }
  const registration = config.protection.rollback;
  if (registration?.provider !== provider || !identifier.test(registration.accountId || '') || !identifier.test(registration.projectName || '')) {
    throw new Error('Origin discovery requires registered protection.rollback provider, accountId and projectName.');
  }
  const token = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required for origin discovery.');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const base = `https://api.cloudflare.com/client/v4/accounts/${registration.accountId}/pages/projects/${registration.projectName}`;
  const found = new Map();
  let invalid = false;
  function add(value, source) {
    if (value === undefined || value === null) return;
    try {
      if (typeof value !== 'string') throw new Error();
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash) throw new Error();
      found.set(url.origin + '/', { origin: url.origin + '/', status: 'unknown', source });
    } catch { invalid = true; }
  }
  async function api(suffix) {
    const response = await fetchImpl(base + suffix, { method: 'GET', redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (data.success !== true || data.result === undefined) throw new Error();
    return data;
  }
  try {
    const { result: project } = await api('');
    if (project.name !== registration.projectName) throw new Error();
    add(project.subdomain, 'project');
    if (Array.isArray(project.domains)) for (const domain of project.domains) add(domain, 'custom-domain');
    let exhausted = false;
    for (let page = 1; page <= 10; page++) {
      const data = await api(`/deployments?page=${page}&per_page=10`);
      if (!Array.isArray(data.result) || data.result.length > 10) throw new Error();
      for (const deployment of data.result) {
        evidence.deploymentCount++;
        add(deployment.url, 'deployment');
        if (Array.isArray(deployment.aliases)) for (const alias of deployment.aliases) add(alias, 'deployment-alias');
      }
      // A short page is independent of optional provider pagination metadata.
      if (data.result.length < 10) { exhausted = true; break; }
    }
    evidence.status = exhausted && !invalid ? 'complete' : 'partial';
    evidence.detail = 'Provider inventory only; every discovered origin still needs protection verification. Deleted or unreachable origins are not inferred closed.';
  } catch {
    evidence.status = found.size ? 'partial' : 'unreachable';
    evidence.detail = 'Scoped provider inventory could not be completed; no origin is inferred closed.';
  }
  evidence.origins = [...found.values()].sort((a, b) => a.origin.localeCompare(b.origin));
  return result();
}
