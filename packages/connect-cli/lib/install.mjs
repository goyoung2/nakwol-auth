import fs from 'node:fs/promises';
import path from 'node:path';
import { patchHtmlDocument, patchNextSource, targetForFramework } from './patch.mjs';

export class InstallError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
    this.details = details;
  }
}

function target(project) {
  const value = targetForFramework(project.framework, project.files);
  if (!value) throw new InstallError('UNSUPPORTED_PROJECT', `지원되는 자동 설치 대상을 찾지 못했습니다: ${project.framework}`, { framework: project.framework });
  return value;
}

export async function applyIntegration(project, options) {
  const targetInfo = target(project);
  const filePath = path.join(project.root, targetInfo.path);
  let source;
  try { source = await fs.readFile(filePath, 'utf8'); }
  catch { throw new InstallError('PATCH_UNSAFE', `설치 대상 파일을 찾을 수 없습니다: ${targetInfo.path}`, { file: targetInfo.path }); }

  const result = targetInfo.kind === 'next'
    ? patchNextSource(source, options)
    : patchHtmlDocument(source, options);
  if (!result.ok) throw new InstallError(result.code || 'PATCH_UNSAFE', result.reason || '자동 코드 수정이 안전하지 않습니다.', { file: targetInfo.path });
  if (result.changed) await fs.writeFile(filePath, result.content, 'utf8');
  return { file: targetInfo.path, changed: result.changed };
}

export async function doctorIntegration(project, config, origin) {
  const checks = [];
  if (!config) return { ok: false, checks: [{ name: 'config', ok: false, detail: '.nakwol-connect.json 없음' }] };
  checks.push({ name: 'config', ok: Boolean(config.clientId && Array.isArray(config.redirectUris) && config.redirectUris.length), detail: config.clientId || 'clientId 없음' });

  let targetInfo = null;
  try { targetInfo = target(project); }
  catch (error) {
    checks.push({ name: 'target', ok: false, detail: error.message });
    return { ok: false, checks };
  }
  checks.push({ name: 'target', ok: true, detail: targetInfo.path });

  let source = '';
  try { source = await fs.readFile(path.join(project.root, targetInfo.path), 'utf8'); }
  catch {
    checks.push({ name: 'file', ok: false, detail: `${targetInfo.path} 읽기 실패` });
    return { ok: false, checks };
  }
  checks.push({ name: 'embed', ok: source.includes('/connect/v1.js'), detail: source.includes('/connect/v1.js') ? 'Connect loader 발견' : 'Connect loader 없음' });
  checks.push({ name: 'client_id', ok: source.includes(config.clientId), detail: config.clientId });
  const registeredRedirect = config.redirectUris[0] || '';
  checks.push({ name: 'redirect_uri', ok: registeredRedirect ? source.includes(registeredRedirect) : false, detail: registeredRedirect || '등록 URL 없음' });
  checks.push({ name: 'origin', ok: source.includes(`${origin.replace(/\/$/, '')}/connect/v1.js`), detail: origin });
  return { ok: checks.every((item) => item.ok), checks };
}

export async function removeLocalIntegration(project, clientId) {
  const targetInfo = target(project);
  const filePath = path.join(project.root, targetInfo.path);
  let source = await fs.readFile(filePath, 'utf8');
  const before = source;
  if (targetInfo.kind === 'next') {
    const scriptRe = new RegExp(`\\s*<Script[^>]*\\/connect\\/v1\\.js[^>]*data-client-id=["']${escapeRegex(clientId)}["'][^>]*/>\\s*`, 'g');
    source = source.replace(scriptRe, '\n');
    if (!/<Script\b/.test(source)) source = source.replace(/^import Script from ['"]next\/script['"];?\s*\n/m, '');
  } else {
    const blockRe = new RegExp(`\\s*<script[^>]*src=["'][^"']*\\/connect\\/v1\\.js["'][^>]*data-client-id=["']${escapeRegex(clientId)}["'][^>]*>\\s*<\\/script>\\s*`, 'g');
    source = source.replace(blockRe, '\n');
  }
  if (source !== before) await fs.writeFile(filePath, source, 'utf8');
  return { file: targetInfo.path, changed: source !== before };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
