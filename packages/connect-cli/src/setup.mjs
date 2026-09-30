import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseSetup,SetupError} from './shared/setup-schema.mjs';
import {readProjectConfig} from './config.mjs';
import {readSession,ensureSession} from './session.mjs';
import {ConnectApi} from './api.mjs';
import {detectProject} from './project.mjs';

export async function prepareSetup(options={}) {
  if(!options.setupFile)throw new SetupError('SETUP_FILE_REQUIRED');
  const root=options.root||process.cwd(),path=resolve(root,options.setupFile);
  if((await stat(path)).size>16384)throw new SetupError('SETUP_FILE_TOO_LARGE');
  const setup=parseSetup(JSON.parse(await readFile(path,'utf8')));
  const current=await readProjectConfig(root);
  const authOrigin=options.authOrigin||current?.authOrigin||'https://nakwol-auth.sepsd21.workers.dev';
  const authUrl=new URL(authOrigin);
  if(authUrl.protocol!=='https:'||authUrl.origin!==authOrigin||authUrl.username||authUrl.password)throw new SetupError('SETUP_INVALID_AUTH_ORIGIN');
  for(const [key,value] of Object.entries({clientId:setup.clientId,provider:setup.provider,assets:setup.buildDirectory,url:setup.siteOrigin+'/'})) {
    if(options[key]!==undefined&&options[key]!==value)throw new SetupError('SETUP_OPTION_CONFLICT',key);
  }
  if(current&&(current.clientId!==setup.clientId||current.authOrigin!==authOrigin||current.authMode!=='required'))throw new SetupError('SETUP_PROJECT_CONFLICT');
  const stored=await readSession(options.sessionPath);
  const session=stored&&(!stored.authOrigin||stored.authOrigin===authOrigin)?stored:await ensureSession({...options,authOrigin});
  const api=new ConnectApi({authOrigin,accessToken:session.accessToken,fetchImpl:options.fetchImpl});
  const {payload}=await api.request(`/connect/cli/apps/${encodeURIComponent(setup.clientId)}/setup/${setup.idempotencyKey}`,{signal:AbortSignal.timeout(15000)});
  const central=payload.data;
  if(!central||central.stale!==false)throw new SetupError('SETUP_CONFLICT_OR_STALE');
  const currentSetup=parseSetup(central.setup);
  if(Object.entries(setup).some(([key,value])=>key!=='step'&&currentSetup[key]!==value))throw new SetupError('SETUP_CONFLICT_OR_STALE');
  const app=central.app;
  if(app?.client_id!==setup.clientId||app.status&&app.status!=='active'||!['member','guest','admin'].includes(app.access_policy)||!Array.isArray(app.redirect_uris)||!app.redirect_uris.includes(setup.siteOrigin+'/')||!app.redirect_uris.includes(setup.siteOrigin+'/__nakwol/callback'))throw new SetupError('SETUP_APP_UNAVAILABLE');
  const project=await detectProject(root);
  const config={...current,clientId:setup.clientId,framework:project.framework,authMode:'required',authOrigin,
    accessPolicy:app.access_policy,redirectUris:app.redirect_uris,dataScopes:current?.dataScopes||[],
    ...(!current?{dataIntegration:'none'}:{}),setup:{id:setup.idempotencyKey,presentationVersion:setup.presentationVersion,policyVersion:setup.policyVersion}};
  const previous={clientId:current?.clientId??null,provider:current?.protection?.provider??null,buildDirectory:current?.protection?.assetsDirectory??null,siteOrigin:current?.protection?.siteUrl?.replace(/\/$/,'')??null,presentationVersion:current?.setup?.presentationVersion??null,policyVersion:current?.setup?.policyVersion??null};
  const desired={clientId:setup.clientId,provider:setup.provider,buildDirectory:setup.buildDirectory,siteOrigin:setup.siteOrigin,presentationVersion:setup.presentationVersion,policyVersion:setup.policyVersion};
  return {config,setup,options:{...options,provider:setup.provider,assets:setup.buildDirectory,url:setup.siteOrigin+'/'},
    diff:Object.keys(desired).filter(key=>previous[key]!==desired[key]).map(field=>({field,before:previous[field],after:desired[field]})),
    status:{central:'saved',localInstallation:'unverified',deployment:'unverified',acceptance:'unverified'}};
}
export async function planSetup(options={}) {
  const prepared=await prepareSetup(options);
  return {ok:true,setup:prepared.setup,diff:prepared.diff,setupStatus:prepared.status};
}
