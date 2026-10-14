#!/usr/bin/env node
import {
  DEFAULT_AUTH_ORIGIN, DEFAULT_DATA_ORIGIN,
  initProject, doctorProject, statusProject, addUrlProject, syncProject, removeProject,
  dataStatusProject, dataSetProject, dataAddProject, dataRemoveProject, qualificationsProject,
} from '../src/commands.mjs';
import { dataDescribeProject } from '../src/discovery.mjs';
import { installProtection, updateProtection } from '../src/protection.mjs';
import { automateProtection, protectionStatus } from '../src/managed-updates.mjs';
import { manageReportToken, reportProtection } from '../src/gate-reporting.mjs';
import { checkRelease } from '../src/release-check.mjs';
import { rollbackProtection } from '../src/deployment-rollback.mjs';
import { readFile } from 'node:fs/promises';
import { readProjectConfig } from '../src/config.mjs';
const {version:cliVersion}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
import { verifyProtection } from '../src/protection-verify.mjs';
import { wizardProject, renderInstallationPlan } from '../src/wizard.mjs';

function parse(argv) {
  const args=[...argv]; const command=args.shift()||'init'; const options={}; const positionals=[];
  while(args.length){const value=args.shift();if(!value.startsWith('--')){positionals.push(value);continue;}const key=value.slice(2);if(['json','no-open','offline','revoke','reports','baseline','qualification-legacy','plan','apply'].includes(key)){options[key==='no-open'?'noOpen':key==='qualification-legacy'?'qualificationLegacy':key]=true;continue;}const next=args.shift();if(next==null||next.startsWith('--'))throw new Error(`--${key} 값이 필요합니다.`);const map={'qualification-match':'qualificationMatch','auth-origin':'authOrigin','data-origin':'dataOrigin','client-id':'clientId','access-policy':'accessPolicy','auth':'authMode','project-name':'projectName','alternate-origins':'alternateOrigins','expect-runtime':'expectRuntime','output-file':'outputFile','deployment-id':'deploymentId','failed-deployment-id':'failedDeploymentId'};options[map[key]||key]=next;}
  return {command,options,positionals};
}
function human(result) {
  if(result?.kind==='installation-plan'){renderInstallationPlan(result);return;}
  if(!result?.checks && !result?.doctor?.checks){console.log(JSON.stringify(result,null,2));return;}
  const color=process.stdout.isTTY&&!process.env.NO_COLOR;
  const heading=value=>console.log(color?`\n\x1b[1;36m${value}\x1b[0m`:`\n${value}`);
  heading(result?.ok===false?'NAKWOL Connect · 확인할 항목이 있습니다':'NAKWOL Connect · 실행 결과');
  const clientId=result?.clientId||result?.config?.clientId||result?.local?.config?.clientId;
  if(clientId)console.log(`  앱 ID: ${clientId}`);
  if(result?.protectionStatus)console.log(`  서버 보호: ${result.protectionStatus}`);
  if(result?.appliedStage)console.log(`  적용 단계: ${result.appliedStage}`);
  if(result?.changedFiles?.length){heading('변경한 파일');for(const file of result.changedFiles)console.log(`  · ${file}`);}
  const checks=result?.checks||result?.doctor?.checks;
  if(checks){heading('검사');for(const check of checks)console.log(`  ${check.ok?'✓':'×'} ${check.name}${check.detail?` · ${check.detail}`:''}`);}
  if(result?.note)console.log(`  ${result.note}`);
  if(result?.error)console.log(`  ${result.error}`);
  for(const note of result?.limitations||[])console.log(`  · ${note}`);
  if(result?.nextSteps?.length){heading('다음 단계');for(const step of result.nextSteps)console.log(`  › ${step}`);}
  console.log('');
}
async function main(){
  const{command,options,positionals}=parse(process.argv.slice(2));const storedConfig=await readProjectConfig(options.root||process.cwd());options.authOrigin||=process.env.NAKWOL_AUTH_ORIGIN||storedConfig?.authOrigin||DEFAULT_AUTH_ORIGIN;if(!options.dataOrigin&&process.env.NAKWOL_DATA_ORIGIN)options.dataOrigin=process.env.NAKWOL_DATA_ORIGIN;options.output=options.json?()=>{}:console.log;options.interactive=Boolean(process.stdin.isTTY&&process.stdout.isTTY&&!options.json);if((options.qualifications!==undefined||options.qualificationMatch!==undefined||options.qualificationLegacy)&&!['init','sync','qualifications'].includes(command))throw new Error('가입 자격 옵션은 init, sync, qualifications 명령에만 사용할 수 있습니다.');let result;
  if(command==='wizard')result=await wizardProject(options);
  else if(command==='protect'){
    if(positionals[0]==='install')result=await installProtection(options);
    else if(positionals[0]==='update')result=await updateProtection(options);
    else if(positionals[0]==='automate')result=await automateProtection(options);
    else if(positionals[0]==='status')result=await protectionStatus(options);
    else if(positionals[0]==='release-check')result=await checkRelease(options);
    else if(positionals[0]==='report-token')result=await manageReportToken(options);
    else if(positionals[0]==='report')result=await reportProtection(options);
    else if(positionals[0]==='rollback'){if(!options.report)throw new Error('--report is required.');result=await rollbackProtection({...options,failureReport:JSON.parse(await readFile(options.report,'utf8'))});}
    else if(positionals[0]==='verify')result=await verifyProtection(options);
    else throw new Error('사용법: nakwol-connect protect install --provider <cloudflare-workers|cloudflare-pages> --assets dist --url https://SITE/ 또는 protect verify --url https://SITE/ [--alternate-origins URL,URL] [--paths /api/private]');
  }
  else if(command==='qualifications')result=await qualificationsProject(positionals[0]||'status',options);else if(command==='init')result=await initProject(options);else if(command==='doctor')result=await doctorProject(options);else if(command==='status')result=await statusProject(options);else if(command==='add-url'){if(!positionals[0])throw new Error('사용법: nakwol-connect add-url <URL>');result=await addUrlProject(positionals[0],options);}else if(command==='sync')result=await syncProject(options);else if(command==='remove')result=await removeProject(options);else if(command==='data'){const op=positionals[0]||'status';const scopes=positionals[1]||'';if(op==='status')result=await dataStatusProject(options);else if(op==='describe')result=await dataDescribeProject(options);else if(op==='set')result=await dataSetProject(scopes,options);else if(op==='add')result=await dataAddProject(scopes,options);else if(op==='remove')result=await dataRemoveProject(scopes,options);else throw new Error('사용법: nakwol-connect data <status|describe|set|add|remove> [scopes]');}
  else if(command==='help'||command==='--help'||command==='-h'){console.log(`NAKWOL Connect CLI v${cliVersion}\n\nCommands:\n  wizard     단계별 설치 안내 (--plan / --offline / --json은 읽기 전용, --apply는 명시적 적용)\n  init       프로젝트 감지 → AUTH 앱 → DATA scope → Connect 설치\n  doctor     연결 + 배포 사이트의 실제 차단 검사 (required는 검증 전 실패)
  protect install --provider <cloudflare-workers|cloudflare-pages> --assets dist --url https://SITE/
             정적 빌드의 서버 게이트 설치 (배포는 별도)
  protect automate [--environment production]  고정 버전 및 GitHub 업데이트 CI 설치
  protect release-check --deployment-id <ID> --output-file <json> [--baseline]  배포 검사 및 설정된 자동 복구
  protect report-token --output-file <outside-project> | --revoke  앱 전용 보고 토큰 관리
  protect report --report <json> --commit <SHA> [--deployment-id <ID>]  중앙 보고
  protect rollback --report <json> --failed-deployment-id <ID>  명시한 검증 배포로 복구
  protect status [--offline]  로컬 및 실제 배포 버전 비교
  protect update   저장된 설정으로 공통 게이트 갱신 (재배포 필요)
  protect verify --url https://SITE/ [--alternate-origins URL,URL] [--paths /private]
  protect verify --provider custom --url https://SITE/ --paths /,/data.json
             직접 구현한 게이트도 명시한 경로의 비로그인 차단 검사 가능
             비로그인 GET/HEAD/Range/잘못된 쿠키 차단 검증\n  status     현재 프로젝트 연결 상태 출력\n  add-url    Redirect URI 추가\n  sync       중앙/로컬 desired state 동기화\n  qualifications list|status|set|reset    가입 자격 조회·변경\n  data       DATA status/describe/set/add/remove\n  remove     로컬 Connect 설치 제거\n\nOptions:\n  --json\n  --url <URL>\n  --name <NAME>\n  --client-id <ID>\n  --access-policy <guest|member|admin>\n  --auth <required|optional>   기본값 required\n  --qualifications <ID,ID>    member 앱의 허용 자격 선택\n  --qualification-match <any|all>    기본값 any\n  --qualification-legacy    기존 기본 조건으로 복원\n  --scopes <scope,scope>\n  --data-origin <URL>\n  --no-open\n  --auth-origin <URL>`);return;}else throw new Error(`알 수 없는 명령: ${command}`);
  if(options.json)console.log(JSON.stringify(result,null,2));else human(result);if(result?.ok===false)process.exitCode=1;
}
main().catch((error)=>{console.error(error?.message||String(error));process.exitCode=1;});
