import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {installProtection} from '../src/protection.mjs';
import {writeProjectConfig} from '../src/config.mjs';

test('generated Vercel middleware executes real next only after local member authorization',async t=>{
 const base=fileURLToPath(new URL('../../../.wrangler/commercial/vercel-deps/',import.meta.url));
 await mkdir(base,{recursive:true});const root=await mkdtemp(join(base,'vercel-runtime-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'dist'));
 await writeFile(join(root,'index.html'),'<html><body>private</body></html>');
 await writeFile(join(root,'dist/index.html'),'private');
 await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{build:'echo build'}}));
 await writeProjectConfig(root,{clientId:'runtime-site',authOrigin:'https://auth.test',framework:'html',redirectUris:['https://site.test/'],authMode:'required'});
 await installProtection({root,provider:'vercel',assets:'dist',url:'https://site.test/'});
 const originalFetch=globalThis.fetch,originalSecret=process.env.NAKWOL_SESSION_SECRET;
 t.after(()=>{globalThis.fetch=originalFetch;if(originalSecret===undefined)delete process.env.NAKWOL_SESSION_SECRET;else process.env.NAKWOL_SESSION_SECRET=originalSecret;});
 process.env.NAKWOL_SESSION_SECRET='vercel-runtime-test-secret-at-least-32-chars';
 let meCalls=0;
 globalThis.fetch=async(url)=>{
  if(String(url)==='https://auth.test/me?client_id=runtime-site'){meCalls++;return Response.json({ok:true,data:{id:'member',status:'active',membership:{is_member:true}},application_access:{client_id:'runtime-site',allowed:true,source:'policy'},expires_at:Date.now()+3600000});}
  if(String(url)==='https://auth.test/logout')return new Response(null,{status:204});
  throw new Error(`Unexpected outbound request: ${url}`);
 };
 const {default:middleware,config}=await import(pathToFileURL(join(root,'middleware.js')).href).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')throw new Error('Install @vercel/functions@3.9.9 in root or with npm install --prefix .wrangler/commercial/vercel-deps --no-package-lock @vercel/functions@3.9.9',{cause:error});
  throw error;
 });
 assert.deepEqual(config.matcher,['/:path*']);
 const paths=['/','/app.js','/style.css','/data.json','/image.webp','/font.woff2','/download.zip'];
 const variants=[{method:'GET'},{method:'HEAD'},{headers:{Range:'bytes=0-63'}},{headers:{'If-None-Match':'"private"'}}];
 for(const path of paths)for(const init of variants){const response=await middleware(new Request('https://site.test'+path,init));assert.equal(response.status,401);assert.equal(response.headers.get('x-middleware-next'),null);}
 assert.equal(meCalls,0);
 const login=await middleware(new Request('https://site.test/__nakwol/session',{method:'POST',headers:{Origin:'https://site.test','Content-Type':'application/json'},body:JSON.stringify({access_token:'fixture-only'})}));
 assert.equal(login.status,204);assert.equal(meCalls,1);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 for(const path of paths)for(const init of variants){const response=await middleware(new Request('https://site.test'+path,{...init,headers:{...init.headers,Cookie:cookie}}));assert.equal(response.headers.get('x-middleware-next'),'1');assert.match(response.headers.get('Cache-Control'),/private/);assert.equal(response.headers.get('X-Nakwol-Gate'),'v1');}
 await Promise.all(Array.from({length:300},(_,i)=>middleware(new Request(`https://site.test/images/${i}.webp`,{headers:{Cookie:cookie}})).then(response=>assert.equal(response.headers.get('x-middleware-next'),'1'))));
 assert.equal(meCalls,1,'valid lease adds no AUTH calls across all protected assets');
 const malformed=await middleware(new Request('https://site.test/image.webp',{headers:{Cookie:'__Host-nakwol_connect=invalid'}}));assert.equal(malformed.status,401);assert.equal(malformed.headers.get('x-middleware-next'),null);
 const logout=await middleware(new Request('https://site.test/__nakwol/logout',{method:'POST',headers:{Origin:'https://site.test',Cookie:cookie}}));assert.equal(logout.status,204);
 assert.equal((await middleware(new Request('https://site.test/image.webp',{headers:{Cookie:cookie}}))).status,401);
 // next() delegates downstream ETag/304 and CDN behavior to Vercel; this driver verifies middleware authorization only.
});
