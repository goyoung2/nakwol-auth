import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args, capture = false) => execFileSync(npx, ['wrangler', ...args], {
  encoding: 'utf8',
  stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
});

let dbs = JSON.parse(run(['d1', 'list', '--json'], true));
let db = dbs.find((item) => item.name === 'nakwol-auth');
if (!db) {
  run(['d1', 'create', 'nakwol-auth', '--location', 'apac']);
  dbs = JSON.parse(run(['d1', 'list', '--json'], true));
  db = dbs.find((item) => item.name === 'nakwol-auth');
}
if (!db?.uuid) throw new Error('nakwol-auth D1 database could not be resolved');

const configPath = 'wrangler.jsonc';
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.d1_databases = [{
  binding: 'DB',
  database_name: 'nakwol-auth',
  database_id: db.uuid,
  migrations_dir: 'migrations'
}];
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`D1_READY:${db.uuid}`);
