import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageDir = path.join(root, 'packages', 'connect-cli');
const distDir = path.join(root, 'dist', 'connect-cli');
const assetPath = path.join(root, 'src', 'assets', 'nakwol-connect-cli.tgz.b64.txt');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.dirname(assetPath), { recursive: true });

const stdout = execFileSync(npm, ['pack', '--pack-destination', distDir], {
  cwd: packageDir,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
});

const packageName = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
if (!packageName || !packageName.endsWith('.tgz')) throw new Error(`npm pack did not return a tarball name: ${stdout}`);
const tarballPath = path.join(distDir, packageName);
if (!fs.existsSync(tarballPath)) throw new Error(`CLI tarball not found: ${tarballPath}`);

const bytes = fs.readFileSync(tarballPath);
if (bytes.length < 100) throw new Error('CLI tarball is unexpectedly small.');
fs.writeFileSync(assetPath, `${bytes.toString('base64')}\n`, 'utf8');

const packageJson = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
if (!packageJson.bin?.['nakwol-connect']) throw new Error('CLI package bin mapping is missing.');

console.log(`NAKWOL_CONNECT_CLI_PACKED:${path.relative(root, tarballPath)}:${bytes.length}`);
