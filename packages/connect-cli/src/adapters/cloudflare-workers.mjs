import { source } from './shared.mjs';
export { capabilities, inspect } from './shared.mjs';
const WRANGLER_FILE='wrangler.nakwol.json';
const GENERATED='.nakwol/server';
export async function generate({settings,projectName}, {directory}) {
 const {gate,login,session,control,observations}=await source();
return {
    [`${GENERATED}/gate.mjs`]: gate,
    [`${GENERATED}/session.mjs`]: session,
    [`${GENERATED}/control.mjs`]:control,
    [`${GENERATED}/observations.mjs`]:observations,
    [`${GENERATED}/login.mjs`]: login,
    [`${GENERATED}/index.mjs`]: `import { serveProtected } from './gate.mjs';\nconst settings = ${JSON.stringify(settings)};\nexport default { fetch(request, env, ctx) { return serveProtected(request, {...env,NAKWOL_WAIT_UNTIL:ctx?.waitUntil?.bind(ctx)}, settings); } };\n`,
    [WRANGLER_FILE]: JSON.stringify({ name: settings.clientId, main: `${GENERATED}/index.mjs`, compatibility_date: '2026-09-01', workers_dev: true, preview_urls: false, assets: { directory, binding: 'ASSETS', run_worker_first: true } }, null, 2) + '\n',
  };
}
