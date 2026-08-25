import { access, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function firstExisting(root, candidates) {
  for (const candidate of candidates) if (await exists(join(root, candidate))) return candidate;
  return null;
}

async function readPackage(root) {
  try { return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); }
  catch { return {}; }
}

function dependencySet(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
  ]);
}

export async function detectProject(root = process.cwd()) {
  const pkg = await readPackage(root);
  const deps = dependencySet(pkg);
  const projectName = String(pkg.name || basename(root) || 'nakwol-app');

  if (deps.has('next')) {
    const appLayout = await firstExisting(root, [
      'app/layout.tsx', 'app/layout.jsx', 'app/layout.js', 'app/layout.ts',
      'src/app/layout.tsx', 'src/app/layout.jsx', 'src/app/layout.js', 'src/app/layout.ts',
    ]);
    if (appLayout) return { framework: 'next_app', targetFile: appLayout, projectName, defaultRedirectUri: 'http://localhost:3000/' };
    const pagesApp = await firstExisting(root, [
      'pages/_app.tsx', 'pages/_app.jsx', 'pages/_app.js', 'pages/_app.ts',
      'src/pages/_app.tsx', 'src/pages/_app.jsx', 'src/pages/_app.js', 'src/pages/_app.ts',
    ]);
    if (pagesApp) return { framework: 'next_pages', targetFile: pagesApp, projectName, defaultRedirectUri: 'http://localhost:3000/' };
  }

  if (deps.has('@sveltejs/kit')) {
    const targetFile = await firstExisting(root, ['src/app.html']);
    if (targetFile) return { framework: 'sveltekit', targetFile, projectName, defaultRedirectUri: 'http://localhost:5173/' };
  }

  const rootIndex = await firstExisting(root, ['index.html']);
  if (deps.has('vite') && deps.has('vue') && rootIndex) return { framework: 'vue', targetFile: rootIndex, projectName, defaultRedirectUri: 'http://localhost:5173/' };
  if (deps.has('vite') && deps.has('react') && rootIndex) return { framework: 'react', targetFile: rootIndex, projectName, defaultRedirectUri: 'http://localhost:5173/' };
  if (deps.has('vite') && rootIndex) return { framework: 'vite', targetFile: rootIndex, projectName, defaultRedirectUri: 'http://localhost:5173/' };

  if (deps.has('react-scripts')) {
    const targetFile = await firstExisting(root, ['public/index.html']);
    if (targetFile) return { framework: 'cra', targetFile, projectName, defaultRedirectUri: 'http://localhost:3000/' };
  }

  if (rootIndex) return { framework: 'html', targetFile: rootIndex, projectName, defaultRedirectUri: 'http://localhost:8080/' };

  return { framework: 'unknown', targetFile: null, projectName, defaultRedirectUri: null };
}
