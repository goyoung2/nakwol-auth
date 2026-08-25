import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const EMBED_URL = 'https://nakwol-auth.sepsd21.workers.dev/connect/v1.js';
const HTML_START = '<!-- NAKWOL-CONNECT:START -->';
const HTML_END = '<!-- NAKWOL-CONNECT:END -->';
const JSX_START = '{/* NAKWOL-CONNECT:START */}';
const JSX_END = '{/* NAKWOL-CONNECT:END */}';
const NEXT_IMPORT = "import Script from 'next/script'; // NAKWOL-CONNECT:IMPORT";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceBlock(source, start, end, replacement) {
  const re = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`, 'm');
  return re.test(source) ? source.replace(re, replacement) : null;
}

function htmlBlock(clientId) {
  return `${HTML_START}\n<script\n  src="${EMBED_URL}"\n  data-client-id="${clientId}">\n</script>\n${HTML_END}`;
}

function jsxBlock(clientId) {
  return `${JSX_START}\n<Script\n  src="${EMBED_URL}"\n  data-client-id="${clientId}"\n  strategy="afterInteractive"\n/>\n${JSX_END}`;
}

function installHtml(source, clientId) {
  const block = htmlBlock(clientId);
  const replaced = replaceBlock(source, HTML_START, HTML_END, block);
  if (replaced != null) return replaced;
  const index = source.toLowerCase().lastIndexOf('</body>');
  if (index < 0) throw new Error('CONNECT_HTML_BODY_NOT_FOUND');
  return `${source.slice(0, index)}${block}\n${source.slice(index)}`;
}

function installNext(source, clientId) {
  let value = source;
  if (!/from\s+['"]next\/script['"]/.test(value)) value = `${NEXT_IMPORT}\n${value}`;
  const block = jsxBlock(clientId);
  const replaced = replaceBlock(value, JSX_START, JSX_END, block);
  if (replaced != null) return replaced;

  const bodyIndex = value.lastIndexOf('</body>');
  if (bodyIndex >= 0) return `${value.slice(0, bodyIndex)}${block}\n${value.slice(bodyIndex)}`;

  const componentIndex = value.search(/<Component\b/);
  if (componentIndex >= 0) return `${value.slice(0, componentIndex)}${block}\n${value.slice(componentIndex)}`;

  throw new Error('CONNECT_NEXT_INSERTION_POINT_NOT_FOUND');
}

export async function installIntegration(root, project, clientId) {
  if (!project?.targetFile) throw new Error('CONNECT_UNSUPPORTED_PROJECT');
  const path = join(root, project.targetFile);
  const original = await readFile(path, 'utf8');
  const next = project.framework === 'next_app' || project.framework === 'next_pages'
    ? installNext(original, clientId)
    : installHtml(original, clientId);
  if (next !== original) await writeFile(path, next);
  return { changedFiles: next === original ? [] : [project.targetFile], integration: project.framework.startsWith('next_') ? 'next-script' : 'universal-embed' };
}

export async function removeIntegration(root, project) {
  if (!project?.targetFile) return { changedFiles: [] };
  const path = join(root, project.targetFile);
  const original = await readFile(path, 'utf8');
  let next = original
    .replace(new RegExp(`${escapeRegExp(HTML_START)}[\\s\\S]*?${escapeRegExp(HTML_END)}\\s*`, 'm'), '')
    .replace(new RegExp(`${escapeRegExp(JSX_START)}[\\s\\S]*?${escapeRegExp(JSX_END)}\\s*`, 'm'), '')
    .replace(new RegExp(`${escapeRegExp(NEXT_IMPORT)}\\s*`, 'g'), '');
  if (next !== original) await writeFile(path, next);
  return { changedFiles: next === original ? [] : [project.targetFile] };
}

export const connectMarkers = { HTML_START, HTML_END, JSX_START, JSX_END, NEXT_IMPORT, EMBED_URL };
