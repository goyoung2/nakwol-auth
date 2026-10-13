import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_DATA_ORIGIN, parseDataScopes } from './scopes.mjs';

const EMBED_URL = 'https://nakwol-auth.sepsd21.workers.dev/connect/v1.js';
function embedOrigin(options = {}) { const value=options.authOrigin || new URL(EMBED_URL).origin; const url=new URL(value); const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname); if ((url.protocol!=='https:' && !(url.protocol==='http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('CONNECT_INVALID_AUTH_ORIGIN'); return url.origin; }
const HTML_START = '<!-- NAKWOL-CONNECT:START -->';
const HTML_END = '<!-- NAKWOL-CONNECT:END -->';
const JSX_START = '{/* NAKWOL-CONNECT:START */}';
const JSX_END = '{/* NAKWOL-CONNECT:END */}';
const NEXT_IMPORT = "import Script from 'next/script'; // NAKWOL-CONNECT:IMPORT";
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function replaceBlock(source, start, end, replacement) { const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm'); return re.test(source) ? source.replace(re, replacement) : null; }
function authMode(value) { const mode=String(value || 'required').trim().toLowerCase(); if(!['required','optional'].includes(mode)) throw new Error('CONNECT_INVALID_AUTH_MODE'); return mode; }
function attrs(clientId, options = {}) {
  const dataOrigin = options.dataOrigin == null ? null : String(options.dataOrigin || DEFAULT_DATA_ORIGIN).replace(/\/$/, '');
  const dataScopes = options.dataScopes == null ? null : parseDataScopes(options.dataScopes).join(',');
  const lines = [`  data-client-id="${clientId}"`, `  data-auth="${authMode(options.authMode)}"`];
  if (options.authOrigin) lines.push(`  data-auth-origin="${embedOrigin(options)}"`);
  if (options.serverGate) lines.push('  data-server-gate="true"');
  if (options.serverGate && options.siteUrl) lines.push(`  data-redirect-uri="${options.siteUrl}"`);
  if (dataOrigin != null) lines.push(`  data-data-origin="${dataOrigin}"`);
  if (dataScopes != null) lines.push(`  data-data-scopes="${dataScopes}"`);
  return lines.join('\n');
}
function htmlBlock(clientId, options) { return `${HTML_START}\n<script\n  src="${embedOrigin(options)}/connect/v1.js"\n${attrs(clientId, options)}>\n</script>\n${HTML_END}`; }
function jsxBlock(clientId, options) { return `${JSX_START}\n<Script\n  src="${embedOrigin(options)}/connect/v1.js"\n${attrs(clientId, options)}\n  strategy="afterInteractive"\n/>\n${JSX_END}`; }
function installHtml(source, clientId, options) {
  const block = htmlBlock(clientId, options); const replaced = replaceBlock(source, HTML_START, HTML_END, block); if (replaced != null) return replaced;
  const index = source.toLowerCase().lastIndexOf('</body>'); if (index < 0) throw new Error('CONNECT_HTML_BODY_NOT_FOUND'); return `${source.slice(0,index)}${block}\n${source.slice(index)}`;
}
function installNext(source, clientId, options) {
  let value = source; if (!/from\s+['"]next\/script['"]/.test(value)) value = `${NEXT_IMPORT}\n${value}`;
  const block = jsxBlock(clientId, options); const replaced = replaceBlock(value, JSX_START, JSX_END, block); if (replaced != null) return replaced;
  const bodyIndex=value.lastIndexOf('</body>'); if(bodyIndex>=0) return `${value.slice(0,bodyIndex)}${block}\n${value.slice(bodyIndex)}`;
  const componentIndex=value.search(/<Component\b/); if(componentIndex>=0) return `${value.slice(0,componentIndex)}${block}\n${value.slice(componentIndex)}`; throw new Error('CONNECT_NEXT_INSERTION_POINT_NOT_FOUND');
}
export async function installIntegration(root, project, clientId, options = undefined) {
  if (!project?.targetFile) throw new Error('CONNECT_UNSUPPORTED_PROJECT');
  const path=join(root,project.targetFile); const original=await readFile(path,'utf8');
  const next=project.framework==='next_app'||project.framework==='next_pages'?installNext(original,clientId,options):installHtml(original,clientId,options);
  if(next!==original) await writeFile(path,next); return {changedFiles:next===original?[]:[project.targetFile],integration:project.framework.startsWith('next_')?'next-script':'universal-embed'};
}
export async function inspectIntegration(root, project) {
  const missing={present:false,clientId:null,authMode:'required',dataOrigin:null,dataScopes:[],authOrigin:null};
  if(!project?.targetFile) return missing;
  try {
    const source=await readFile(join(root,project.targetFile),'utf8');
    const marker=source.split('NAKWOL-CONNECT:START')[1]?.split('NAKWOL-CONNECT:END')[0] || '';
    const match=name=>marker.match(new RegExp(name+"=[\"']([^\"']*)[\"']"))?.[1]??null;
    const src=match('src');
    const origin=match('data-auth-origin') || (src ? new URL(src).origin : null);
    return {present:source.includes('NAKWOL-CONNECT:START'),clientId:match('data-client-id'),authMode:authMode(match('data-auth')||'required'),dataOrigin:match('data-data-origin'),dataScopes:parseDataScopes(match('data-data-scopes')||''),authOrigin:origin};
  } catch { return missing; }
}
export async function removeIntegration(root, project) {
  if(!project?.targetFile) return {changedFiles:[]}; const path=join(root,project.targetFile); const original=await readFile(path,'utf8');
  const next=original.replace(new RegExp(`${escapeRegExp(HTML_START)}[\\s\\S]*?${escapeRegExp(HTML_END)}\\s*`,'m'),'').replace(new RegExp(`${escapeRegExp(JSX_START)}[\\s\\S]*?${escapeRegExp(JSX_END)}\\s*`,'m'),'').replace(new RegExp(`${escapeRegExp(NEXT_IMPORT)}\\s*`,'g'),'');
  if(next!==original) await writeFile(path,next); return {changedFiles:next===original?[]:[project.targetFile]};
}
export const connectMarkers={HTML_START,HTML_END,JSX_START,JSX_END,NEXT_IMPORT,EMBED_URL};
