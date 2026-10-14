import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { qualificationInput, selectQualifications } from '../src/qualifications.mjs';
import { initProject, syncProject, qualificationsProject } from '../src/commands.mjs';

const catalog = [{id:'season4',name:'시즌4',status:'active',developer_selectable:true},{id:'officer',name:'간부',status:'active',developer_selectable:true}];

test('qualification flags reject empty, contradictory and invalid input', () => {
  for (const options of [{qualifications:''},{qualifications:'a,'},{qualifications:'a',qualificationMatch:'ALL'},{qualificationMatch:'all'},{qualificationLegacy:true,qualifications:'a'}]) assert.throws(() => qualificationInput(options));
  assert.deepEqual(qualificationInput({qualifications:'season4,officer,season4',qualificationMatch:'all'}),{mode:'custom',match_mode:'all',qualification_ids:['season4','officer']});
});

test('TTY selector resolves display choices; blank and noninteractive preserve current conditions', async () => {
  const api = {listQualifications:async()=>({qualifications:catalog})};
  const answers=['2,1','all'];
  assert.deepEqual(await selectQualifications(api,{interactive:true,ask:async()=>answers.shift(),output:()=>{}}),{mode:'custom',match_mode:'all',qualification_ids:['officer','season4']});
  assert.equal(await selectQualifications(api,{interactive:true,ask:async()=>'',output:()=>{}}),null);
  const mustNotAsk = {listQualifications:async()=>{throw new Error('unexpected request');}};
  assert.equal(await selectQualifications(mustNotAsk,{}),null);
  assert.equal(await selectQualifications(mustNotAsk,{interactive:true,json:true}),null);
});

async function fixture(t, { existing = false, accessPolicy = 'member', failWrite = false } = {}) {
  const root = await mkdtemp(join(tmpdir(),'nakwol-qualifications-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const origin='https://auth.test';
  const app={client_id:'demo',redirect_uris:['http://localhost:5173/'],framework:'vite',access_policy:accessPolicy,status:'active'};
  const state={created:0,writes:[],policy:{mode:'custom',match_mode:'all',qualification_ids:['officer']},failWrite};
  await writeFile(join(root,'package.json'),JSON.stringify({name:'demo',dependencies:{vite:'^7'}}));
  await writeFile(join(root,'index.html'),'<html><body>demo</body></html>');
  const sessionPath=join(root,'session.json');
  await writeFile(sessionPath,JSON.stringify({accessToken:'test',expiresAt:Date.now()+60000,authOrigin:origin}));
  if(existing) await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:2,clientId:'demo',authOrigin:origin,authMode:'optional',accessPolicy,framework:'vite',redirectUris:app.redirect_uris,dataOrigin:origin,dataScopes:[]}));
  const fetchImpl=async(url, request={})=>{
    const path=new URL(url).pathname;
    const result=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
    if(path==='/connect/cli/me')return result({ok:true,data:{user:{id:'u'},connect:{developer_role:'developer'}}});
    if(path==='/connect/cli/qualifications')return result({ok:true,qualifications:catalog});
    if(path==='/connect/cli/apps'&&request.method==='POST'){state.created++;return result({ok:true,data:app},201);}
    if(path==='/connect/cli/apps/demo'){
      if(request.method==='PATCH')Object.assign(app,JSON.parse(request.body));
      return result({ok:true,data:app});
    }
    if(path.endsWith('/qualification-policy')){
      if(state.failRead && request.method !== 'PUT')return result({error:{code:'UNAVAILABLE',message:'policy read unavailable'}},503);
      if(request.method==='PUT'){
        if(state.failWrite)return result({error:{code:'INVALID_QUALIFICATION',message:'qualification rejected'}},400);
        state.policy=JSON.parse(request.body);state.writes.push(state.policy);
      }
      return result({ok:true,policy:state.policy,locked_qualification_ids:[]});
    }
    if(path.endsWith('/scopes'))return result({ok:true,data:{registered:true,status:'active',scopes:[],available_scopes:[]}});
    if(path==='/openapi.json')return result({openapi:'3.1.0','x-nakwol-data-scopes':[],paths:{}});
    throw new Error(`Unexpected request ${path}`);
  };
  return {root,state,app,options:{root,sessionPath,authOrigin:origin,dataOrigin:origin,fetchImpl,output:()=>{}}};
}

test('init stores selected qualifications and exposes the manager; sync without flags preserves custom conditions',async t=>{
  const f=await fixture(t);
  const result=await initProject({...f.options,qualifications:'season4,officer',qualificationMatch:'all',authMode:'optional'});
  assert.equal(result.ok,true);
  assert.deepEqual(f.state.writes,[{mode:'custom',match_mode:'all',qualification_ids:['season4','officer']}]);
  assert.equal(result.qualification.managerUrl,'https://auth.test/developer/apps?client_id=demo');
  await syncProject(f.options);
  assert.equal(f.state.writes.length,1);
});

test('policy failure preserves created identity and stops installation; retry does not duplicate app',async t=>{
  const f=await fixture(t,{failWrite:true});
  await assert.rejects(initProject({...f.options,qualifications:'season4'}),/qualification rejected/);
  assert.equal(JSON.parse(await readFile(join(f.root,'.nakwol-connect.json'),'utf8')).clientId,'demo');
  assert.doesNotMatch(await readFile(join(f.root,'index.html'),'utf8'),/NAKWOL-CONNECT:START/);
  f.state.failWrite=false;
  await initProject({...f.options,qualifications:'season4'});
  assert.equal(f.state.created,1);
});

test('nonmember qualification changes reject before access mutations',async t=>{
  const f=await fixture(t,{existing:true});
  await assert.rejects(syncProject({...f.options,accessPolicy:'guest',qualifications:'season4'}),/member/);
  assert.equal(f.app.access_policy,'member');
  assert.equal(f.state.writes.length,0);
});

test('qualification list, set and explicit reset use central contracts',async t=>{
  const f=await fixture(t,{existing:true});
  assert.deepEqual((await qualificationsProject('list',f.options)).qualifications,catalog);
  await qualificationsProject('set',{...f.options,qualifications:'season4'});
  await qualificationsProject('reset',f.options);
  assert.deepEqual(f.state.writes,[{mode:'custom',match_mode:'any',qualification_ids:['season4']},{mode:'legacy'}]);
});

test('real CLI fails malformed selection flags without starting login',()=>{
  const cli=new URL('../bin/nakwol-connect.mjs',import.meta.url);
  for(const args of [['init','--qualifications','--json'],['sync','--qualification-match','all'],['status','--qualifications','season4']]){
    const result=spawnSync(process.execPath,[fileURLToPath(cli),...args],{encoding:'utf8',timeout:5000});
    assert.equal(result.status,1,result.stderr);
    assert.doesNotMatch(result.stderr,/MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
  }
});

 test('invalid interactive selection preserves the new app for retry',async t=>{
  const f=await fixture(t);
  await assert.rejects(initProject({...f.options,interactive:true,ask:async()=> '999'}));
  assert.equal(JSON.parse(await readFile(join(f.root,'.nakwol-connect.json'),'utf8')).clientId,'demo');
  await initProject({...f.options,qualifications:'season4'});
  assert.equal(f.state.created,1);
});

test('noninteractive policy read failure preserves identity and retry reuses app',async t=>{
  const f=await fixture(t);
  f.state.failRead=true;
  await assert.rejects(initProject(f.options),/policy read unavailable/);
  assert.equal(JSON.parse(await readFile(join(f.root,'.nakwol-connect.json'),'utf8')).clientId,'demo');
  assert.doesNotMatch(await readFile(join(f.root,'index.html'),'utf8'),/NAKWOL-CONNECT:START/);
  f.state.failRead=false;
  await initProject(f.options);
  assert.equal(f.state.created,1);
});
