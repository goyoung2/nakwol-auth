import test from 'node:test';
import assert from 'node:assert/strict';
import { detectProject, defaultLocalUrl } from '../lib/project.mjs';

function project(dependencies = {}, files = []) {
  return { packageJson: { dependencies }, files: new Set(files) };
}

test('detects Next.js App Router and Pages Router from dependencies and files', () => {
  assert.equal(detectProject(project({ next: '^15', react: '^19' }, ['app/layout.tsx'])).framework, 'next_app');
  assert.equal(detectProject(project({ next: '^15', react: '^19' }, ['pages/_app.tsx'])).framework, 'next_pages');
});

test('detects SvelteKit, Vue/Vite, React/Vite, CRA and generic Vite', () => {
  assert.equal(detectProject(project({ '@sveltejs/kit': '^2' }, ['src/app.html'])).framework, 'sveltekit');
  assert.equal(detectProject(project({ vue: '^3', vite: '^7' }, ['index.html'])).framework, 'vue');
  assert.equal(detectProject(project({ react: '^19', vite: '^7' }, ['index.html'])).framework, 'react');
  assert.equal(detectProject(project({ react: '^19', 'react-scripts': '^5' }, ['public/index.html'])).framework, 'cra');
  assert.equal(detectProject(project({ vite: '^7' }, ['index.html'])).framework, 'vite');
});

test('detects plain HTML and unsupported projects', () => {
  assert.equal(detectProject(project({}, ['index.html'])).framework, 'html');
  assert.equal(detectProject(project({}, ['README.md'])).framework, 'other');
});

test('default local URLs are framework-specific and never invented for html/other', () => {
  assert.equal(defaultLocalUrl('react'), 'http://localhost:5173/');
  assert.equal(defaultLocalUrl('vue'), 'http://localhost:5173/');
  assert.equal(defaultLocalUrl('sveltekit'), 'http://localhost:5173/');
  assert.equal(defaultLocalUrl('next_app'), 'http://localhost:3000/');
  assert.equal(defaultLocalUrl('cra'), 'http://localhost:3000/');
  assert.equal(defaultLocalUrl('html'), null);
  assert.equal(defaultLocalUrl('other'), null);
});
