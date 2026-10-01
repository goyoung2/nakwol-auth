import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const runtime = new URL('../../../packages/connect-cli/src/server/', import.meta.url);
const shared = new URL('../../../packages/connect-cli/src/shared/', import.meta.url);
const moduleURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');

// A query on gate.mjs alone leaves its imported maps shared. Copy the complete
// stateful graph so each reported isolate has independent session/control queues.
async function isolate() {
  const id = randomUUID();
  const observations = await import(new URL('observations.mjs?benchmark=' + id, runtime));
  const control = new URL('control.mjs?benchmark=' + id, runtime).href;
  const login = new URL('login.mjs', runtime).href;
  const sessionSource = (await readFile(new URL('session.mjs', runtime), 'utf8'))
    .replace("'./control.mjs'", JSON.stringify(control))
    .replace("'./login.mjs'", JSON.stringify(login))
    .replace("'./observations.mjs'", JSON.stringify(new URL('observations.mjs?benchmark=' + id, runtime).href));
  const session = moduleURL(sessionSource + '\n// isolate ' + id);
  const gateSource = (await readFile(new URL('gate.mjs', runtime), 'utf8'))
    .replace("'./login.mjs'", JSON.stringify(login)).replace("'./session.mjs'", JSON.stringify(session));
  return { ...(await import(moduleURL(gateSource))), observations };
}

function cookies(response) {
  return response.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => !value.endsWith('=')).join('; ');
}

// Emulate an unavailable wire until the production AbortSignal expires. A held
// timer keeps Node alive; it does not change the runtime's timeout duration.
function timeoutResponse(signal) {
  return new Promise((resolve, reject) => {
    const hold = setTimeout(() => reject(new Error('production abort did not fire')), 10000);
    signal.addEventListener('abort', () => { clearTimeout(hold); reject(signal.reason); }, { once: true });
  });
}

/** Runs sequentially: it owns fetch/clock only for this call and restores both. */
export async function runFaultChecks() {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = 1900000000000;
  const checks = [], counts = { auth: 0, control: 0, observations: 0, presentation: 0, assets: 0, bytes: 0, presentationBytes: 0 };
  const check = (name, actual, expected) => {
    assert.deepEqual(actual, expected, name + ': ' + JSON.stringify({ actual, expected }));
    checks.push({ name, actual, expected, passed: true });
  };
  const settings = { clientId: 'benchmark-fault', siteUrl: 'https://site.test/', authOrigin: 'https://auth.test', accessPolicy: 'member' };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const controlPublicKeys = { fixture: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  let authFault, controlFault, observationFault, presentationFault, observationBarrier, sessionNumber = 0;
  const observedEvents = [];
  const sessions = new Map();
  const proof = id => ({ sessionId: id, userId: 'synthetic-' + id, clientId: settings.clientId, siteOrigin: 'https://site.test', source: 'role', generation: 0, verifiedAt: now, leaseUntil: now + 60000, authorizationEvidenceValidUntil: now + 900000, sessionExpiresAt: now + 3600000, absoluteExpiresAt: sessions.get(id), policyVersion: 1, controlVersion: 1 });
  async function envelope() {
    const document = { schemaVersion: 1, audience: 'nakwol-control-v1', clientId: settings.clientId, siteOrigin: 'https://site.test', version: 1, appEpoch: 1, appStatus: 'active', policyFloor: 1, revocations: [], issuedAt: now, expiresAt: now + 30000 };
    const payload = Buffer.from(JSON.stringify(document)).toString('base64url');
    return { kid: 'fixture', payload, signature: Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode('fixture.' + payload))).toString('base64url') };
  }
  const tasks = [];
  const host = {
    sessionSecret: 'synthetic-cookie-key-01234567890123456789', siteCredential: 'synthetic-site-credential', controlPublicKeys,
    serveAsset: async request => {
      counts.assets++;
      const status = request.headers.has('If-None-Match') ? 304 : request.headers.has('Range') ? 206 : 200;
      return new Response(status === 304 || request.method === 'HEAD' ? null : 'synthetic protected fixture', { status, headers: {
        ETag: '"synthetic"', 'Cache-Control': 'public,max-age=31536000,immutable',
        'CDN-Cache-Control': 'public,max-age=31536000', 'Cloudflare-CDN-Cache-Control': 'public,max-age=31536000', 'Surrogate-Control': 'max-age=31536000',
      } });
    },
  };
  const request = (cookie = '', options = {}) => new Request('https://site.test/image.webp', { ...options, headers: { Cookie: cookie, ...options.headers } });
  async function login(gate, options = host) {
    const start = await gate(new Request('https://site.test/__nakwol/start'), options);
    check('login start', start.status, 302);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const callback = await gate(new Request('https://site.test/__nakwol/callback?state=' + state + '&code=synthetic', { headers: { Cookie: cookies(start) } }), options);
    check('synthetic code exchange', callback.status, 303);
    return cookies(callback);
  }
  try {
    Date.now = () => now;
    globalThis.fetch = async (input, init) => {
      const path = new URL(input).pathname;
      let fault;
      if (path === '/server/v1/control') { counts.control++; fault = controlFault; }
      else if (path === '/server/v1/observations') { counts.observations++; fault = observationFault; counts.bytes += Buffer.byteLength(init.body); }
      else if (path.startsWith('/public/v1/apps/')) { counts.presentation++; fault = presentationFault; }
      else { assert.ok(path.startsWith('/server/v1/'), 'unexpected upstream ' + path); counts.auth++; fault = authFault; }
      if (fault === 'timeout') return timeoutResponse(init.signal);
      if (fault) return new Response(null, { status: fault });
      if (path === '/server/v1/control') return Response.json(await envelope());
      if (path === '/server/v1/observations') {
        const body = JSON.parse(init.body);
        observedEvents.push(...body.events.map(event => [body.client_id, event.sessionId, Math.floor(event.observedAt / 300000)].join(':')));
        if (observationBarrier) await observationBarrier;
        return Response.json({ ok: true });
      }
      if (path.startsWith('/public/v1/apps/')) {
        const { defaultPresentation } = await import(new URL('presentation-schema.mjs', shared));
        const value = defaultPresentation(); value.version = 7;
        counts.presentationBytes += Buffer.byteLength(JSON.stringify(value));
        return Response.json(value);
      }
      const body = JSON.parse(init.body);
      if (path === '/server/v1/code-exchange') {
        const id = 'session-' + (++sessionNumber); sessions.set(id, now + 86400000);
        return Response.json({ ok: true, session: proof(id), handle: 'h'.repeat(43) + id });
      }
      return Response.json({ ok: true, session: proof(body.session_id) });
    };

    const faults = [];
    for (const boundary of ['AUTH', 'control']) for (const fault of [503, 429, 'timeout']) {
      const { createGate } = await isolate();
      const gate = createGate(settings), options = { ...host, controlProfile: boundary === 'control' ? 'bounded-control' : 'local-lease' };
      const cookie = await login(gate, options);
      check(boundary + ' ' + fault + ' initial grant', (await gate(request(cookie), options)).status, 200);
      if (boundary === 'AUTH') authFault = fault; else controlFault = fault;
      const warmBefore = { ...counts };
      check(boundary + ' ' + fault + ' existing bounded approval', (await gate(request(cookie), options)).status, 200);
      check(boundary + ' ' + fault + ' warm AUTH requests', counts.auth - warmBefore.auth, 0);
      check(boundary + ' ' + fault + ' warm control requests', counts.control - warmBefore.control, 0);
      now += boundary === 'AUTH' ? 61000 : 31000;
      const before = { ...counts }, begin = performance.now();
      const blocked = await gate(request(cookie), options);
      const elapsedMs = performance.now() - begin;
      check(boundary + ' ' + fault + ' fail closed', blocked.status, 503);
      check(boundary + ' ' + fault + ' handler bypasses', counts.assets - before.assets, 0);
      check(boundary + ' ' + fault + ' denial cache', blocked.headers.get('Cache-Control'), 'private, no-store, max-age=0');
      const failureCounts = { auth: counts.auth - before.auth, control: counts.control - before.control, protectedHandlerCalls: counts.assets - before.assets };
      authFault = undefined; controlFault = undefined; now += 1100;
      const recovered = await gate(request(cookie), options);
      check(boundary + ' ' + fault + ' recovery', recovered.status, 200);
      faults.push({ boundary, fault, elapsedMs, failure: failureCounts, recovery: { auth: counts.auth - before.auth - failureCounts.auth, control: counts.control - before.control - failureCounts.control, protectedHandlerCalls: counts.assets - before.assets - failureCounts.protectedHandlerCalls } });
    }

    const single = await isolate(), gate = single.createGate(settings), cookie = await login(gate);
    const rotated = { ...host, sessionSecret: 'rotated-synthetic-key-01234567890123456789', sessionPreviousSecret: host.sessionSecret, sessionPreviousUntil: now + 60000 };
    check('previous key within rotation window', (await gate(request(cookie), rotated)).status, 200);
    check('removed previous key', (await gate(request(cookie), { ...rotated, sessionPreviousSecret: undefined })).status, 401);
    check('expired previous key', (await gate(request(cookie), { ...rotated, sessionPreviousUntil: now - 1 })).status, 401);
    const keyBoundary = await isolate(), keyedGate = keyBoundary.createGate(settings);
    const keyedHost = { ...host, controlProfile: 'bounded-control' };
    const keyCookie = await login(keyedGate, keyedHost);
    const assetsBeforeKey = counts.assets;
    check('untrusted signed control key', (await keyedGate(request(keyCookie), { ...keyedHost, controlPublicKeys: { other: controlPublicKeys.fixture } })).status, 503);
    check('untrusted signed control handler calls', counts.assets - assetsBeforeKey, 0);
    check('restored control trust', (await keyedGate(request(keyCookie), keyedHost)).status, 200);
    for (const options of [{}, { method: 'HEAD' }, { headers: { Range: 'bytes=0-3' } }, { headers: { 'If-None-Match': '"synthetic"' } }]) {
      const response = await gate(request(cookie, options), host);
      check('external public cache overwritten ' + JSON.stringify(options), response.headers.get('Cache-Control'), options.headers?.Range ? 'private, no-store, max-age=0' : 'private, no-cache, max-age=0, must-revalidate');
      for (const header of ['CDN-Cache-Control', 'Cloudflare-CDN-Cache-Control', 'Surrogate-Control']) {
        check('external shared cache directive removed ' + header + ' ' + JSON.stringify(options), response.headers.get(header), null);
      }
      const before = counts.assets;
      check('anonymous cached variant blocked ' + JSON.stringify(options), (await gate(request('', options), host)).status, 401);
      check('anonymous handler calls', counts.assets - before, 0);
    }
    const quotaCookies = Array.from({ length: 8 }, (_, i) => '__Host-nakwol_state_' + i + '=synthetic').join('; ');
    const beforeQuota = { ...counts };
    check('login transaction quota', (await gate(new Request('https://site.test/__nakwol/start', { headers: { Cookie: quotaCookies } }), host)).status, 429);
    check('quota public fallback count', counts.assets - beforeQuota.assets, 0);

    const observationStart = { ...counts };
    const observations = [];
    for (const enabled of [false, true]) {
      const modules = await Promise.all(Array.from({ length: 10 }, () => isolate()));
      const before = { ...counts }, eventsBefore = observedEvents.length, queuedTasks = [], begin = performance.now(), cpuBegin = process.cpuUsage();
      let releaseObservations;
      if (enabled) observationBarrier = new Promise(resolve => { releaseObservations = resolve; });
      const options = { ...host, ...(enabled ? { waitUntil: promise => queuedTasks.push(promise) } : {}) };
      const results = await Promise.all(modules.flatMap(mod => Array.from({ length: 30 }, () => mod.createGate(settings)(request(cookie), options))));
      const wallMs = performance.now() - begin, cpu = process.cpuUsage(cpuBegin);
      check('observation ' + enabled + ' protects 300 images', results.every(response => response.status === 200), true);
      if (enabled) {
        check('300 protected responses complete while observation collectors are held', modules.every(mod => mod.observations.observationMetrics().sent === 0), true);
        releaseObservations(); observationBarrier = undefined;
      }
      await Promise.all(queuedTasks);
      check('observation ' + enabled + ' AUTH requests', counts.auth - before.auth, 0);
      check('observation ' + enabled + ' control requests', counts.control - before.control, 0);
      check('observation ' + enabled + ' transmission count', counts.observations - before.observations, enabled ? 10 : 0);
      const metrics = modules.map(mod => mod.observations.observationMetrics());
      const events = observedEvents.slice(eventsBefore), duplicates = events.length - new Set(events).size;
      check('observation ' + enabled + ' measured duplicate events', duplicates, enabled ? 9 : 0);
      observations.push({ enabled, images: 300, isolates: 10, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, upstreamRequests: counts.observations - before.observations, bytes: counts.bytes - before.bytes, isolateMetrics: metrics, emittedEvents: events.length, uniqueSessionBuckets: new Set(events).size, duplicateEventsAcrossIsolates: duplicates, protectedResponsesCompletedWhileCollectorHeld: enabled });
    }
    const outage = await isolate(); observationFault = 503;
    const queueBefore = counts.observations;
    const p = proof('queue-fixture'), queueTasks = [];
    for (let i = 0; i < 1000; i++) outage.observations.observeApproval({ NAKWOL_SITE_CREDENTIAL: host.siteCredential, NAKWOL_WAIT_UNTIL: task => queueTasks.push(task) }, settings, { ...p, sessionId: 'queued-' + i, userId: 'queued-' + i });
    const beforeFlush = outage.observations.observationMetrics();
    check('queue bound before flush', beforeFlush.queued, 128);
    check('queue overflow before flush', beforeFlush.dropped, 872);
    await Promise.all(queueTasks);
    const lost = outage.observations.observationMetrics();
    check('outage retry attempts', counts.observations - queueBefore, 6);
    check('outage lost events', lost.dropped, 1000);
    check('outage queue after flush', lost.queued, 0);
    observationFault = undefined;
    outage.observations.observeApproval({ NAKWOL_SITE_CREDENTIAL: host.siteCredential, NAKWOL_WAIT_UNTIL: task => tasks.push(task) }, settings, { ...p, sessionId: 'recovery-user', userId: 'recovery-user' });
    await Promise.all(tasks);
    check('observation recovery delivered', outage.observations.observationMetrics().sent, 1);

    const renderer = await import(new URL('presentation-renderer.mjs?benchmark=' + randomUUID(), shared));
    const presentation = [];
    for (const label of ['cold', 'cache-hit', 'failure', 'failure-cache-hit', 'recovery']) {
      if (label === 'failure' || label === 'recovery') now += 60001;
      presentationFault = label.startsWith('failure') ? 503 : undefined;
      const before = counts.presentation, bytesBefore = counts.presentationBytes, begin = performance.now();
      const value = await renderer.loadPresentation(settings.authOrigin, settings.clientId);
      check('presentation ' + label + ' version', value.version, label.startsWith('failure') ? 0 : 7);
      check('presentation ' + label + ' request count', counts.presentation - before, label.includes('cache-hit') ? 0 : 1);
      presentation.push({ label, wallMs: performance.now() - begin, upstreamRequests: counts.presentation - before, responseBytes: counts.presentationBytes - bytesBefore, presentationVersion: value.version });
    }
    return { passed: true, checks, faults, counters: counts, quota: { scope: 'site pending login transactions', limit: 8, publicFallbacks: 0 }, observations: { batches: observations, overflowBeforeFlush: beforeFlush, outage: lost, outageRequests: 6, lastObservedLag: 'not measured: collector persistence is outside site runtime', totalRequests: counts.observations - observationStart.observations }, presentation, boundaries: ['Synthetic AUTH endpoint exercises upstream 503/429/abort responses; Discord calls occur centrally and are not directly made or measured by this site gate.', 'D03 measurements exercise the actual shared presentation loader, not browser module transfer, DOM paint or LCP.', 'No provider billing quota or external CDN enforcement is simulated; transaction quota and origin response cache header rewriting are measured.'] };
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
}
