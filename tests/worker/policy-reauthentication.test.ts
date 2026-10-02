import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../../src/index';
import {createSession, upsertMembership} from '../../src/store';
import {authFixture} from '../helpers/auth-d1';

test('prompt login requests fresh Discord identity without revoking another app SSO',async t=>{
 const {env,dispose}=await authFixture();t.after(dispose);
 await upsertMembership(env,'member',true,'member',['season3']);
 const session=await createSession(env,'member');
 const params=new URLSearchParams({client_id:'a',redirect_uri:'https://a.test/callback',code_challenge:'a'.repeat(43),code_challenge_method:'S256',response_type:'code',state:'fixture',prompt:'login'});
 const result=await app.request('https://auth.test/authorize?'+params,{headers:{Cookie:'nakwol_sid='+session.token}},env,{waitUntil(){},passThroughOnException(){},props:{}});
 assert.equal(result.status,302);
 assert.equal(new URL(result.headers.get('Location') || '').hostname,'discord.com');
 assert.doesNotMatch(result.headers.get('Set-Cookie') || '',/nakwol_sid=;/);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{n:number}>())?.n,1);
 params.set('client_id','b');params.set('redirect_uri','https://b.test/callback');params.set('prompt','none');
 const other=await app.request('https://auth.test/authorize?'+params,{headers:{Cookie:'nakwol_sid='+session.token}},env);
 assert.equal(new URL(other.headers.get('Location') || '').origin,'https://b.test');
 assert.ok(new URL(other.headers.get('Location') || '').searchParams.get('code'));
});
