import { readFile, writeFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { readProjectConfig, writeProjectConfig } from './config.mjs';
import { detectProject } from './project.mjs';
import { installIntegration } from './integration.mjs';
import { prepareSetup } from './setup.mjs';
import { protectionBuildHash, sha256 } from './protection-inventory.mjs';
import * as workers from './adapters/cloudflare-workers.mjs';
import * as pages from './adapters/cloudflare-pages.mjs';
import * as vercel from './adapters/vercel-static.mjs';
const adapters = {'cloudflare-workers':workers,'cloudflare-pages':pages,vercel};

export const WRANGLER_FILE = 'wrangler.nakwol.json';
const GENERATED = '.nakwol/server';
const { version: runtimeVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const UPDATE_COMMAND = 'npx --yes nakwol-connect@~0.14.0 protect update';
// Git may convert generated text to CRLF on Windows; line endings are not a gate change.
const hash = value => createHash('sha256').update(value.toString().replaceAll('\r\n', '\n')).digest('hex');
// Vercel rewrites JSON whitespace/key order before the remote build. Protect
// every setting while comparing its JSON value rather than its formatting.
function generatedHash(file, value) {
  if (file !== 'vercel.json') return hash(value);
  const config = JSON.parse(value.toString());
  return hash(JSON.stringify(Object.fromEntries(Object.keys(config).sort().map(key => [key, config[key]]))));
}

export function siteUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('--url은 HTTPS 사이트 루트여야 합니다. 예: https://example.com/');
  return url.href;
}
export async function assetInventory(root, directory, generatedPaths = []) {
  if (typeof directory !== 'string' || !directory || isAbsolute(directory)) throw new Error('--assets에 프로젝트 내부의 빌드 결과 폴더를 지정하세요.');
  const base = await realpath(root), target = await realpath(resolve(root, directory));
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('프로젝트 루트나 외부 폴더를 자산으로 배포할 수 없습니다. dist 같은 전용 출력 폴더를 사용하세요.');
  const paths = [];
  async function walk(folder, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const local = join(folder, entry.name), path = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`자산 폴더의 심볼릭 링크는 지원하지 않습니다: ${path}`);
      if (entry.isFile() && generatedPaths.includes(relative(base, local).split(String.fromCharCode(92)).join('/'))) continue;
      if (entry.name.startsWith('.') || /^(node_modules|src|__nakwol)$/i.test(entry.name) || /\.(env|pem|key|map)$/i.test(entry.name) || /^(wrangler\.|package(-lock)?\.json|_worker\.js|_redirects|_headers|_routes\.json)/i.test(entry.name)) throw new Error(`공개 자산에 소스/설정 파일이 있습니다: ${path}`);
      if (entry.isDirectory()) await walk(local, path);
      else if (entry.isFile()) paths.push(path.split('/').map(encodeURIComponent).join('/'));
    }
  }
  await walk(target);
  if (!paths.includes('/index.html')) throw new Error('정적 빌드 결과에 index.html이 필요합니다. 먼저 빌드하세요. SSR/API 서버는 자동 설치 대상이 아닙니다.');
  if (paths.length > 10000) throw new Error('현재 검증은 최대 10,000개 자산을 지원합니다.');
  return { directory: relative(base, target).split(String.fromCharCode(92)).join('/'), paths: paths.sort() };
}
function pagesFiles(directory) { return [`${directory}/_worker.js`, `${directory}/_routes.json`, WRANGLER_FILE]; }
export function generatedAssetPaths(protection) {
  return protection?.provider === 'cloudflare-pages' ? pagesFiles(protection.assetsDirectory).slice(0, 2) : [];
}
export async function inspectProtection(root, config, options = {}) {
  if (!config?.protection) return { installed: false, ok: false, detail: '서버 게이트 미설치. Embed만으로 HTML/파일 직접 접근은 차단되지 않습니다.' };
  const p = config.protection;
  if (!options.allowSettingsChange && (p.accessPolicy !== config.accessPolicy || p.clientId !== config.clientId || p.authOrigin !== config.authOrigin)) return { installed:true, ok:false, detail:'앱 정책/주소와 서버 게이트 설정이 다릅니다. protect install로 갱신 후 배포하세요.' };
  const modern = Number((p.runtimeVersion || '0.0.0').split('.')[0]) > 0 || Number((p.runtimeVersion || '0.0.0').split('.')[1]) >= 10;
  const controlled=Number((p.runtimeVersion||'0.0.0').split('.')[0])>0||Number((p.runtimeVersion||'0.0.0').split('.')[1])>=11;
  const observed=Number((p.runtimeVersion||'0.0.0').split('.')[0])>0||Number((p.runtimeVersion||'0.0.0').split('.')[1])>=12;
  const expectedNames = p.provider === 'vercel' ? vercel.files.filter(file => (modern || !file.endsWith('/session.mjs')) && (controlled || !file.endsWith('/control.mjs')) && (observed || !file.endsWith('/observations.mjs'))) : p.provider === 'cloudflare-pages' ? pagesFiles(p.assetsDirectory) : [`${GENERATED}/gate.mjs`, `${GENERATED}/login.mjs`, `${GENERATED}/index.mjs`, WRANGLER_FILE, ...(modern ? [`${GENERATED}/session.mjs`] : []), ...(controlled ? [`${GENERATED}/control.mjs`] : []), ...(observed ? [`${GENERATED}/observations.mjs`] : [])];
  if (!Object.hasOwn(adapters,p.provider) || !p.files || Object.keys(p.files).length !== expectedNames.length) return { installed: true, ok: false, detail: '지원하지 않는 보호 설정' };
  for (const file of expectedNames) {
    try {
      const value = await readFile(join(root, file));
      if (generatedHash(file, value) !== p.files[file] && hash(value) !== p.files[file]) return { installed: true, ok: false, detail: `설치 이후 파일 변경: ${file}` };
    }
    catch (error) {
      if (options.allowMissingBuildOutputs && error.code === 'ENOENT' && generatedAssetPaths(p).includes(file)) continue;
      return { installed: true, ok: false, detail: `파일 없음: ${file}` };
    }
  }
  const adapterInspection = await adapters[p.provider].inspect(root, p);
  if (!adapterInspection.ok) return {installed:true, ...adapterInspection};
  return { schemaVersion:1, capabilities:adapters[p.provider].capabilities, installed: true, ok: true, runtimeVersion:p.runtimeVersion || 'legacy', updateAvailable:p.runtimeVersion !== runtimeVersion, detail: `서버 게이트 구성 확인 (${p.runtimeVersion || 'legacy'}). ${p.runtimeVersion !== runtimeVersion ? '공통 게이트 갱신: npx --yes nakwol-connect@~0.14.0 protect update 후 재배포. ' : ''}실제 배포 차단은 protect verify로 별도 확인해야 합니다.` };
}
export async function installProtection(options = {}) {
  const root = options.root || process.cwd();
  const prepared = options.setupFile ? await prepareSetup(options) : null;
  if (prepared) options = prepared.options;
  const config = prepared?.config || await readProjectConfig(root);
  if (!config?.clientId) throw new Error('먼저 nakwol-connect init을 실행하세요.');
  if (!Object.hasOwn(adapters,options.provider)) throw new Error('자동 설치 지원 환경: --provider cloudflare-workers, cloudflare-pages 또는 vercel (정적 빌드). Netlify 등은 nakwol-connect/server 공통 게이트를 호스팅에 연결한 뒤 protect verify --provider custom --url https://SITE/ --paths /,/data.json 으로 검사하세요. GitHub Pages는 서버 게이트를 실행할 수 없으므로 보호 콘텐츠를 서버가 있는 호스팅으로 옮겨야 합니다. Embed만으로는 파일을 보호하지 못합니다.');
  if (config.protection && config.protection.provider !== options.provider) throw new Error('기존 배포의 공개 경로를 남길 수 있으므로 provider를 자동 변경하지 않습니다.');
  if (config.protection && options.assets && options.assets !== config.protection.assetsDirectory) throw new Error('기존 보호 파일을 보존하기 위해 자산 폴더 변경은 자동 적용하지 않습니다.');
  if (config.authMode !== 'required') throw new Error('공개 페이지(optional)에는 서버 게이트를 자동 적용하지 않습니다. init --auth required로 정책을 먼저 정하세요.');
  const project = await detectProject(root);
  if (!['html','vite','react','vue','cra'].includes(project.framework)) throw new Error('자동 서버 보호 설치는 HTML/Vite/React/Vue/CRA의 정적 빌드만 지원합니다.');
  const url = siteUrl(options.url || config.protection?.siteUrl);
  if (!config.redirectUris.includes(url)) throw new Error(`콜백을 먼저 등록하세요: nakwol-connect add-url ${url}`);
  if (config.protection && !(await inspectProtection(root, config, { allowSettingsChange:true, allowMissingBuildOutputs:options.update === true })).ok) throw new Error('기존 서버 게이트가 변경되어 자동으로 덮어쓰지 않습니다. 변경 사항을 먼저 검토하세요.');
  const adapterInspection = await adapters[options.provider].inspect(root, config.protection);
  if (!adapterInspection.ok) throw new Error(adapterInspection.detail);
  const inventory = await assetInventory(root, options.assets || config.protection?.assetsDirectory, generatedAssetPaths(config.protection));
  const accessPolicy = config.accessPolicy || 'member';
  if (!['member', 'guest', 'admin'].includes(accessPolicy)) throw new Error('접근 정책을 확인하세요.');
  const authUrl = new URL(config.authOrigin || 'https://nakwol-auth.sepsd21.workers.dev');
  if (authUrl.protocol !== 'https:' || authUrl.username || authUrl.password || authUrl.pathname !== '/' || authUrl.search || authUrl.hash) throw new Error('서버 배포의 AUTH 주소는 HTTPS origin이어야 합니다.');
  const authOrigin = authUrl.origin;
  const projectName = options.projectName || config.protection?.projectName || config.clientId;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(projectName)) throw new Error('--project-name에 Cloudflare 프로젝트 이름을 지정하세요.');
  const files = await adapters[options.provider].generate({settings:{clientId:config.clientId,siteUrl:url,authOrigin,accessPolicy},projectName}, inventory);
  for (const file of Object.keys(files)) {
    try { await stat(join(root, file)); if (!config.protection) throw new Error(`기존 파일을 덮어쓸 수 없습니다: ${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const buildPackage = await updateBuildHook(root, config.protection?.updateChannel === 'managed');
  if (options.provider === 'vercel') {
    const existing = buildPackage.dependencies?.['@vercel/functions'] || buildPackage.devDependencies?.['@vercel/functions'];
    if (existing && existing !== '3.9.9') throw new Error('기존 @vercel/functions 버전을 검토하세요. 공식 어댑터는 3.9.9로 검증합니다.');
    buildPackage.dependencies = {...buildPackage.dependencies, '@vercel/functions':'3.9.9'};
  }
  await installIntegration(root, project, config.clientId, { ...config, serverGate:true, siteUrl:url });
  await mkdir(join(root, GENERATED), { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(join(root, file), content);
  await writeFile(join(root, 'package.json'), JSON.stringify(buildPackage, null, 2) + String.fromCharCode(10));
  const protection = { schemaVersion:1, capabilities:adapters[options.provider].capabilities, runtimeVersion, updateChannel:config.protection?.updateChannel === 'managed' ? 'managed' : 'latest', ...(config.protection?.automation ? {automation:config.protection.automation} : {}), ...(config.protection?.automatic ? {automatic:config.protection.automatic} : {}), ...(config.protection?.hosting ? {hosting:config.protection.hosting} : {}), ...(config.protection?.rollback ? {rollback:config.protection.rollback} : {}), provider: options.provider, projectName, siteUrl: url, clientId:config.clientId, accessPolicy, authOrigin, assetsDirectory: inventory.directory, files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, generatedHash(file, content)])) };
  await writeProjectConfig(root, { ...config, accessPolicy, authOrigin, protection });
  return { ok: true, protectionStatus: 'configured', protection, ...(prepared ? {setupDiff:prepared.diff,setupStatus:{...prepared.status,localInstallation:'configured'}} : {}), nextSteps: [
    'npm run build는 설정된 버전의 공식 공통 게이트를 반영합니다. 별도 빌드 도구/배포 명령은 빌드 후 npm run nakwol:gate를 실행하세요.',
    'Connect의 서버 로그아웃 연동이 반영되도록 사이트를 다시 빌드하세요.',
    '서버 자동 갱신은 별도 활성화입니다. 등록된 /__nakwol/callback과 해당 origin의 서버 credential을 NAKWOL_SITE_CREDENTIAL Secret에 설정하세요. 자세한 절차: docs/SERVER_SESSION_REFRESH.md. Secret이 없으면 기존 1시간 세션을 유지합니다.',
    options.provider === 'vercel' ? 'Vercel 프로젝트의 Production/Preview 환경 변수에 NAKWOL_SESSION_SECRET을 설정하세요 (무작위 32자 이상). npm install로 @vercel/functions를 설치하세요.' : options.provider === 'cloudflare-pages' ? `npx wrangler pages secret put NAKWOL_SESSION_SECRET --project-name ${projectName} (무작위 32자 이상)` : `npx wrangler secret put NAKWOL_SESSION_SECRET --config ${WRANGLER_FILE} (무작위 32자 이상, 저장소에 넣지 않기)`,
    options.provider === 'vercel' ? 'npm run build 후 vercel --prod로 배포하세요. 미리보기 주소는 등록 origin과 달라 차단됩니다.' : options.provider === 'cloudflare-pages' ? `npx wrangler pages deploy ${inventory.directory} --project-name ${projectName} (운영 브랜치를 명시하고 Pages Functions fail-open을 비활성화하세요)` : `npx wrangler deploy --config ${WRANGLER_FILE}`,
    `nakwol-connect protect verify --url ${url}`,
    '기존 Pages/스토리지/미리보기 주소가 자료를 공개하지 않는지 확인하고 필요하면 --alternate-origins로 함께 검사하세요.',
  ] };
}

async function updateBuildHook(root, managed = false) {
  let pkg;
  try { pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; pkg = { private:true }; }
  if (managed) {
    const development=pkg.devDependencies?.['nakwol-connect'],production=pkg.dependencies?.['nakwol-connect'];
    if ((development||production)!==runtimeVersion || development&&production&&development!==production) throw new Error('Managed gate requires an exact installed nakwol-connect version matching package.json.');
  }
  const scripts = { ...pkg.scripts };
  if (managed) {
    if (scripts['nakwol:gate'] !== 'nakwol-connect protect update') throw new Error('Managed gate hook was changed; refusing network-based fallback.');
    return pkg;
  }
  if (scripts['nakwol:gate'] && scripts['nakwol:gate'] !== UPDATE_COMMAND && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.13.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.12.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.11.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.10.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.9.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.8.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.7.0 protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@latest protect update' && scripts['nakwol:gate'] !== 'npx --yes nakwol-connect@~0.6.3 protect update') throw new Error('기존 nakwol:gate 스크립트를 덮어쓰지 않습니다.');
  scripts['nakwol:gate'] = UPDATE_COMMAND;
  if (!scripts.build) scripts.build = 'npm run nakwol:gate';
  else if (scripts.build !== 'npm run nakwol:gate' && !(scripts.postbuild || '').includes('npm run nakwol:gate')) {
    scripts.postbuild = scripts.postbuild ? `npm run nakwol:gate && ${scripts.postbuild}` : 'npm run nakwol:gate';
  }
  return { ...pkg, scripts };
}

export async function updateProtection(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.protection) throw new Error('먼저 protect install로 공통 게이트를 설치하세요.');
  return installProtection({ ...options, root, provider:config.protection.provider, update:true });
}

export async function createProtectionManifest(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const inspection = await inspectProtection(root,config);
  if (!inspection.ok) throw new Error(inspection.detail);
  if (!/^[\w.-]{1,200}$/.test(options.deploymentId || '') || !options.outputFile) throw new Error('--deployment-id와 --output-file이 필요합니다.');
  const inventory = await assetInventory(root,config.protection.assetsDirectory,generatedAssetPaths(config.protection));
  const output = resolve(root,options.outputFile);
  const outputRelative = relative(resolve(root,inventory.directory),output);
  if (outputRelative !== '..' && !outputRelative.startsWith(`..${String.fromCharCode(92)}`) && !outputRelative.startsWith('../') && !isAbsolute(outputRelative)) throw new Error('manifest를 공개 자산 폴더 밖에 저장하세요.');
  const files = [];
  for (const path of inventory.paths) {
    const bytes = await readFile(join(root,inventory.directory,decodeURIComponent(path.slice(1))));
    files.push({path,size:bytes.length,sha256:sha256(bytes)});
  }
  const manifest = {schemaVersion:1,deploymentId:options.deploymentId,buildHash:protectionBuildHash(files),runtimeVersion:config.protection.runtimeVersion,capabilities:inspection.capabilities,files};
  await writeFile(output,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return {ok:true,outputFile:output,buildHash:manifest.buildHash,assetCount:files.length};
}
