import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'nakwol-hosting-packed-'));
function run(args,cwd){return new Promise((resolveResult,reject)=>{const child=spawn(process.execPath,args,{cwd,env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']}),out=[],err=[];child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>err.push(b));child.on('error',reject);child.on('close',code=>code===0?resolveResult(Buffer.concat(out).toString()):reject(new Error(Buffer.concat(err).toString()||`exit${code}`)));});}
try{
 if(!process.env.npm_execpath)throw new Error('Run npm run test:hosting.');
 const packed=JSON.parse(await run([process.env.npm_execpath,'pack','--json','--pack-destination',directory],resolve('packages/connect-cli'))),tarball=join(directory,packed[0].filename);
 for(const provider of ['cloudflare-workers','cloudflare-pages','vercel']){
  const root=join(directory,provider);await mkdir(root);await mkdir(join(root,'dist'));await writeFile(join(root,'index.html'),'<body>site</body>');await writeFile(join(root,'dist/index.html'),'private');await writeFile(join(root,'package.json'),JSON.stringify({private:true,scripts:{build:'node -e "console.log(1)"'}}));
  await run([process.env.npm_execpath,'install','--save-dev','--ignore-scripts','--no-audit','--no-fund',tarball],root);const cli=join(root,'node_modules/nakwol-connect/bin/nakwol-connect.mjs'),pkg=JSON.parse(await readFile(join(root,'package.json')));pkg.devDependencies['nakwol-connect']='0.14.0';await writeFile(join(root,'package.json'),JSON.stringify(pkg));
  const command=async(...args)=>JSON.parse(await run([cli,...args,'--json'],root));
  await writeFile(join(root,'.nakwol-connect.json'),JSON.stringify({version:2,clientId:'site',authMode:'required',accessPolicy:'member',redirectUris:['https://site.test/']}));await command('protect','install','--provider',provider,'--assets','dist','--url','https://site.test/');
  const binding={schemaVersion:1,clientId:'site',siteOrigin:'https://site.test',provider,accountId:provider==='vercel'?'':'a'.repeat(32),resourceId:provider==='vercel'?'prj_site':'site',teamId:provider==='vercel'?'team_site':'',mode:'manual',controlledDeployments:false,origins:['https://site.test'],adapterFile:''};await writeFile(join(root,'nakwol-hosting.json'),JSON.stringify(binding));
  const plan=await command('protect','hosting','plan','--hosting-file','nakwol-hosting.json');assert.equal(plan.status,'planned-not-connected');const connected=await command('protect','hosting','connect','--hosting-file','nakwol-hosting.json');assert.equal(connected.status,'configured-not-deployed');await command('protect','update');const status=await command('protect','status','--offline');assert.equal(status.ok,true);
  assert.equal(JSON.parse(await readFile(join(root,'.nakwol-connect.json'))).protection.hosting.provider,provider);console.log(JSON.stringify({provider,ok:true,flow:'packed SDK install/gate install/hosting plan/connect/update/offline status',version:status.installedPackageVersion}));
 }
}finally{await rm(directory,{recursive:true,force:true});}
