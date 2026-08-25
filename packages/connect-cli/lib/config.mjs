import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_CONFIG_FILE = '.nakwol-connect.json';

export function buildProjectConfig({ clientId, framework, redirectUris }) {
  return {
    version: 1,
    clientId,
    framework,
    redirectUris: [...redirectUris],
    integration: 'universal-embed',
  };
}

export function sessionFilePath(home = os.homedir()) {
  return path.join(home, '.nakwol', 'connect', 'session.json');
}

export async function readProjectConfig(root) {
  try {
    return JSON.parse(await fs.readFile(path.join(root, PROJECT_CONFIG_FILE), 'utf8'));
  } catch {
    return null;
  }
}

export async function writeProjectConfig(root, config) {
  const target = path.join(root, PROJECT_CONFIG_FILE);
  await fs.writeFile(target, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8' });
  return target;
}

export async function readSession(home = os.homedir()) {
  try {
    const value = JSON.parse(await fs.readFile(sessionFilePath(home), 'utf8'));
    if (!value?.accessToken || !value?.expiresAt || Date.now() >= value.expiresAt) return null;
    return value;
  } catch {
    return null;
  }
}

export async function writeSession(session, home = os.homedir()) {
  const target = sessionFilePath(home);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, `${JSON.stringify(session, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try { await fs.chmod(target, 0o600); } catch {}
  return target;
}

export async function clearSession(home = os.homedir()) {
  try { await fs.unlink(sessionFilePath(home)); } catch {}
}
