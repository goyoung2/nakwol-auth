import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { source } from './shared.mjs';
export { capabilities } from './shared.mjs';

export const files = ['.nakwol/server/gate.mjs','.nakwol/server/login.mjs','.nakwol/server/session.mjs','.nakwol/server/control.mjs','.nakwol/server/observations.mjs','middleware.js','vercel.json'];
const conflicts = ['middleware.js','middleware.ts','middleware.mjs','proxy.js','proxy.ts','proxy.mjs','src/middleware.js','src/middleware.ts','src/middleware.mjs','src/proxy.js','src/proxy.ts','src/proxy.mjs','vercel.json','vercel.ts','api','functions','.vercel/output'];
export async function inspect(root, protection) {
  for (const path of conflicts) {
    if (protection?.files && Object.hasOwn(protection.files,path)) continue;
    try { await access(join(root,path)); }
    catch (error) { if(error.code==='ENOENT') continue; throw error; }
    return {ok:false,detail:`기존 라우팅/서버 설정을 덮어쓸 수 없습니다: ${path}. Vercel 자동 설치는 정적 빌드 전용입니다.`};
  }
  return {ok:true};
}
export async function generate({settings, projectName}, {directory}) {
  const {gate,login,session,control,observations}=await source();
  return {
    '.nakwol/server/gate.mjs':gate,
    '.nakwol/server/login.mjs':login,
    '.nakwol/server/session.mjs':session,
    '.nakwol/server/control.mjs':control,
    '.nakwol/server/observations.mjs':observations,
    'middleware.js':`import { next, waitUntil } from '@vercel/functions';
import { createGate } from './.nakwol/server/gate.mjs';
const gate = createGate(${JSON.stringify(settings)});
export const config = { matcher: ['/:path*'] };
export default function middleware(request) {
  return gate(request, { waitUntil, sessionSecret:process.env.NAKWOL_SESSION_SECRET, siteCredential:process.env.NAKWOL_SITE_CREDENTIAL, controlProfile:process.env.NAKWOL_CONTROL_PROFILE, controlPublicKeys:process.env.NAKWOL_CONTROL_PUBLIC_KEYS, sessionPreviousSecret:process.env.NAKWOL_SESSION_PREVIOUS_SECRET, sessionPreviousUntil:Number(process.env.NAKWOL_SESSION_PREVIOUS_UNTIL), serveAsset:()=>next() });
}
`,
    'vercel.json':JSON.stringify({framework:null,outputDirectory:directory,buildCommand:'npm run build',name:projectName,version:2},null,2)+'\n',
  };
}
