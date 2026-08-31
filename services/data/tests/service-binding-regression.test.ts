import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyPrincipal } from '../src/auth.ts';

const successAuthPayload = {
  ok: true,
  data: {
    id: 'usr_service_binding',
    display_name: 'Service Binding User',
    avatar_url: null,
    membership: { role: 'member' },
  },
};

test('DATA principal verification uses the AUTH service binding instead of public fetch', async () => {
  const calls: Array<{ url: string; authorization: string | null; origin: string | null }> = [];
  const env = {
    AUTH_ORIGIN: 'https://nakwol-auth.sepsd21.workers.dev',
    AUTH_SERVICE: {
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        calls.push({
          url: request.url,
          authorization: request.headers.get('Authorization'),
          origin: request.headers.get('Origin'),
        });
        return Response.json(successAuthPayload);
      },
    },
  } as any;
  const request = new Request('https://nakwol-data.sepsd21.workers.dev/v1/me', {
    headers: {
      Authorization: 'Bearer token_abc',
      'X-NAKWOL-CLIENT-ID': 'nakwol-auth-lab',
      Origin: 'https://nakwol-auth.sepsd21.workers.dev',
    },
  });

  const principal = await verifyPrincipal(request, env, async () => {
    throw new Error('public fetch must not be used for DATA -> AUTH');
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://nakwol-auth.sepsd21.workers.dev/me?client_id=nakwol-auth-lab');
  assert.equal(calls[0].authorization, 'Bearer token_abc');
  assert.equal(calls[0].origin, 'https://nakwol-auth.sepsd21.workers.dev');
  assert.equal(principal.userId, 'usr_service_binding');
  assert.equal(principal.clientId, 'nakwol-auth-lab');
});

test('DATA Wrangler config binds AUTH_SERVICE directly to nakwol-auth', async () => {
  const configText = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const config = JSON.parse(configText);
  assert.deepEqual(config.services, [{ binding: 'AUTH_SERVICE', service: 'nakwol-auth' }]);
  assert.equal((config.compatibility_flags ?? []).includes('global_fetch_strictly_public'), false);
});
