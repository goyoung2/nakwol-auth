import { source } from './shared.mjs';
export { capabilities, inspect } from './shared.mjs';
const WRANGLER_FILE='wrangler.nakwol.json';
const GENERATED='.nakwol/server';
export async function generate({settings,projectName}, {directory}) {
 const {gate,login,session}=await source();
return {
    [`${directory}/_worker.js`]: `${session.replace(/^export /gm, '')}
${login.replace(/^export /gm, '')}\n${gate.replace(/^export /gm, '').replace("import { serveServerSession } from './session.mjs';", '').replace("import { loginPage } from './login.mjs';", '')}\nconst settings = ${JSON.stringify(settings)};\nexport default { fetch(request, env) { return serveProtected(request, env, settings); } };\n`,
    [`${directory}/_routes.json`]: JSON.stringify({ version:1, include:['/*'], exclude:[] }, null, 2) + '\n',
    [WRANGLER_FILE]: JSON.stringify({ name:projectName, pages_build_output_dir:directory, compatibility_date:'2026-09-01' }, null, 2) + '\n',
  };
}
