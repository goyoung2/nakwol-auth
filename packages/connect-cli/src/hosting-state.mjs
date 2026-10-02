import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export const MAX_HOSTING_EVIDENCE_BYTES=8*1024*1024;
const context=binding=>JSON.stringify({schemaVersion:1,clientId:binding.clientId,siteOrigin:binding.siteOrigin,provider:binding.provider,resourceId:binding.resourceId,accountId:binding.accountId,teamId:binding.teamId});
function key(value){if(!/^[a-fA-F0-9]{64}$/.test(value||''))throw new Error('NAKWOL_RELEASE_STATE_KEY must be a private 32-byte hex key.');return Buffer.from(value,'hex');}
export function sealHostingState(binding,state,secret){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);cipher.setAAD(Buffer.from(context(binding)));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(state)),cipher.final()]);
 if(encrypted.length>MAX_HOSTING_EVIDENCE_BYTES)throw new Error('Hosting baseline exceeds 8 MiB.');
 return JSON.stringify({schemaVersion:1,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),data:encrypted.toString('base64')});
}
export function openHostingState(binding,encoded,secret){
 try{
  if(typeof encoded!=='string'||encoded.length>12*1024*1024)throw new Error();
  const envelope=JSON.parse(encoded);if(envelope.schemaVersion!==1||!/^[a-f0-9]{24}$/.test(envelope.iv||'')||!/^[a-f0-9]{32}$/.test(envelope.tag||'')||typeof envelope.data!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.data))throw new Error();
  const cipher=createDecipheriv('aes-256-gcm',key(secret),Buffer.from(envelope.iv,'hex'));cipher.setAAD(Buffer.from(context(binding)));cipher.setAuthTag(Buffer.from(envelope.tag,'hex'));
  const state=JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.data,'base64')),cipher.final()]).toString('utf8'));
  if(state.schemaVersion!==1||!state.manifest||!state.report)throw new Error();return state;
 }catch{throw new Error('Hosting baseline is invalid, modified or bound to another site.');}
}
