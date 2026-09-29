import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function protectionBuildHash(files) {
  return sha256(JSON.stringify(files.map(({path,size,sha256: digest}) => ({path,size,sha256:digest})).sort((a,b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}
export function safeAssetPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || Array.from(path).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 92 || c === '?' || c === '#')) return false;
  try { const decoded = decodeURIComponent(path); return !Array.from(decoded).some(c => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 92) && !decoded.split('/').some(p => p === '.' || p === '..') && !decoded.startsWith('//'); } catch { return false; }
}
export async function readProtectionManifest(file, options = {}) {
  const raw = await readFile(file); if (raw.length > 4 * 1024 * 1024) throw new Error('Manifest exceeds 4 MiB.');
  const value = JSON.parse(raw.toString('utf8'));
  if (value.schemaVersion !== 1 || typeof value.deploymentId !== 'string' || !/^[\w.-]{1,200}$/.test(value.deploymentId) || !/^[a-f0-9]{64}$/.test(value.buildHash || '') || !/^\d+\.\d+\.\d+$/.test(value.runtimeVersion || '') || !Array.isArray(value.capabilities) || value.capabilities.length > 32 || !value.capabilities.every(v => typeof v === 'string' && /^[\w.-]{1,80}$/.test(v)) || !Array.isArray(value.files) || !value.files.length || value.files.length > 10000) throw new Error('Invalid protection manifest.');
  const seen = new Set();
  for (const item of value.files) {
    if (!safeAssetPath(item.path) || seen.has(item.path) || !Number.isSafeInteger(item.size) || item.size < 0 || !/^[a-f0-9]{64}$/.test(item.sha256 || '') || (item.canary !== undefined && (typeof item.canary !== 'string' || item.canary.length < 8 || item.canary.length > 256))) throw new Error('Invalid manifest file.');
    seen.add(item.path);
  }
  if (protectionBuildHash(value.files) !== value.buildHash) throw new Error('Manifest buildHash does not match canonical file inventory.');
  if ((options.deploymentId && options.deploymentId !== value.deploymentId) || (options.buildHash && options.buildHash !== value.buildHash)) throw new Error('Manifest deployment/build binding mismatch.');
  return { ...value, manifestHash: sha256(raw) };
}
export async function readProtectionOrigins(file, normalize) {
  if (!file) return [];
  const raw = await readFile(file); if (raw.length > 65536) throw new Error('Origin registry exceeds 64 KiB.');
  const value = JSON.parse(raw.toString('utf8'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.origins) || value.origins.length > 100 || !value.origins.every(v => typeof v === 'string')) throw new Error('Invalid origin registry.');
  return value.origins.map(normalize);
}
export async function boundedBody(response, limit = 1024 * 1024) {
  if (!response.body) return { bytes: Buffer.alloc(0), complete: true };
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) return { bytes: Buffer.concat(chunks), complete: true };
      const remaining = limit - length; chunks.push(Buffer.from(next.value.subarray(0, remaining))); length += Math.min(remaining, next.value.length);
      if (next.value.length > remaining || length === limit) { await reader.cancel(); return { bytes: Buffer.concat(chunks), complete: false }; }
    }
  } finally { reader.releaseLock(); }
}
