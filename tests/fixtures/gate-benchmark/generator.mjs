import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const sha = (body) => createHash('sha256').update(body).digest('hex');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

function pngChunk(type, data) {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

function syntheticPng(bytes, seed) {
  const width = bytes < 10240 ? 16 : 128;
  const height = Math.max(1, Math.floor((bytes - 200) / (width * 3 + 1)));
  const rows = Buffer.alloc(height * (width * 3 + 1));
  let state = createHash('sha256').update(seed).digest().readUInt32BE() || 1;
  for (let row = 0; row < height; row++) {
    for (let col = 1; col <= width * 3; col++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      rows[row * (width * 3 + 1) + col] = state & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows, { level: 6 }))];
  const remaining = bytes - parts.reduce((sum, part) => sum + part.length, 0) - 24;
  if (remaining < 0) throw new Error('PNG target size too small');
  // Ancillary chunk fills only the rounding remainder; IDAT holds seeded RGB pixels.
  parts.push(pngChunk('npAD', Buffer.alloc(remaining)), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function checksum(data) {
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
  data.copy(padded);
  let sum = 0;
  for (let offset = 0; offset < padded.length; offset += 4) sum = (sum + padded.readUInt32BE(offset)) >>> 0;
  return sum;
}

// Original minimal TrueType outlines: .notdef and one square glyph mapped to ASCII.
// No third party font binary or license is required.
function syntheticFont(family) {
  const tables = new Map();
  const head = Buffer.alloc(54);
  head.writeUInt32BE(0x10000); head.writeUInt32BE(0x10000, 4);
  head.writeUInt32BE(0x5f0f3cf5, 12); head.writeUInt16BE(3, 16); head.writeUInt16BE(1000, 18);
  head.writeBigUInt64BE(3863289600n, 20); head.writeBigUInt64BE(3863289600n, 28);
  head.writeInt16BE(800, 40); head.writeInt16BE(800, 42); head.writeUInt16BE(8, 46); head.writeInt16BE(2, 48);
  tables.set('head', head);
  const hhea = Buffer.alloc(36);
  hhea.writeUInt32BE(0x10000); hhea.writeInt16BE(800, 4); hhea.writeInt16BE(-200, 6);
  hhea.writeUInt16BE(1000, 10); hhea.writeInt16BE(800, 16); hhea.writeInt16BE(1, 18); hhea.writeUInt16BE(2, 34);
  tables.set('hhea', hhea);
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x10000); maxp.writeUInt16BE(2, 4); maxp.writeUInt16BE(4, 6); maxp.writeUInt16BE(1, 8); maxp.writeUInt16BE(1, 14);
  tables.set('maxp', maxp);
  const hmtx = Buffer.alloc(8); hmtx.writeUInt16BE(1000); hmtx.writeUInt16BE(1000, 4); tables.set('hmtx', hmtx);
  const glyf = Buffer.alloc(36);
  glyf.writeInt16BE(1); glyf.writeInt16BE(800, 6); glyf.writeInt16BE(800, 8); glyf.writeUInt16BE(3, 10);
  glyf.fill(1, 14, 18);
  [0, 800, 0, -800, 0, 0, 800, 0].forEach((value, index) => glyf.writeInt16BE(value, 18 + index * 2));
  tables.set('glyf', glyf);
  const loca = Buffer.alloc(6); loca.writeUInt16BE(18, 4); tables.set('loca', loca);
  const cmap = Buffer.alloc(44);
  cmap.writeUInt16BE(1, 2); cmap.writeUInt16BE(3, 4); cmap.writeUInt16BE(1, 6); cmap.writeUInt32BE(12, 8);
  cmap.writeUInt16BE(4, 12); cmap.writeUInt16BE(32, 14); cmap.writeUInt16BE(4, 18); cmap.writeUInt16BE(4, 20); cmap.writeUInt16BE(1, 22);
  cmap.writeUInt16BE(126, 26); cmap.writeUInt16BE(65535, 28); cmap.writeUInt16BE(32, 32); cmap.writeUInt16BE(65535, 34);
  // Format 4 maps all printable ASCII to the original square outline.
  const expanded = Buffer.alloc(44 + 95 * 2); cmap.copy(expanded);
  expanded.writeUInt16BE(32 + 95 * 2, 14); expanded.writeUInt16BE(1, 38); expanded.writeUInt16BE(4, 40);
  for (let i = 0; i < 95; i++) expanded.writeUInt16BE(1, 44 + i * 2);
  tables.set('cmap', expanded);
  const nameText = Buffer.from(family.split('').map((letter) => `\0${letter}`).join(''), 'binary');
  const name = Buffer.alloc(18 + nameText.length);
  name.writeUInt16BE(1, 2); name.writeUInt16BE(18, 4); name.writeUInt16BE(3, 6); name.writeUInt16BE(1, 8);
  name.writeUInt16BE(0x409, 10); name.writeUInt16BE(1, 12); name.writeUInt16BE(nameText.length, 14); nameText.copy(name, 18);
  tables.set('name', name);
  const os2 = Buffer.alloc(78);
  os2.writeInt16BE(1000, 2); os2.writeUInt16BE(400, 4); os2.writeUInt16BE(5, 6);
  os2.writeInt16BE(650, 10); os2.writeInt16BE(600, 12); os2.writeInt16BE(75, 16);
  os2.writeInt16BE(650, 18); os2.writeInt16BE(600, 20); os2.writeInt16BE(350, 24);
  os2.writeInt16BE(50, 26); os2.writeInt16BE(250, 28); os2.writeUInt32BE(1, 42);
  os2.write('TEST', 58, 'ascii'); os2.writeUInt16BE(64, 62);
  os2.writeUInt16BE(32, 64); os2.writeUInt16BE(126, 66);
  os2.writeInt16BE(800, 68); os2.writeInt16BE(-200, 70);
  os2.writeUInt16BE(800, 74); os2.writeUInt16BE(200, 76); tables.set('OS/2', os2);
  const post = Buffer.alloc(32); post.writeUInt32BE(0x30000); tables.set('post', post);
  const entries = [...tables].sort(([a], [b]) => a.localeCompare(b));
  let offset = 12 + entries.length * 16;
  const output = Buffer.alloc(offset + entries.reduce((sum, [, body]) => sum + Math.ceil(body.length / 4) * 4, 0));
  output.writeUInt32BE(0x10000); output.writeUInt16BE(entries.length, 4);
  output.writeUInt16BE(128, 6); output.writeUInt16BE(3, 8); output.writeUInt16BE(entries.length * 16 - 128, 10);
  let headOffset;
  entries.forEach(([tag, body], index) => {
    const record = 12 + index * 16;
    output.write(tag, record, 'ascii'); output.writeUInt32BE(checksum(body), record + 4);
    output.writeUInt32BE(offset, record + 8); output.writeUInt32BE(body.length, record + 12); body.copy(output, offset);
    if (tag === 'head') headOffset = offset;
    offset += Math.ceil(body.length / 4) * 4;
  });
  output.writeUInt32BE((0xb1b0afba - checksum(output)) >>> 0, headOffset + 8);
  return output;
}

export function generateFixture({ imageKiB = 1, seed = 'nakwol-gate-t11-v1' } = {}) {
  if (![1, 10, 50, 200].includes(imageKiB)) throw new Error('imageKiB must be 1 (security), 10, 50, or 200');
  if (typeof seed !== 'string' || seed.length === 0) throw new Error('seed must be a nonempty string');
  const assets = new Map();
  const records = [];
  function add(path, body, contentType, kind) {
    body = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const digest = sha(body);
    assets.set(path, { body, contentType, etag: `"${digest}"` });
    records.push({ path, kind, bytes: body.length, sha256: digest });
  }
  const images = Array.from({ length: 300 }, (_, i) => `/images/image-${String(i).padStart(3, '0')}.png`);
  add('/index.html', `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Synthetic gate fixture</title>${[0, 1, 2].map((i) => `<link rel="stylesheet" href="/css/style-${i}.css">`).join('')}<body><h1>SYNTHETIC FIXTURE</h1><main>${images.map((path, i) => `<img src="${path}" width="128" height="128" loading="eager" alt="Synthetic ${i}">`).join('')}</main><a href="/downloads/synthetic.bin" download>Download synthetic bytes</a>${[0, 1, 2, 3].map((i) => `<script src="/js/script-${i}.js" defer></script>`).join('')}</body></html>`, 'text/html; charset=utf-8', 'html');
  for (let i = 0; i < 4; i++) {
    add(`/js/script-${i}.js`, `fetch('/json/data-${i}.json').then(r=>{if(!r.ok)throw Error('fixture JSON');return r.json()}).then(v=>{document.documentElement.dataset['fixture${i}']=v.synthetic?'loaded':'invalid'});`, 'application/javascript; charset=utf-8', 'javascript');
    add(`/json/data-${i}.json`, JSON.stringify({ synthetic: true, seed, index: i, values: Array.from({ length: 32 }, (_, n) => n + i) }), 'application/json', 'json');
  }
  add('/css/style-0.css', `@font-face{font-family:FixtureA;src:url('/fonts/synthetic-a.ttf')}h1{font-family:FixtureA}body{margin:0}main{display:grid;grid-template-columns:repeat(8,128px)}`, 'text/css; charset=utf-8', 'css');
  add('/css/style-1.css', `@font-face{font-family:FixtureB;src:url('/fonts/synthetic-b.ttf')}a{font-family:FixtureB}img{width:128px;height:128px;object-fit:cover}`, 'text/css; charset=utf-8', 'css');
  add('/css/style-2.css', 'body{background:#eee;color:#111}main{gap:4px}h1{font-size:24px}', 'text/css; charset=utf-8', 'css');
  for (const path of images) add(path, syntheticPng(imageKiB * 1024, `${seed}:${path}`), 'image/png', 'image');
  add('/fonts/synthetic-a.ttf', syntheticFont('FixtureA'), 'font/ttf', 'font');
  add('/fonts/synthetic-b.ttf', syntheticFont('FixtureB'), 'font/ttf', 'font');
  add('/downloads/synthetic.bin', Buffer.from(`SYNTHETIC DOWNLOAD\n${seed}\n`), 'application/octet-stream', 'download');
  records.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { schemaVersion: 1, synthetic: true, seed, imageKiB, viewport: { width: 1280, height: 720, deviceScaleFactor: 1 }, lazyLoading: false, counts: { html: 1, javascript: 4, css: 3, json: 4, image: 300, font: 2, download: 1 }, imageBytes: images.length * imageKiB * 1024, totalBytes: records.reduce((sum, entry) => sum + entry.bytes, 0), assets: records };
  manifest.sha256 = sha(JSON.stringify(manifest));
  return { assets, manifest };
}
