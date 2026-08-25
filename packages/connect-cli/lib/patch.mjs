function attr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

export function embedHtml({ clientId, redirectUri, origin }) {
  return `<script\n  src="${attr(origin)}/connect/v1.js"\n  data-client-id="${attr(clientId)}"\n  data-redirect-uri="${attr(redirectUri)}">\n</script>`;
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function updateInstalled(source, options) {
  const tagPattern = /<(?:script|Script)\b[^>]*>/gi;
  let match;
  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[0];
    const src = attributeValue(tag, 'src') || '';
    const clientId = attributeValue(tag, 'data-client-id');
    if (!src.includes('/connect/v1.js') || clientId !== options.clientId) continue;

    const currentRedirect = attributeValue(tag, 'data-redirect-uri');
    if (currentRedirect === options.redirectUri) return { found: true, changed: false, content: source };

    const escapedRedirect = attr(options.redirectUri);
    let nextTag;
    if (currentRedirect != null) {
      nextTag = tag.replace(/data-redirect-uri\s*=\s*(["'])(.*?)\1/i, `data-redirect-uri="${escapedRedirect}"`);
    } else {
      nextTag = tag.replace(/\s*\/>$/, ` data-redirect-uri="${escapedRedirect}" />`)
        .replace(/>$/, ` data-redirect-uri="${escapedRedirect}">`);
    }
    return {
      found: true,
      changed: true,
      content: source.slice(0, match.index) + nextTag + source.slice(match.index + tag.length),
    };
  }
  return { found: false, changed: false, content: source };
}

export function patchHtmlDocument(source, options) {
  const installed = updateInstalled(source, options);
  if (installed.found) return { ok: true, changed: installed.changed, content: installed.content };
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
  const installed = updateInstalled(source, options);
  if (installed.found) return { ok: true, changed: installed.changed, content: installed.content };
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
