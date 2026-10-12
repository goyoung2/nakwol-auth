import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { inspectRelease, waitForRelease } from '../../scripts/check-npm-release.mjs';

const integrity = 'sha512-YWJjZA==';
const metadata = () => ({ name: 'nakwol-connect', repository: { url: 'git+https://github.com/goyoung2/nakwol-auth.git' },
  'dist-tags': { latest: '0.7.1' }, versions: {} });
const published = () => ({ name: 'nakwol-connect', version: '0.7.2', repository: metadata().repository,
  dist: { integrity, tarball: 'https://registry.npmjs.org/nakwol-connect/-/nakwol-connect-0.7.2.tgz' } });

async function wire(t, status, body) {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/nakwol-connect');
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  return url => fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`);
}
const inspect = fetchImpl => inspectRelease({ name: 'nakwol-connect', version: '0.7.2', integrity, fetchImpl });

test('only confirmed registry package 404 allows first publication', async t => {
  assert.deepEqual(await inspect(await wire(t, 404, { error: 'Not found' })), { packageExists: false, published: false });
});
test('confirmed missing higher version allows existing-package publication', async t => {
  assert.deepEqual(await inspect(await wire(t, 200, metadata())), { packageExists: true, published: false });
});
test('identical immutable version is idempotent', async t => {
  const doc = metadata(); doc.versions['0.7.2'] = published();
  assert.deepEqual(await inspect(await wire(t, 200, doc)), { packageExists: true, published: true });
});
test('same version with different bytes is rejected', async t => {
  const doc = metadata(); doc.versions['0.7.2'] = { ...published(), dist: { ...published().dist, integrity: 'sha512-ZGlmZg==' } };
  await assert.rejects(inspect(await wire(t, 200, doc)), /CONTENT_MISMATCH/);
});
test('registry owner mismatch is rejected', async t => {
  const doc = metadata(); doc.repository.url = 'https://github.com/other/project';
  await assert.rejects(inspect(await wire(t, 200, doc)), /METADATA_INVALID/);
});
for (const status of [401, 403, 429, 500, 503]) {
  test(`registry ${status} never means unpublished`, async t => {
    await assert.rejects(inspect(await wire(t, status, {})), new RegExp(`LOOKUP_FAILED:${status}`));
  });
}
test('malformed successful registry response is rejected', async t => {
  await assert.rejects(inspect(await wire(t, 200, {})), /METADATA_INVALID/);
});
test('older unpublished release cannot overwrite latest', async t => {
  const doc = metadata(); doc['dist-tags'].latest = '0.8.0';
  await assert.rejects(inspect(await wire(t, 200, doc)), /DOWNGRADE_LATEST/);
});
test('publication visibility is bounded and does not republish', async () => {
  let calls = 0, delays = 0;
  const state = await waitForRelease({ inspect: async () => ({ packageExists: true, published: ++calls === 3 }), sleep: async () => { delays++; } });
  assert.equal(state.published, true); assert.equal(calls, 3); assert.equal(delays, 2);
  await assert.rejects(waitForRelease({ inspect: async () => ({ published: false }), attempts: 2, sleep: async () => {} }), /NOT_VISIBLE/);
});
