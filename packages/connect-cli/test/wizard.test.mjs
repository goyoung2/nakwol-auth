import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildInstallationPlan, quoteArgument } from '../src/install-plan.mjs';
import { wizardProject, renderInstallationPlan } from '../src/wizard.mjs';

test('installation plan is deterministic, private defaults and unverified', () => {
  const options = {url:'https://example.com/'};
  assert.deepEqual(buildInstallationPlan(options), buildInstallationPlan(options));
  const plan=buildInstallationPlan(options);
  assert.equal(plan.accessPolicy,'member');
  assert.equal(plan.authMode,'required');
  assert.equal(plan.completed,false);
  assert.ok(plan.steps.find(step=>step.id==='secret'));
  assert.ok(plan.steps.find(step=>step.id==='verify').commands.some(value=>value.includes('doctor')));
});
test('saved settings stay intact and existing gate omits first-install secrets', () => {
  const existing={clientId:'saved',authMode:'required',accessPolicy:'admin',authOrigin:'https://auth.example.com',redirectUris:['https://site.example.com/'],accessToken:'NEVER_OUTPUT',protection:{provider:'cloudflare-pages',siteUrl:'https://site.example.com/',projectName:'existing-site',assetsDirectory:'build'}};
  const snapshot=JSON.stringify(existing);
  const plan=buildInstallationPlan({existing});
  assert.equal(plan.assets,'build');
  assert.equal(plan.projectName,'existing-site');
  assert.equal(plan.accessPolicy,'admin');
  assert.ok(!plan.steps.some(step=>step.id==='secret'));
  assert.equal(JSON.stringify(existing),snapshot);
  assert.ok(!JSON.stringify(plan).includes('NEVER_OUTPUT'));
});
test('custom hosting verifies custom paths and never offers wrangler install/deploy', () => {
  for(const provider of ['custom','vercel','netlify']){
    const plan=buildInstallationPlan({url:'https://example.com/',provider});
    const commands=plan.steps.flatMap(step=>step.commands).join('\n');
    assert.match(commands,/protect verify --provider custom --paths/);
    assert.doesNotMatch(commands,/wrangler|protect install/);
  }
  const pages=buildInstallationPlan({url:'https://example.com/',provider:'github-pages'});
  assert.ok(pages.steps.some(step=>step.id==='hosting'));
  assert.ok(!pages.steps.flatMap(step=>step.commands).some(command=>command.includes('protect verify')));
});
test('shell arguments reject injection, controls, URL credentials and escaping assets', () => {
  for(const input of ["bad'arg",'$(touch secret)','`whoami`','bad\narg','bad"arg','bad\u001barg']) assert.throws(()=>quoteArgument(input));
  assert.equal(quoteArgument('build output'),'\'build output\'');
  for(const assets of ['../private','/private','C:\\private','dist/../private','dist\\..\\private','.']) assert.throws(()=>buildInstallationPlan({url:'https://example.com/',assets}));
  for(const url of ['http://example.com/','https://user:pass@example.com/','https://example.com/?token=secret']) assert.throws(()=>buildInstallationPlan({url}));
});
test('offline/plan wizard never mutates project or calls auth even with apply', async () => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-wizard-'));
  try {
    await writeFile(join(root,'index.html'),'<html>existing</html>');
    const before=await readFile(join(root,'index.html'),'utf8');
    for(const mode of ['offline','plan','json']){
      const result=await wizardProject({root,url:'https://example.com/',apply:true,[mode]:true},{initProject:()=>assert.fail('plan must not initialize'),updateProtection:()=>assert.fail('plan must not update')});
      assert.equal(result.completed,false);
    }
    assert.deepEqual(await readdir(root),['index.html']);
    assert.equal(await readFile(join(root,'index.html'),'utf8'),before);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('actual CLI JSON plan and help are usable without writes', async () => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-wizard-cli-'));
  const bin=fileURLToPath(new URL('../bin/nakwol-connect.mjs',import.meta.url));
  try {
    const result=JSON.parse(execFileSync(process.execPath,[bin,'wizard','--json','--url','https://example.com/','--root',root],{encoding:'utf8'}));
    assert.equal(result.kind,'installation-plan');
    assert.deepEqual(await readdir(root),[]);
    const help=execFileSync(process.execPath,[bin,'help'],{encoding:'utf8'});
    assert.match(help,/wizard/);
    assert.throws(()=>execFileSync(process.execPath,[bin,'wizard','--json','--url','http://bad.example.com/','--root',root],{stdio:'pipe'}));
  } finally {await rm(root,{recursive:true,force:true});}
});
test('explicit apply updates saved gate only and blocks changing its settings', async () => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-wizard-existing-'));
  const config={version:2,clientId:'saved',authMode:'required',accessPolicy:'admin',redirectUris:['https://example.com/'],protection:{provider:'cloudflare-pages',siteUrl:'https://example.com/',projectName:'saved-site',assetsDirectory:'build'}};
  try {
    await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify(config));
    const before=await readFile(join(root,'.nakwol-connect.json'),'utf8');
    let updated=0;
    const dependencies={initProject:()=>assert.fail('existing app must not initialize'),updateProtection:async()=>{updated++;return {ok:true};}};
    const result=await wizardProject({root,apply:true},dependencies);
    assert.equal(updated,1);
    assert.equal(result.completed,false);
    assert.equal(result.appliedStage,'gate');
    await assert.rejects(()=>wizardProject({root,apply:true,assets:'other'},dependencies),/기존 설정 변경/);
    assert.equal(updated,1);
    assert.equal(await readFile(join(root,'.nakwol-connect.json'),'utf8'),before);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('interactive decline renders the plan without initializing', async () => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-wizard-interactive-'));
  const answers=['custom','https://example.com/','','','','','n'];
  let closed=false;
  try {
    const result=await wizardProject({root,interactive:true,output:()=>{}},{createInterface:()=>({question:async()=>answers.shift(),close:()=>{closed=true;}}),initProject:()=>assert.fail('decline must not initialize')});
    assert.equal(result.provider,'custom');
    assert.equal(result.completed,false);
    assert.equal(closed,true);
    assert.deepEqual(await readdir(root),[]);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('human plan is explanatory without raw config', () => {
  const lines=[];
  renderInstallationPlan(buildInstallationPlan({url:'https://example.com/'}),value=>lines.push(value));
  assert.ok(lines.some(value=>value.includes('설치 계획 준비')));
  assert.ok(lines.some(value=>value.includes('비밀키')));
  assert.ok(!lines.join('\n').includes('"steps"'));
});
test('managed update pins the runtime before build and Pages asks for actual branch', () => {
  const plan=buildInstallationPlan({url:'https://example.com/',existing:{clientId:'saved',protection:{provider:'cloudflare-pages',projectName:'my-site',updateChannel:'managed'}}});
  assert.ok(plan.steps.findIndex(step=>step.id==='runtime') < plan.steps.findIndex(step=>step.id==='build'));
  assert.match(plan.steps.find(step=>step.id==='runtime').commands[0],/--save-dev --save-exact nakwol-connect@0\.7\.8/);
  assert.match(plan.steps.find(step=>step.id==='deploy').commands[0],/--branch YOUR_PRODUCTION_BRANCH/);
  assert.match(plan.steps.find(step=>step.id==='verify').commands[0],/^npx --yes nakwol-connect@0\.7\.8/);
});
