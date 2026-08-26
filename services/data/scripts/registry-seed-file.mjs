import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { resolve, join } from 'node:path';

export const DEFAULT_SEED_PARTS_DIR = resolve('seeds/registry-v0.2.parts');
const PART_SIZE = 9000;

export async function readRegistrySeed(partsDir = DEFAULT_SEED_PARTS_DIR) {
  const names = (await readdir(partsDir)).filter((name) => /^part-\d+\.b64$/.test(name)).sort();
  if (names.length === 0) throw new Error('REGISTRY_SEED_PARTS_NOT_FOUND');
  const chunks = await Promise.all(names.map((name) => readFile(join(partsDir, name), 'utf8')));
  const encoded = chunks.join('').replace(/\s+/g, '');
  const json = gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
  return JSON.parse(json);
}

export async function writeRegistrySeedParts(seed, partsDir = DEFAULT_SEED_PARTS_DIR) {
  const body = Buffer.from(`${JSON.stringify(seed)}\n`);
  const compressed = gzipSync(body, { level: 9 });
  const encoded = compressed.toString('base64');
  await rm(partsDir, { recursive:true, force:true });
  await mkdir(partsDir, { recursive:true });
  const count = Math.ceil(encoded.length / PART_SIZE);
  for (let index = 0; index < count; index += 1) {
    const name = `part-${String(index + 1).padStart(2, '0')}.b64`;
    await writeFile(join(partsDir, name), `${encoded.slice(index * PART_SIZE, (index + 1) * PART_SIZE)}\n`);
  }
  return { body, compressed, parts:count };
}
