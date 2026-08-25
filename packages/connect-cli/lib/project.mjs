import fs from 'node:fs/promises';
import path from 'node:path';

function dependenciesOf(packageJson = {}) {
  return {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  };
}

function hasAny(files, candidates) {
  for (const candidate of candidates) if (files.has(candidate)) return true;
  return false;
}

export function detectProject({ packageJson = {}, files = new Set() } = {}) {
  const deps = dependenciesOf(packageJson);
  if (deps.next) {
    if (hasAny(files, ['app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'app/layout.ts', 'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js', 'src/app/layout.ts'])) {
      return { framework: 'next_app' };
    }
    if (hasAny(files, ['pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js', 'pages/_app.ts', 'src/pages/_app.tsx', 'src/pages/_app.jsx', 'src/pages/_app.js', 'src/pages/_app.ts'])) {
      return { framework: 'next_pages' };
    }
    return { framework: 'next_app' };
  }
  if (deps['@sveltejs/kit']) return { framework: 'sveltekit' };
  if (deps.vue && deps.vite) return { framework: 'vue' };
  if (deps.react && deps.vite) return { framework: 'react' };
  if (deps['react-scripts']) return { framework: 'cra' };
  if (deps.vite) return { framework: 'vite' };
  if (files.has('index.html')) return { framework: 'html' };
  return { framework: 'other' };
}

export function defaultLocalUrl(framework) {
  if (['vite', 'react', 'vue', 'sveltekit'].includes(framework)) return 'http://localhost:5173/';
  if (['cra', 'next_app', 'next_pages'].includes(framework)) return 'http://localhost:3000/';
  return null;
}

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

export async function findProjectRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (await exists(path.join(current, 'package.json')) || await exists(path.join(current, 'index.html'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export async function inspectProject(root) {
  let packageJson = {};
  try { packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')); } catch {}
  const candidates = [
    'index.html', 'public/index.html', 'src/app.html',
    'app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'app/layout.ts',
    'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js', 'src/app/layout.ts',
    'pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js', 'pages/_app.ts',
    'src/pages/_app.tsx', 'src/pages/_app.jsx', 'src/pages/_app.js', 'src/pages/_app.ts',
  ];
  const files = new Set();
  for (const relative of candidates) if (await exists(path.join(root, relative))) files.add(relative);
  return { root, packageJson, files, ...detectProject({ packageJson, files }) };
}

export function projectName(project) {
  const value = project?.packageJson?.name;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return path.basename(project?.root || process.cwd());
}
