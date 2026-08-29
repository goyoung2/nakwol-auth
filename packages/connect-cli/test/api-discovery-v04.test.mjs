import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectDataApi } from '../src/data-api.mjs';
import { dataDescribeProject, validateDataOpenApi } from '../src/discovery.mjs';

test('DATA describe fetches public OpenAPI without CLI Authorization', async () => {
  let seen;
  const api = new ConnectDataApi({ dataOrigin:'https://data.example', accessToken:'cli-secret', fetchImpl:async(input,init)=>{seen={input:String(input),init};return Response.json({openapi:'3.1.0',info:{version:'0.9.0'},paths:{'/v1/me':{get:{}}}});} });
  const doc = await api.describe();
  assert.equal(doc.openapi,'3.1.0');
  assert.equal(seen.input,'https://data.example/openapi.json');
  assert.equal(new Headers(seen.init.headers).has('Authorization'),false);
});

test('dataDescribeProject needs no CLI session and resolves project DATA origin', async () => {
  const root=await mkdtemp(join(tmpdir(),'nakwol-desc-'));
  try {
    await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:2,clientId:'deck-lab',framework:'vite',redirectUris:[],integration:'universal-embed',dataOrigin:'https://data.example/',dataScopes:['roster:read']}));
    let calls=0;
    const result=await dataDescribeProject({root,fetchImpl:async(input,init)=>{calls++;assert.equal(String(input),'https://data.example/openapi.json');assert.equal(new Headers(init?.headers||{}).has('Authorization'),false);return Response.json({openapi:'3.1.0',info:{version:'0.9.0'},'x-nakwol-data-scopes':['roster:read'],paths:{}});}});
    assert.equal(calls,1);
    assert.equal(result.ok,true);
    assert.equal(result.openapiUrl,'https://data.example/openapi.json');
    assert.equal(result.document.openapi,'3.1.0');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('OpenAPI doctor validation rejects invalid contract or missing configured scopes', () => {
  assert.deepEqual(validateDataOpenApi({openapi:'3.1.0','x-nakwol-data-scopes':['roster:read','decks:read']},['roster:read']),{ok:true,detail:'OpenAPI 3.1.0; 2 DATA scopes'});
  const invalidVersion=validateDataOpenApi({openapi:'3.0.3','x-nakwol-data-scopes':['roster:read']},['roster:read']);
  assert.equal(invalidVersion.ok,false);
  assert.match(invalidVersion.detail,/OpenAPI 3\.1/);
  const missing=validateDataOpenApi({openapi:'3.1.0','x-nakwol-data-scopes':['roster:read']},['decks:read']);
  assert.equal(missing.ok,false);
  assert.match(missing.detail,/decks:read/);
});
