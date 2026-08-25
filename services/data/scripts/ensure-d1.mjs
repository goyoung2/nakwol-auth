import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const DB_NAME = 'nakwol-data';
const CONFIG_PATH = resolve('wrangler.jsonc');
const createIfMissing = process.argv.includes('--create-if-missing');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args) {
  const result = spawnSync(npx, ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'wrangler failed\n');
    throw new Error(`WRANGLER_FAILED:${args.join(' ')}`);
  }
  return result.stdout;
}

function parseJson(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('EMPTY_WRANGLER_JSON');
  return JSON.parse(trimmed);
}

function findDatabaseId(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of ['uuid', 'database_id', 'id']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate)) return candidate;
  }
  for (const nested of Object.values(value)) {
    const found = findDatabaseId(nested);
    if (found) return found;
  }
  return null;
}

function listExact() {
  const value = parseJson(wrangler(['d1', 'list', '--json']));
  const rows = Array.isArray(value) ? value : value?.result ?? [];
  return rows.filter((row) => row?.name === DB_NAME);
}

let matches = listExact();
if (matches.length > 1) throw new Error('DATA_D1_DUPLICATE_NAME');

if (matches.length === 0 && createIfMissing) {
  wrangler(['d1', 'create', DB_NAME]);
  matches = listExact();
}

if (matches.length === 0) throw new Error('DATA_D1_NOT_FOUND');
if (matches.length > 1) throw new Error('DATA_D1_DUPLICATE_NAME');

const databaseId = findDatabaseId(matches[0]);
if (!databaseId) throw new Error('DATA_D1_ID_NOT_FOUND');

const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
const binding = config.d1_databases?.find((item) => item.binding === 'DB' && item.database_name === DB_NAME);
if (!binding) throw new Error('DATA_D1_BINDING_NOT_FOUND');
binding.database_id = databaseId;
await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
console.log('NAKWOL_DATA_D1_READY');
