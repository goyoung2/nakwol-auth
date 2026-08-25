import type { Hono } from 'hono';
import type { Env } from './types';
import { NAKWOL_CONNECT_CLI_PATH, NAKWOL_CONNECT_CLI_VERSION } from './connect-cli-distribution';

export function registerConnectLlmRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/connect/agent', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.json({
      ok: true,
      data: {
        contract_version: 1,
        service: 'nakwol-connect',
        mode: 'new-project',
        preferred_integration: 'cli',
        cli: {
          version: NAKWOL_CONNECT_CLI_VERSION,
          tarball: `${origin}${NAKWOL_CONNECT_CLI_PATH}`,
          init_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} init`,
          doctor_command: `npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} doctor`,
        },
        agent_rules: [
          'Run the CLI from the project repository root or a child path.',
          'Inspect the project automatically instead of asking the human where to edit.',
          'If device authorization is requested, surface the verification URL to the human and keep polling.',
          'Never request or store Cloudflare credentials, Discord secrets, or a NAKWOL CLI token in the project.',
          'Run doctor before declaring integration complete.',
        ],
      },
    });
  });

  app.get('/llms.txt', (c) => {
    const origin = new URL(c.req.url).origin;
    return c.text(`# NAKWOL AUTH / NAKWOL Connect\n\nNAKWOL Connect is the canonical authentication integration for NAKWOL web tools. Do not implement Discord OAuth independently.\n\n## Agent-first installation\n\nRun this from the target repository:\n\n    npx --yes ${origin}${NAKWOL_CONNECT_CLI_PATH} init\n\nIf the CLI displays a device authorization URL, show it to the human and continue after approval. Do not ask the human which source file to edit; inspect the repository and use the CLI.\n\n## Machine contracts\n\n- New project: ${origin}/connect/agent\n- Registered app: ${origin}/connect/agent/{client_id}\n- CLI manifest: ${origin}/connect/cli/manifest.json\n- Universal Embed fallback: ${origin}/connect/v1.js\n- Web SDK: ${origin}/sdk/v0.1.0/nakwol-auth-web.js\n\n## Verification\n\nRun the CLI doctor command after changes.\n`, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    });
  });
}
