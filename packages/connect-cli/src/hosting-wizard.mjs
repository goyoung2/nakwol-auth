import {createInterface} from 'node:readline/promises';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {readProjectConfig} from './config.mjs';
import {parseHosting} from './shared/hosting-schema.mjs';
import {planHosting} from './hosting-connection.mjs';
export async function hostingWizard(options={}){
 const root=options.root||process.cwd(),config=await readProjectConfig(root);
 if(!config?.protection)throw new Error('Install the official server gate before connecting hosting.');
 if(!options.ask&&!process.stdin.isTTY)throw new Error('Interactive hosting wizard needs a terminal; use --hosting-file for non-interactive CI.');
 const terminal=options.ask?null:createInterface({input:process.stdin,output:process.stderr});const ask=options.ask||(prompt=>terminal.question(prompt));
 try{
  const provider=config.protection.provider,vercel=provider==='vercel';let resourceId=config.clientId;
  if(!vercel)resourceId=JSON.parse(await readFile(resolve(root,'wrangler.nakwol.json'))).name;
  const accountId=vercel?'':(await ask('Cloudflare account ID (32 hex, not a token): ')).trim();
  if(vercel)resourceId=(await ask('Vercel project ID (prj_...): ')).trim();
  const teamId=vercel?(await ask('Vercel team ID (team_...): ')).trim():'';
  const extras=(await ask('Additional HTTPS origins, comma-separated (or empty): ')).split(',').map(v=>v.trim()).filter(Boolean);
  const automatic=provider!=='cloudflare-pages'&&String(await ask('Native verified deployment and rollback? Type automatic, or Enter for manual: ')||'').trim()==='automatic';
  const controlledDeployments=automatic&&String(await ask('Disable other deployment paths and serialize all writes through this workflow? Type yes: ')||'').trim()==='yes';
  const binding=parseHosting({schemaVersion:1,clientId:config.clientId,siteOrigin:new URL(config.protection.siteUrl).origin,provider,accountId,resourceId,teamId,mode:automatic?'automatic':'manual',controlledDeployments,origins:[...new Set([new URL(config.protection.siteUrl).origin,...extras])],adapterFile:automatic?'.nakwol/hosting-adapter.mjs':''});
  const file=resolve(root,options.hostingFile||'nakwol-hosting.json');await writeFile(file,JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
  const result=await planHosting({...options,root,hostingFile:file});return {...result,status:'wizard-exported-not-connected',hostingFile:file,nextSteps:['Review the exported public identifiers, then run protect hosting connect --hosting-file nakwol-hosting.json.',...result.nextSteps]};
 }finally{terminal?.close();}
}
