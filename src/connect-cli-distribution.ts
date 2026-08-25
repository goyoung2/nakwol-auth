import type { Hono } from 'hono';
import cliPackageBase64 from './assets/nakwol-connect-cli.tgz.b64.js.txt';
import type { Env } from './types';

export const CONNECT_CLI_VERSION = '0.2.1';
export const CONNECT_CLI_PACKAGE_NAME = 'nakwol-connect';

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.trim());
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function packageResponse(cacheControl: string): Response {
  return new Response(decodeBase64(cliPackageBase64), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="nakwol-connect-${CONNECT_CLI_VERSION}.tgz"`,
      'Cache-Control': cacheControl,
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function registerConnectCliDistributionRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/cli/package.tgz', () => packageResponse('public, max-age=300'));
  app.get(`/connect/cli/v${CONNECT_CLI_VERSION}/package.tgz`, () => packageResponse('public, max-age=31536000, immutable'));

  app.get('/connect/cli/manifest.json', (c) => {
    const origin = c.env.AUTH_ORIGIN.replace(/\/$/, '');
    const tarball = `${origin}/connect/cli/package.tgz`;
    const response = c.json({
      ok: true,
      name: CONNECT_CLI_PACKAGE_NAME,
      version: CONNECT_CLI_VERSION,
      npm_command: 'npx nakwol-connect init',
      npm_doctor_command: 'npx nakwol-connect doctor --json',
      tarball,
      fallback_command: `npm exec --yes --package=${tarball} -- nakwol-connect init`,
      fallback_doctor_command: `npm exec --yes --package=${tarball} -- nakwol-connect doctor --json`,
      auth_origin: origin,
    });
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Cache-Control', 'public, max-age=300');
    return response;
  });

  app.get('/llms.txt', (c) => {
    const origin = c.env.AUTH_ORIGIN.replace(/\/$/, '');
    return c.text(`# NAKWOL AUTH / NAKWOL Connect\n\n## Preferred integration for coding agents\n\nDo not hand-edit OAuth flows. Use the official NAKWOL Connect CLI.\n\nPreferred npm command:\n\n    npx --yes nakwol-connect init\n\nAfter installation always run:\n\n    npx --yes nakwol-connect doctor --json\n\nRegistry-independent fallback:\n\n    npm exec --yes --package=${origin}/connect/cli/package.tgz -- nakwol-connect init\n\nThe CLI detects the framework, authenticates through NAKWOL Connect device authorization when required, registers or reuses the central app, edits the project idempotently, writes .nakwol-connect.json, and verifies the integration.\n\n## Machine-readable metadata\n\n- CLI manifest: ${origin}/connect/cli/manifest.json\n- Universal Embed: ${origin}/connect/v1.js\n- Web SDK: ${origin}/sdk/v0.1.0/nakwol-auth-web.js\n- Admin apps: ${origin}/admin/apps\n- Admin developers: ${origin}/admin/developers\n`, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
  });
}
