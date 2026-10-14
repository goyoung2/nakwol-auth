const PROVIDERS = ['cloudflare-workers', 'cloudflare-pages', 'vercel', 'netlify', 'custom', 'github-pages'];
const CLI = 'npx --yes nakwol-connect@0.7.7';

export function quoteArgument(value) {
  const text = String(value);
  if (/[\x00-\x1f\x7f'"`$]/.test(text)) throw new Error('입력에 제어 문자, 따옴표 또는 셸 치환 문자를 사용할 수 없습니다.');
  return `'${text}'`;
}

export function buildInstallationPlan(options = {}) {
  const existing = options.existing || {};
  const protection = existing.protection || {};
  const provider = options.provider || protection.provider || 'cloudflare-workers';
  if (!PROVIDERS.includes(provider)) throw new Error('호스팅은 cloudflare-workers, cloudflare-pages, vercel, netlify, custom, github-pages 중 선택하세요.');
  const urlInput = options.url || protection.siteUrl || existing.redirectUris?.find(value => value.startsWith('https://'));
  if (!urlInput) throw new Error('배포할 HTTPS 사이트 주소를 --url로 입력하세요.');
  quoteArgument(urlInput);
  const parsedUrl = new URL(urlInput);
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) throw new Error('사이트 주소는 HTTPS 루트여야 합니다. 예: https://example.com/');
  const url = parsedUrl.href;
  const assets = options.assets || protection.assetsDirectory || 'dist';
  quoteArgument(assets);
  if (!assets || /^[\\/]|^[a-z]:/i.test(assets) || assets.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('빌드 폴더는 프로젝트 내부의 전용 상대 경로여야 합니다. 예: dist');
  const projectName = options.projectName || protection.projectName || 'nakwol-site';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(projectName)) throw new Error('프로젝트 이름은 영문 소문자, 숫자, 하이픈으로 1~63자 입력하세요.');
  const accessPolicy = options.accessPolicy || existing.accessPolicy || 'member';
  if (!['guest', 'member', 'admin'].includes(accessPolicy)) throw new Error('접근 정책은 guest, member, admin 중 선택하세요.');
  const authMode = options.authMode || existing.authMode || 'required';
  if (!['required', 'optional'].includes(authMode)) throw new Error('인증 방식은 required 또는 optional이어야 합니다.');
  const authOrigin = options.authOrigin || existing.authOrigin || 'https://nakwol-auth.sepsd21.workers.dev';
  quoteArgument(authOrigin);
  const authUrl = new URL(authOrigin);
  if (authUrl.protocol !== 'https:' || authUrl.origin !== authOrigin) throw new Error('AUTH 주소는 경로 없는 HTTPS origin이어야 합니다.');
  const q = quoteArgument;
  const automatic = ['cloudflare-workers', 'cloudflare-pages'].includes(provider) && authMode === 'required';
  const connected = Boolean(existing.clientId);
  const installed = Boolean(protection.provider);
  const steps = [];
  const add = (id, title, description, commands = [], manual = false) => steps.push({id, title, description, commands, manual});
  add('connect', connected ? '기존 앱 연결 유지' : '앱 연결 및 로그인', connected ? '저장된 앱 ID·자격·DATA 설정을 유지합니다. 사이트 주소가 바뀌었다면 콜백을 추가하세요.' : '브라우저에서 관리자로 로그인하고 앱을 연결합니다. 가입 자격 선택은 기존 init 흐름에서 진행합니다.', connected ? (existing.redirectUris?.includes(url) ? [] : [`${CLI} add-url ${q(url)}`]) : [`${CLI} init --url ${q(url)} --access-policy ${q(accessPolicy)} --auth ${q(authMode)} --auth-origin ${q(authOrigin)}`]);
  if (installed && protection.updateChannel === 'managed') add('runtime', '관리형 게이트 버전 고정', '빌드 전에 로컬 개발 의존성을 정확한 버전으로 갱신합니다. 수동 서버 어댑터는 기존 dependency 위치를 확인하여 그 위치에서 버전을 갱신하세요.', ['npm install --save-dev --save-exact nakwol-connect@0.7.7'], true);
  add('build', '사이트 빌드', '프로젝트의 빌드 명령으로 공개할 결과물을 전용 폴더에 만드세요. HTML 프로젝트는 해당 폴더에 index.html과 공개 자산을 준비하세요.', ['npm run build'], true);
  if (automatic) {
    add('gate', installed ? '서버 게이트 갱신' : '서버 게이트 설치', 'HTML·정적 파일을 서버에서 보호합니다. 빌드 결과가 있어야 적용할 수 있습니다.', [installed ? `${protection.updateChannel === 'managed' ? 'npx --no-install nakwol-connect' : CLI} protect update` : `${CLI} protect install --provider ${q(provider)} --assets ${q(assets)} --project-name ${q(projectName)} --url ${q(url)}`]);
    if (!installed) add('secret', '첫 설치: 세션 비밀키 등록', '무작위 32자 이상의 NAKWOL_SESSION_SECRET을 호스팅의 비밀 저장소에 직접 등록하세요. 마법사는 값을 받거나 저장하지 않습니다. Workers는 첫 배포 전 호스팅 프로젝트 생성이 필요할 수 있습니다.', [provider === 'cloudflare-pages' ? `npx wrangler pages secret put NAKWOL_SESSION_SECRET --project-name ${q(projectName)}` : 'npx wrangler secret put NAKWOL_SESSION_SECRET --config wrangler.nakwol.json'], true);
    add('rebuild', '연결 코드 반영', '첫 설치 후 다시 빌드해 로그인·로그아웃 연결을 반영하세요. 설치된 postbuild가 게이트를 다시 적용합니다.', ['npm run build']);
    add('deploy', '호스팅에 배포', '보호 파일과 빌드 결과를 함께 배포하세요. Pages는 YOUR_PRODUCTION_BRANCH를 프로젝트의 실제 운영 브랜치로 바꾸고 Functions fail-open을 비활성화하세요.', [provider === 'cloudflare-pages' ? `npx wrangler pages deploy ${q(assets)} --project-name ${q(projectName)} --branch YOUR_PRODUCTION_BRANCH` : 'npx wrangler deploy --config wrangler.nakwol.json'], true);
  } else if (authMode === 'optional') {
    add('deploy', '공개 사이트 배포', 'optional은 로그인 없이도 페이지와 파일에 접근할 수 있는 공개 모드입니다. 선택한 호스팅의 배포 절차를 진행하세요.', [], true);
  } else if (provider === 'github-pages') {
    add('hosting', '서버가 있는 호스팅 선택', 'GitHub Pages는 서버 게이트를 실행하지 못합니다. 보호 콘텐츠를 Workers·Pages 또는 서버가 있는 호스팅으로 옮긴 다음 마법사를 다시 실행하세요.', [], true);
  } else {
    add('gate', '호스팅 서버에 게이트 연결', `${provider === 'custom' ? '사용 중인 서버' : provider}의 서버 요청 경로에 nakwol-connect/server 게이트를 직접 연결하고 HTML·자산·API 우회를 차단하세요. 자동 설치 대상은 정적 Workers·Pages입니다.`, [], true);
    if (!installed) add('secret', '첫 서버 설치: 세션 비밀키 등록', '호스팅의 비밀 저장소에 무작위 32자 이상의 세션 키를 등록하세요. 기존 배포의 키를 임의로 교체하지 마세요.', [], true);
    add('deploy', '서버와 사이트 배포', '사용 중인 호스팅의 배포 절차로 게이트와 사이트를 함께 배포하세요.', [], true);
  }
  add('verify', '배포 차단 및 연결 검사', '비로그인 직접 접근을 검사한 뒤 브라우저에서 실제 로그인·권한·로그아웃을 확인하세요. 이전 공개 주소는 --alternate-origins로 함께 검사하세요.', [...(authMode === 'required' && provider !== 'github-pages' ? [`${CLI} protect verify${automatic ? '' : ' --provider custom --paths /,/index.html'} --url ${q(url)}`] : []), `${CLI} doctor --url ${q(url)}`], true);
  return {ok:true, kind:'installation-plan', completed:false, connected, protectionInstalled:installed, provider, url, assets, projectName, accessPolicy, authMode, authOrigin, steps};
}
