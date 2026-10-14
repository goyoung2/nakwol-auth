import { createInterface } from 'node:readline/promises';
import { readProjectConfig } from './config.mjs';
import { initProject } from './commands.mjs';
import { updateProtection } from './protection.mjs';
import { buildInstallationPlan } from './install-plan.mjs';
export { buildInstallationPlan } from './install-plan.mjs';

export function renderInstallationPlan(plan, output = console.log) {
  const color = process.stdout.isTTY && !('NO_COLOR' in process.env);
  const accent = text => color ? `\x1b[1;36m${text}\x1b[0m` : text;
  const muted = text => color ? `\x1b[2m${text}\x1b[0m` : text;
  output(`\n  ${accent('NAKWOL CONNECT')}  /  설치 스튜디오\n  ${muted('────────────────────────────────────────')}\n`);
  output(`  사이트  ${plan.url}\n  호스팅  ${plan.provider}\n  접근    ${plan.accessPolicy} · ${plan.authMode}\n  빌드    ${plan.assets}\n`);
  for (const [index, step] of plan.steps.entries()) {
    output(`  ${accent(String(index + 1).padStart(2, '0') + '  ' + step.title)}${step.manual ? muted('  · 직접 진행') : ''}`);
    output(`      ${step.description}`);
    for (const command of step.commands) output(`      ${accent('›')} ${command}`);
    output('');
  }
  output(`  ${muted('────────────────────────────────────────')}\n  현재 상태: 설치 계획 준비. 배포·보호 검증은 아직 완료되지 않았습니다.\n`);
  if (plan.appliedStage) output(`  적용한 단계: ${plan.appliedStage === 'connect' ? '앱 연결 및 로컬 코드 설치' : '로컬 서버 게이트 갱신'}\n`);
  if (plan.note) output(`  ${plan.note}\n`);
}

export async function wizardProject(options = {}, dependencies = {}) {
  const root = options.root || process.cwd();
  const existing = await readProjectConfig(root);
  const output = options.output || console.log;
  const chosen = {...options, existing};
  const interactive = options.interactive && !options.json && !options.plan && !options.offline;
  let confirmed = options.apply === true;
  if (interactive) {
    const rl = (dependencies.createInterface || createInterface)({input:process.stdin, output:process.stdout});
    try {
      output('\n  ✦ NAKWOL Connect 설치 마법사\n  앱 연결 → 사이트 빌드 → 서버 보호 → 배포 → 실제 검증\n  Enter를 누르면 표시된 기본값을 유지합니다.\n');
      const ask = async (label, value) => (await rl.question(`  ${label}${value ? ` [${value}]` : ''}: `)).trim() || value;
      chosen.provider = await ask('호스팅 (cloudflare-workers / cloudflare-pages / vercel / netlify / custom / github-pages)', options.provider || existing?.protection?.provider || 'cloudflare-workers');
      chosen.url = await ask('HTTPS 사이트 루트', options.url || existing?.protection?.siteUrl || existing?.redirectUris?.find(value => value.startsWith('https://')) || '');
      chosen.assets = await ask('빌드 결과 폴더', options.assets || existing?.protection?.assetsDirectory || 'dist');
      chosen.projectName = await ask('호스팅 프로젝트 이름', options.projectName || existing?.protection?.projectName || 'nakwol-site');
      chosen.accessPolicy = await ask('접근 정책 (guest / member / admin)', options.accessPolicy || existing?.accessPolicy || 'member');
      chosen.authMode = await ask('인증 방식 (required / optional)', options.authMode || existing?.authMode || 'required');
      const plan = buildInstallationPlan(chosen);
      renderInstallationPlan(plan, output);
      confirmed ||= (await rl.question(existing ? '  기존 서버 게이트를 로컬에서 갱신할까요? [y/N]: ' : '  앱 연결을 시작하고 로컬 Connect 코드를 설치할까요? [y/N]: ')).trim().toLowerCase() === 'y';
    } finally { rl.close(); }
  }
  let plan = buildInstallationPlan(chosen);
  if (!confirmed || options.offline || options.plan || options.json) return plan;
  if (existing) {
    if (!existing.protection) return {...plan, applied:false, note:'기존 앱 연결을 유지했습니다. 빌드 후 계획의 서버 게이트 설치 단계를 진행하세요.'};
    const baseline = buildInstallationPlan({existing});
    const unchanged = ['provider','assets','projectName','accessPolicy','authMode','authOrigin','url'].every(key => plan[key] === baseline[key]);
    if (!unchanged) throw new Error('기존 설정 변경은 자동 적용하지 않습니다. 표시된 계획을 검토하고 해당 설정 명령을 직접 실행하세요.');
    const applied = await (dependencies.updateProtection || updateProtection)({...options, root});
    return {...plan, applied:applied.ok === true, appliedStage:'gate', completed:false};
  }
  await (dependencies.initProject || initProject)({...options, ...chosen, provider:undefined, root, output, interactive:options.interactive});
  plan = buildInstallationPlan({...chosen, existing:await readProjectConfig(root)});
  return {...plan, applied:true, appliedStage:'connect', completed:false};
}
