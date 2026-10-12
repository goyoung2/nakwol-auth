import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { list } from 'tar';

// Read entries in memory, never extract untrusted paths into the filesystem.
export async function packageContent(bytes) {
  if (bytes.length > 8 * 1024 * 1024) throw new Error('PACKAGE_ARCHIVE_TOO_LARGE');
  const files = new Map(); let total = 0;
  const reader = list({ strict: true, onReadEntry(entry) {
    if (entry.type === 'Directory') { entry.resume(); return; }
    if (entry.type !== 'File' || !/^package\/[A-Za-z0-9_.\/-]+$/.test(entry.path)
      || entry.path.split('/').some(part => part === '..' || part === '.') || files.has(entry.path)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 1024 * 1024 || (total += entry.size) > 8 * 1024 * 1024) {
      entry.resume(); reader.destroy(new Error('INVALID_PACKAGE_ENTRY')); return;
    }
    const chunks = []; files.set(entry.path, null);
    entry.on('data', chunk => chunks.push(chunk));
    entry.on('end', () => {
      const raw = Buffer.concat(chunks);
      // Git text checkout endings differ on Windows; no other bytes are normalized.
      const textFile = /\.(mjs|js|json|md)$/.test(entry.path) || entry.path === 'package/LICENSE';
      const text = raw.toString('utf8');
      const canonical = textFile && Buffer.from(text).equals(raw) ? Buffer.from(text.replaceAll('\r\n', '\n')) : raw;
      files.set(entry.path, createHash('sha256').update(canonical).digest('hex'));
    });
  } });
  await pipeline(Readable.from([bytes]), reader);
  if (!files.size || [...files.values()].some(value => value === null)) throw new Error('PACKAGE_CONTENT_INCOMPLETE');
  return JSON.stringify([...files.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
