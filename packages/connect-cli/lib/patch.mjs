function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function embedHtml({ clientId, redirectUri, origin }) {
  return `<script\n  src="${attr(origin)}/connect/v1.js"\n  data-client-id="${attr(clientId)}"\n  data-redirect-uri="${attr(redirectUri)}">\n</script>`;
}

function alreadyInstalled(source, clientId) {
  return source.includes('/connect/v1.js') && source.includes(`data-client-id="${clientId}"`);
}

export function patchHtmlDocument(source, options) {
  if (alreadyInstalled(source, options.clientId)) return { ok: true, changed: false, content: source };
  const match = source.match(/<\/body\s*>/i);
  if (!match || match.index == null) return { ok: false, code: 'PATCH_UNSAFE', reason: 'closing </body> not found' };
  const insertion = `\n${embedHtml(options)}\n`;
  return {
    ok: true,
    changed: true,
    content: source.slice(0, match.index) + insertion + source.slice(match.index),
  };
}

function nextScript(options) {
  return `<Script src="${attr(options.origin)}/connect/v1.js" data-client-id="${attr(options.clientId)}" data-redirect-uri="${attr(options.redirectUri)}" />`;
}

export function patchNextSource(source, options) {
  if (alreadyInstalled(source, options.clientId)) return { ok: true, changed: false, content: source };
  const match = source.match(/<\/body\s*>/i);
  if (!match || match.index == null) return { ok: false, code: 'PATCH_UNSAFE', reason: 'closing </body> JSX tag not found' };

  let content = source;
  if (!/from\s+['"]next\/script['"]/.test(content)) content = `import Script from 'next/script';\n${content}`;
  const nextMatch = content.match(/<\/body\s*>/i);
  const insertion = `\n        ${nextScript(options)}\n      `;
  return {
    ok: true,
    changed: true,
    content: content.slice(0, nextMatch.index) + insertion + content.slice(nextMatch.index),
  };
}

export function targetForFramework(framework, files = new Set()) {
  if (['vite', 'react', 'vue', 'html'].includes(framework)) return { kind: 'html', path: 'index.html' };
  if (framework === 'cra') return { kind: 'html', path: 'public/index.html' };
  if (framework === 'sveltekit') return { kind: 'html', path: 'src/app.html' };
  if (framework === 'next_app') {
    for (const candidate of ['app/layout.tsx','src/app/layout.tsx','app/layout.jsx','src/app/layout.jsx','app/layout.js','src/app/layout.js','app/layout.ts','src/app/layout.ts']) {
      if (files.has(candidate)) return { kind: 'next', path: candidate };
    }
    return { kind: 'next', path: 'app/layout.tsx' };
  }
  if (framework === 'next_pages') {
    for (const candidate of ['pages/_app.tsx','src/pages/_app.tsx','pages/_app.jsx','src/pages/_app.jsx','pages/_app.js','src/pages/_app.js','pages/_app.ts','src/pages/_app.ts']) {
      if (files.has(candidate)) return { kind: 'next', path: candidate };
    }
    return { kind: 'next', path: 'pages/_app.tsx' };
  }
  return null;
}
