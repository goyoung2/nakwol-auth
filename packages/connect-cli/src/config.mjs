import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const PROJECT_CONFIG_FILE = '.nakwol-connect.json';

export async function readProjectConfig(root = process.cwd()) {
  try {
    const value = JSON.parse(await readFile(join(root, PROJECT_CONFIG_FILE), 'utf8'));
    return value && value.version === 1 ? value : null;
  } catch {
    return null;
  }
}

export async function writeProjectConfig(root, config) {
  const value = {
    version: 1,
    clientId: config.clientId,
    framework: config.framework,
    redirectUris: [...new Set(config.redirectUris || [])],
    integration: config.integration,
  };
  await writeFile(join(root, PROJECT_CONFIG_FILE), `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export async function removeProjectConfig(root = process.cwd()) {
  await rm(join(root, PROJECT_CONFIG_FILE), { force: true });
}
