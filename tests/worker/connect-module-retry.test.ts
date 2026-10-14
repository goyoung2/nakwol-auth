import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

test('Embed SDK module timeout keeps protection and exposes a working reload control', async () => {
  const elements: {tag: string; hidden: boolean; listeners: Map<string, () => void>; children: unknown[]; textContent: string; style: Record<string, string>}[] = [];
  let reloads = 0;
  let fireTimeout = () => {};
  let completeError = () => {};
  const failed = new Promise<void>(resolve => { completeError = resolve; });
  const document = {
    currentScript: { dataset: { clientId: 'site', auth: 'required', ui: 'headless' }, src: 'https://auth.test/connect/v1.js' },
    readyState: 'complete',
    body: { hasAttribute: () => false, setAttribute() {}, removeAttribute() {} },
    documentElement: { style: { overflow: '' }, appendChild() {} },
    createElement(tag: string) {
      const children: unknown[] = [];
      const element = { tag, hidden: false, listeners: new Map<string, () => void>(), children, textContent: '', style: {},
        setAttribute() {}, append(...children: unknown[]) { this.children.push(...children); },
        appendChild(child: unknown) { this.children.push(child); },
        addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }, remove() {},
      };
      elements.push(element); return element;
    },
  };
  const context = createContext({ document, window: { dispatchEvent(event: CustomEvent) { if (event.type === 'nakwol-error') completeError(); } },
    location: { origin: 'https://site.test', pathname: '/', href: 'https://site.test/', reload: () => { reloads++; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URL, CustomEvent, console: { error() {} },
    setTimeout: (callback: () => void) => { fireTimeout = callback; return 1; }, clearTimeout() {},
  });
  const raw = await readFile(new URL('../../src/assets/nakwol-connect-v1.js.txt', import.meta.url), 'utf8');
  const source = raw.replace('import(`${authOrigin}/sdk/v0.3.4/nakwol-auth-web.js`)', 'new Promise(() => {})');
  assert.notEqual(source, raw);
  runInContext(source, context); fireTimeout(); await failed;
  const retry = elements.find(element => element.tag === 'button');
  assert.ok(retry); assert.equal(retry.hidden, false);
  retry.listeners.get('click')?.();
  assert.equal(reloads, 1);
  assert.equal(document.documentElement.style.overflow, 'hidden');
});
