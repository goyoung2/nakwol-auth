import type { Hono } from 'hono';
import cliTarballBase64 from './assets/nakwol-connect-cli.tgz.b64.txt';
import type { Env } from './types';

export const NAKWOL_CONNECT_CLI_VERSION = '0.2.0';
export const NAKWOL_CONNECT_CLI_PATH = `/connect/cli/v${NAKWOL_CONNECT_CLI_VERSION}/nakwol-connect.tgz`;

function decodeBase64(value: string): Uint8Array {
  const clean = value.trim();
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function parseRedirectUris(raw: string): string[] {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function frameworkRecipe(framework: string) {
  const recipes: Record<string, { file_hint: string; strategy: string }> = {
    vite: { file_hint: 'index.html', strategy: 'insert universal embed before </body>' },
    react: { file_hint: 'index.html', strategy: 'insert universal embed before </body>' },
    vue: { file_hint: 'index.html', strategy: 'insert universal embed before </body>' },
    cra: { file_hint: 'public/index.html', strategy: 'insert universal embed before </body>' },
    sveltekit: { file_hint: 'src/app.html', strategy: 'insert universal embed before </body>' },
    next_app: { file_hint: 'app/layout.tsx or src/app/layout.tsx', strategy: 'use next/script in root layout when safely patchable' },
    next_pages: { file_hint: 'pages/_app.tsx or src/pages/_app.tsx', strategy: 'use next/script when safely patchable; otherwise agent performs source edit' },
    html: { file_hint: 'index.html', strategy: 'insert universal embed before </body>' },
    other: { file_hint: 'project-specific entry document', strategy: 'agent inspects project and follows Universal Embed contract' },
  };
  return recipes[framework] || recipes.other;
}

export function registerConnectCliDistributionRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get(NAKWOL_CONNECT_CLI_PATH, () => {
    const bytes = decodeBase64(cliTarballBase64);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': 'attachment; filename="nakwol-connect-0.2.0.tgz"',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.get('/connect/cli/manifest.json', (c) => {
    const origin = new URL(c.req.url).origin;
    const response = c.json({
      ok: true,
      name: '@nakwol/connect',
      bin: 'nakwol-connect',
      version: NAKWOL_CONNECT_CLI_VERSION,
      tarball: `${origin}${NAKWOL_CONNECT_CLI_PATH}`,
      install_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} init`,
      format: 'npm-tarball',
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  });

  app.get('/connect/agent/:clientId', async (c) => {
    const clientId = c.req.param('clientId');
    const row = await c.env.DB.prepare(
      `SELECT a.client_id,a.name,a.redirect_uris,a.status,
              s.homepage_url,s.framework,s.access_policy
         FROM applications a
         LEFT JOIN application_settings s ON s.client_id=a.client_id
        WHERE a.client_id=?`
    ).bind(clientId).first<{
      client_id: string;
      name: string;
      redirect_uris: string;
      status: string;
      homepage_url: string | null;
      framework: string | null;
      access_policy: string | null;
    }>();
    if (!row) return c.json({ ok: false, error: { code: 'APP_NOT_FOUND', message: '등록된 NAKWOL Connect 앱을 찾을 수 없습니다.' } }, 404);
    const origin = new URL(c.req.url).origin;
    const framework = row.framework || 'other';
    const response = c.json({
      ok: true,
      data: {
        contract_version: 1,
        service: 'nakwol-connect',
        client_id: row.client_id,
        name: row.name,
        status: row.status,
        homepage_url: row.homepage_url,
        redirect_uris: parseRedirectUris(row.redirect_uris),
        framework,
        access_policy: row.access_policy || 'public',
        integration: {
          preferred: 'cli',
          fallback: 'universal-embed',
          universal_embed: `${origin}/connect/v1.js`,
          ready_event: 'nakwol-ready',
          logout_event: 'nakwol-logout',
        },
        cli: {
          version: NAKWOL_CONNECT_CLI_VERSION,
          tarball: `${origin}${NAKWOL_CONNECT_CLI_PATH}`,
          init_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} init`,
          status_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} status`,
          doctor_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} doctor`,
        },
        framework_recipe: frameworkRecipe(framework),
        rules: [
          'Inspect the repository instead of asking the human where to edit.',
          'Do not implement Discord OAuth independently.',
          'Never place CLI bearer tokens in project files.',
          'Run doctor after any integration change.',
        ],
      },
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=60');
    return response;
  });
}
