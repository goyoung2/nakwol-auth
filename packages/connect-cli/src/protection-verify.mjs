import { readProtectionManifest, readProtectionOrigins, safeAssetPath, boundedBody, sha256 } from './protection-inventory.mjs';
import { discoverProtectionOrigins } from './protection-origins.mjs';
import { readProjectConfig } from './config.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { assetInventory, inspectProtection, siteUrl, generatedAssetPaths } from './protection.mjs';

function protectedPaths(files) {
  const paths = new Set(['/']);
  for (const file of files) {
    paths.add(file);
    if (file.endsWith('/index.html')) paths.add(file.slice(0, -10));
    else if (file.endsWith('.html')) paths.add(file.slice(0, -5));
  }
  return [...paths];
}
export async function verifyProtection(options = {}) {
  const root = options.root || process.cwd();
  const custom = options.provider === 'custom';
  const manifest = options.manifest ? await readProtectionManifest(options.manifest, options) : null;
  const cookieName = options.sessionCookieEnv;
  if (cookieName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(cookieName)) throw new Error('Invalid session cookie environment variable name.');
  const sessionCookie = cookieName ? process.env[cookieName] : null;
  if (cookieName && (!sessionCookie || Array.from(sessionCookie).some(c => c.charCodeAt(0) < 32))) throw new Error('Session cookie environment variable is missing or invalid.');
  let primary, inventory, config;
  let expectedRuntime = options.expectRuntime;
  const deployedVersions = new Set();
  if (expectedRuntime && expectedRuntime !== 'installed' && !/^[0-9]+[.][0-9]+[.][0-9]+$/.test(expectedRuntime)) throw new Error('--expect-runtime requires an exact version or installed.');
  if (custom && expectedRuntime === 'installed') throw new Error('Custom verification requires an explicit expected runtime version.');
  if (custom) {
    if (!options.url || (!options.paths && !manifest)) throw new Error('custom 검증에는 --url과 보호 대상 --paths가 필요합니다.');
    primary = siteUrl(options.url);
    inventory = { paths: [] };
  } else {
    config = await readProjectConfig(root);
    const installed = await inspectProtection(root, config);
    if (expectedRuntime === 'installed') {
      expectedRuntime = config?.protection?.runtimeVersion;
      if (!expectedRuntime) throw new Error('Installed runtime version is unknown.');
    }
    if (!installed.ok) return { ok: false, protectionStatus: 'unverified', checks: [{ name: 'server_gate', ok: false, detail: installed.detail }] };
    primary = siteUrl(options.url || config.protection.siteUrl);
    if (primary !== config.protection.siteUrl) throw new Error('--url이 설치 시 지정한 배포 주소와 다릅니다. protect install로 설정을 갱신하세요.');
    inventory = await assetInventory(root, config.protection.assetsDirectory, generatedAssetPaths(config.protection));
    if (manifest && (manifest.files.length !== inventory.paths.length || manifest.files.some(file => !inventory.paths.includes(file.path)))) throw new Error('Manifest does not cover the installed asset inventory.');
    if (manifest) {
      const directory = await realpath(resolve(root, config.protection.assetsDirectory));
      for (const file of manifest.files) {
        const target = await realpath(resolve(directory, decodeURIComponent(file.path.slice(1))));
        const local = relative(directory, target);
        if (local.startsWith('..') || isAbsolute(local)) throw new Error('Manifest asset resolves outside build directory.');
        const bytes = await readFile(target);
        if (bytes.length !== file.size || sha256(bytes) !== file.sha256) throw new Error('Manifest local file size/hash mismatch.');
      }
    }
  }
  const discovery = await discoverProtectionOrigins(config, {...options, fetchImpl:options.providerFetchImpl || globalThis.fetch});
  const origins = [...new Set([primary, ...discovery.origins, ...await readProtectionOrigins(options.originsFile, siteUrl), ...String(options.alternateOrigins || '').split(',').filter(Boolean).map(siteUrl)])];
  if (manifest && expectedRuntime && manifest.runtimeVersion !== expectedRuntime) throw new Error('Manifest runtime binding mismatch.');
  if (manifest) expectedRuntime = manifest.runtimeVersion;
  const paths = protectedPaths(manifest ? manifest.files.map(f => f.path) : inventory.paths);
  if (options.paths) {
    for (const path of String(options.paths).split(',')) {
      if (!safeAssetPath(path)) throw new Error('--paths는 동일 사이트의 절대 경로를 쉼표로 구분하세요.');
      paths.push(path);
    }
  }
  const variants = [
    { name: 'GET', method: 'GET', headers: { Accept: 'text/html' } },
    { name: 'HEAD', method: 'HEAD', headers: {} },
    { name: 'Range', method: 'GET', headers: { Range: 'bytes=0-63' } },
    { name: 'invalid_cookie', method: 'GET', headers: { Cookie: '__Host-nakwol_connect=invalid' } },
  ];
  if (manifest) variants.push({ name: 'cached_GET', method: 'GET', headers: {} }, { name: 'conditional_GET', method: 'GET', headers: { 'If-None-Match': '*' } });
  const jobs = origins.flatMap(origin => [...new Set(paths)].flatMap(path => variants.map(variant => ({ origin, path, variant }))));
  const checks = new Array(jobs.length); let cursor = 0;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let requestCount = 0;
  async function request(url, init) { requestCount++; return fetchImpl(url, init); }
  async function run() {
    while (cursor < jobs.length) {
      const index = cursor++, { origin, path, variant } = jobs[index];
      const url = new URL(path, origin);
      // A distinct query reduces false evidence from a stale CDN response.
      if (!['cached_GET', 'conditional_GET'].includes(variant.name)) url.searchParams.set('__nakwol_probe', `${Date.now()}-${index}`);
      try {
        const res = await request(url, { method: variant.method, headers: variant.headers, redirect: 'manual', cache: ['cached_GET', 'conditional_GET'].includes(variant.name) ? 'default' : 'no-store', signal: AbortSignal.timeout(10000) });
        const noStore = (res.headers.get('Cache-Control') || '').includes('no-store');
        const observedRuntime = res.headers.get('X-Nakwol-Runtime');
        deployedVersions.add(observedRuntime || 'unknown');
        if (variant.method === 'HEAD') await res.body?.cancel();
        const body = variant.method === 'HEAD' ? {bytes: Buffer.alloc(0), complete: true} : await boundedBody(res);
        const file = manifest?.files.find(f => f.path === path || (f.path.endsWith('/index.html') && f.path.slice(0,-10) === path) || (f.path.endsWith('.html') && f.path.slice(0,-5) === path));
        const canaries = manifest?.files.filter(f => f.canary).map(f => f.canary) || [];
        const leaked = canaries.some(canary => body.bytes.includes(Buffer.from(canary))) || (file && file.size > 0 && body.complete && sha256(body.bytes) === file.sha256);
        const exposed = leaked || (res.status >= 200 && res.status < 300) || res.status === 304;
        const blocked = (!expectedRuntime || observedRuntime === expectedRuntime) && [401, 403].includes(res.status) && res.headers.get('X-Nakwol-Gate') === 'v1' && noStore && body.complete && !leaked;
        const classification = exposed ? 'exposed' : blocked ? 'blocked' : 'indeterminate';
        checks[index] = { name: `${origin.slice(0, -1)}${path} ${variant.name}`, origin, ok: blocked, classification, bodyComplete: body.complete, status: res.status, contentType: res.headers.get('Content-Type'), detail: `HTTP ${res.status}; gate=${res.headers.get('X-Nakwol-Gate') || 'missing'}; no-store=${noStore}; runtime=${observedRuntime || 'unknown'}; classification=${classification}; bodyComplete=${body.complete}` };
        if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
          const target = new URL(res.headers.get('Location'), url);
          // Only the already approved origin is probed; no cookies are forwarded.
          if (target.origin === url.origin) {
            const next = await request(target, {redirect:'manual', cache:'default', signal:AbortSignal.timeout(10000)});
            const nextBody = await boundedBody(next);
            if ((next.status >= 200 && next.status < 300) || next.status === 304 || canaries.some(c => nextBody.bytes.includes(Buffer.from(c)))) {
              checks[index].classification = 'exposed'; checks[index].detail += '; redirect exposes content';
            }
          }
        }
      } catch (error) {
        checks[index] = { name: `${origin.slice(0, -1)}${path} ${variant.name}`, ok: false, origin, classification: 'unreachable', detail: 'request failed' };
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, run));
  const authenticatedChecks = [];
  if (manifest && sessionCookie) {
    async function authenticatedRequest(path) {
      let target = new URL(path, primary);
      for (let hop = 0; hop <= 5; hop++) {
        const response = await request(target, {headers:{Cookie:sessionCookie},redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(10000)});
        if (![301,302,303,307,308].includes(response.status)) return response;
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location || hop === 5) throw new Error('Authenticated redirect chain is invalid.');
        const next = new URL(location, target);
        if (next.origin !== new URL(primary).origin || next.username || next.password) throw new Error('Authenticated redirect leaves the bound site.');
        target = next;
      }
    }
    for (const file of manifest.files) {
      try {
        const response = await authenticatedRequest(file.path);
        const body = await boundedBody(response);
        const ok = response.status === 200 && body.complete && body.bytes.length === file.size && sha256(body.bytes) === file.sha256;
        authenticatedChecks.push({name:file.path,ok,status:response.status,bodyComplete:body.complete});
      } catch { authenticatedChecks.push({name:file.path,ok:false,status:null,bodyComplete:false}); }
    }
  }
  const manifestUnchanged = !manifest || (await readProtectionManifest(options.manifest, options)).manifestHash === manifest.manifestHash;
  const ok = checks.every(check => check.ok) && manifestUnchanged;
  const authenticatedExistenceVerified = Boolean(manifest && authenticatedChecks.length === manifest.files.length && authenticatedChecks.every(c => c.ok));
  const originResults = origins.map(origin => {
    const own = checks.filter(c => c.origin === origin);
    return {origin,status:own.some(c => c.classification === 'exposed') ? 'exposed' : own.every(c => c.ok) && origin === primary && authenticatedExistenceVerified && manifestUnchanged ? 'verified' : own.every(c => c.classification === 'unreachable') ? 'unreachable' : 'unknown',anonymousBlockingVerified:own.every(c => c.ok)};
  });
  const evidenceBinding = manifest ? {schemaVersion:1,deploymentId:manifest.deploymentId,buildHash:manifest.buildHash,manifestHash:manifest.manifestHash,runtimeVersion:manifest.runtimeVersion,capabilities:manifest.capabilities} : null;
  const releaseAccepted = Boolean(ok && authenticatedExistenceVerified && (!options.discoverOrigins || discovery.discoveryEvidence.status === 'complete'));
  return { schemaVersion:1, capabilities:manifest?.capabilities || config?.protection?.capabilities || [], discoveryEvidence:discovery.discoveryEvidence, ok, releaseAccepted, evidenceBinding, originResults, authenticatedChecks, authenticatedExistenceVerified, manifestUnchanged, expectedRuntime:expectedRuntime || null, observedRuntimeVersions:[...deployedVersions].sort(), inspectionScope: custom ? 'explicit-paths' : 'installed-assets', protectionStatus: ok ? 'anonymous-blocking-verified' : 'verification-failed', checkedAt: new Date().toISOString(), origins, assetCount: manifest?.files.length ?? inventory.paths.length, requestCount, probeCount:checks.length + authenticatedChecks.length, checks,
    limitations: ['401 헤더만으로 출시 합격을 의미하지 않습니다. manifest와 명시적 정상 세션으로 파일 해시를 확인해야 releaseAccepted가 됩니다. 최대 1 MiB 응답만 검사하며 초과 응답은 부분 검사입니다.', '다른 origin 리다이렉트는 따라가지 않으며 closed 상태는 HTTP 응답만으로 추정하지 않습니다.', custom ? '명시한 경로의 비로그인 차단만 검사했습니다. 설치 구성·전체 파일·게이트 내부 구현은 검증하지 않습니다.' : '검사한 배포 주소와 현재 로컬 빌드의 경로에 대한 비로그인 차단 결과입니다.', '정상 시즌3 계정 로그인, 권한 없는 계정 거부, 로그아웃은 실제 브라우저로 별도 확인하세요.', '열거하지 않은 이전 배포·원본 스토리지·다른 도메인은 검증하지 않습니다. 자동으로 찾아내거나 삭제하지 않습니다.'] };
}
