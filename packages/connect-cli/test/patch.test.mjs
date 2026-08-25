import test from 'node:test';
import assert from 'node:assert/strict';
import {
  embedHtml,
  patchHtmlDocument,
  patchNextSource,
} from '../lib/patch.mjs';

const options = {
  clientId: 'battle-map',
  redirectUri: 'http://localhost:5173/',
  origin: 'https://nakwol-auth.sepsd21.workers.dev',
};

const productionOptions = {
  ...options,
  redirectUri: 'https://battle-map.pages.dev/',
};

test('HTML embed is inserted immediately before closing body', () => {
  const source = '<!doctype html><html><body><main>app</main></body></html>';
  const result = patchHtmlDocument(source, options);
  assert.equal(result.ok, true);
  assert.match(result.content, /battle-map/);
  assert.match(result.content, /connect\/v1\.js/);
  assert.ok(result.content.indexOf('/connect/v1.js') < result.content.indexOf('</body>'));
});

test('HTML patch is idempotent when redirect URI is unchanged', () => {
  const once = patchHtmlDocument('<html><body></body></html>', options);
  const twice = patchHtmlDocument(once.content, options);
  assert.equal(twice.ok, true);
  assert.equal(twice.changed, false);
  assert.equal((twice.content.match(/connect\/v1\.js/g) || []).length, 1);
});

test('HTML patch updates redirect URI in place for the same client', () => {
  const local = patchHtmlDocument('<html><body></body></html>', options);
  const production = patchHtmlDocument(local.content, productionOptions);
  assert.equal(production.ok, true);
  assert.equal(production.changed, true);
  assert.match(production.content, /data-redirect-uri="https:\/\/battle-map\.pages\.dev\/"/);
  assert.doesNotMatch(production.content, /data-redirect-uri="http:\/\/localhost:5173\/"/);
  assert.equal((production.content.match(/connect\/v1\.js/g) || []).length, 1);
});

test('HTML patch rejects a document without closing body', () => {
  const result = patchHtmlDocument('<main>fragment</main>', options);
  assert.deepEqual(result, {
    ok: false,
    code: 'PATCH_UNSAFE',
    reason: 'closing </body> not found',
  });
});

test('Next layout patch adds next/script import and Script inside body', () => {
  const source = `export default function RootLayout({ children }) {\n  return <html><body>{children}</body></html>;\n}`;
  const result = patchNextSource(source, options);
  assert.equal(result.ok, true);
  assert.match(result.content, /import Script from ['"]next\/script['"]/);
  assert.match(result.content, /<Script/);
  assert.match(result.content, /data-client-id="battle-map"/);
  assert.ok(result.content.indexOf('<Script') < result.content.indexOf('</body>'));
});

test('Next patch is idempotent when redirect URI is unchanged', () => {
  const source = `export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }`;
  const once = patchNextSource(source, options);
  const twice = patchNextSource(once.content, options);
  assert.equal(twice.ok, true);
  assert.equal(twice.changed, false);
});

test('Next patch updates redirect URI in place for the same client', () => {
  const source = `export default function RootLayout({ children }) { return <html><body>{children}</body></html>; }`;
  const local = patchNextSource(source, options);
  const production = patchNextSource(local.content, productionOptions);
  assert.equal(production.ok, true);
  assert.equal(production.changed, true);
  assert.match(production.content, /data-redirect-uri="https:\/\/battle-map\.pages\.dev\/"/);
  assert.doesNotMatch(production.content, /data-redirect-uri="http:\/\/localhost:5173\/"/);
  assert.equal((production.content.match(/connect\/v1\.js/g) || []).length, 1);
});

test('Next patch refuses ambiguous files without body', () => {
  const unsafe = patchNextSource('export default function App(){ return <main /> }', options);
  assert.equal(unsafe.ok, false);
  assert.equal(unsafe.code, 'PATCH_UNSAFE');
});

test('embedHtml includes only public integration metadata', () => {
  const html = embedHtml(options);
  assert.match(html, /data-client-id="battle-map"/);
  assert.doesNotMatch(html, /token|secret/i);
});
