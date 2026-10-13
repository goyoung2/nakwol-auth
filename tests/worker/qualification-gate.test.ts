import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/index';
import { createAuthFixture } from './auth-fixture';
import { upsertMembership } from '../../src/store';
import { sha256Base64Url } from '../../src/crypto';
import { createGate } from '../../packages/connect-cli/src/server/gate.mjs';

test('existing common gate accepts application qualifications and keeps asset requests local', async t => {
  const { env, DB, dispose } = await createAuthFixture();
  t.after(dispose);
  const role = '1553600098661957644';
  await upsertMembership(env, 'user', true, 'user', [role]);
  await DB.prepare("INSERT INTO application_settings(client_id,access_policy,created_at,updated_at) VALUES('site','member',0,0)").run();
  await DB.prepare("INSERT INTO membership_qualifications VALUES('next-season','Next season',?,'active',0,0)").bind(role).run();
  await DB.prepare("INSERT INTO application_qualification_requirements VALUES('site','any','[\"next-season\"]',0)").run();
  const token = 'qualification-gate-fixture';
  await DB.prepare("INSERT INTO access_tokens VALUES(?,'user','site',?,NULL,0)").bind(await sha256Base64Url(token),Date.now()+3600000).run();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    calls++;
    const request = new Request(input, init);
    assert.equal(new URL(request.url).pathname, '/me');
    return app.fetch(request, env);
  });
  const gate = createGate({clientId:'site',accessPolicy:'member',authOrigin:'https://auth.test',siteUrl:'https://site.test/'});
  let served = 0;
  const host = {sessionSecret:'local-test-secret-at-least-thirty-two-characters',serveAsset:async()=>{served++;return new Response('protected asset');}};
  for (const path of ['/', '/image.webp', '/data.json', '/app.js', '/style.css', '/font.woff2']) {
    for (const method of ['GET','HEAD']) {
      const denied = await gate(new Request('https://site.test'+path,{method}),host);
      assert.equal(denied.status,401);
      assert.equal((await denied.arrayBuffer()).byteLength,0);
    }
    assert.equal((await gate(new Request('https://site.test'+path,{headers:{Range:'bytes=0-8'}}),host)).status,401);
  }
  assert.equal(served,0);
  const login = await gate(new Request('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:token})}),host);
  assert.equal(login.status,204);
  assert.equal(calls,1);
  const cookie = login.headers.get('Set-Cookie')?.split(';')[0];
  assert.ok(cookie);
  const images = await Promise.all(Array.from({length:300},(_,i)=>gate(new Request(`https://site.test/image-${i}.webp`,{headers:{Cookie:cookie}}),host)));
  assert.ok(images.every(response=>response.status===200));
  assert.equal(calls,1,'300 authenticated images must add zero central calls');
  assert.equal(served,300);
  const otherSite = createGate({clientId:'different',accessPolicy:'member',authOrigin:'https://auth.test',siteUrl:'https://site.test/'});
  assert.equal((await otherSite(new Request('https://site.test/image.webp',{headers:{Cookie:cookie}}),host)).status,401);
  await DB.prepare("UPDATE membership_qualifications SET status='disabled' WHERE id='next-season'").run();
  const rejected = await gate(new Request('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:token})}),host);
  assert.equal(rejected.status,403);
  assert.equal(served,300);
});
