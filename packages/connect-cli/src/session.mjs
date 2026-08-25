import { mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { ConnectApi } from './api.mjs';

export function defaultSessionPath() {
  return join(homedir(), '.nakwol', 'connect-cli-session.json');
}

export async function readSession(path = defaultSessionPath()) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (!value?.accessToken || !value?.expiresAt) return null;
    if (Date.now() >= Number(value.expiresAt)) return null;
    return value;
  } catch {
    return null;
  }
}

export async function writeSession(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try { await chmod(path, 0o600); } catch {}
}

export async function clearSession(path = defaultSessionPath()) {
  await rm(path, { force: true });
}

export function openBrowser(url) {
  try {
    let command;
    let args;
    if (process.platform === 'win32') {
      command = 'cmd'; args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      command = 'open'; args = [url];
    } else {
      command = 'xdg-open'; args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function ensureSession({
  authOrigin,
  sessionPath = defaultSessionPath(),
  noOpen = false,
  output = console.log,
  fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}) {
  const stored = await readSession(sessionPath);
  if (stored && (!stored.authOrigin || stored.authOrigin === authOrigin)) {
    try {
      const api = new ConnectApi({ authOrigin, accessToken: stored.accessToken, fetchImpl });
      const me = await api.me();
      if (me?.ok) return { ...stored, me: me.data };
    } catch {}
    await clearSession(sessionPath);
  }

  const publicApi = new ConnectApi({ authOrigin, fetchImpl });
  const grant = await publicApi.startDevice();
  const verificationUrl = grant.verification_uri_complete || grant.verification_uri;
  output('NAKWOL Connect 인증이 필요합니다.');
  output(`승인 코드: ${grant.user_code}`);
  output(`승인 주소: ${verificationUrl}`);
  if (!noOpen) openBrowser(verificationUrl);

  const startedAt = Date.now();
  const expiresAt = startedAt + Number(grant.expires_in || 600) * 1000;
  const intervalMs = Math.max(0, Number(grant.interval ?? 3) * 1000);
  while (Date.now() < expiresAt) {
    if (intervalMs) await sleep(intervalMs);
    const { response, payload } = await publicApi.pollDevice(grant.device_code);
    if (response.ok && payload.access_token) {
      const session = {
        accessToken: payload.access_token,
        expiresAt: Date.now() + Math.max(1, Number(payload.expires_in || 3600) - 30) * 1000,
        authOrigin,
      };
      await writeSession(sessionPath, session);
      const api = publicApi.withToken(session.accessToken);
      const me = await api.me();
      return { ...session, me: me.data };
    }
    if (payload?.error === 'authorization_pending') continue;
    if (payload?.error === 'access_denied') throw new Error('NAKWOL Connect CLI 연결이 거절되었습니다.');
    if (payload?.error === 'expired_token') throw new Error('NAKWOL Connect CLI 승인 요청이 만료되었습니다.');
    throw new Error(payload?.error || `NAKWOL Connect device authorization failed (HTTP ${response.status})`);
  }
  throw new Error('NAKWOL Connect CLI 승인 요청이 만료되었습니다.');
}
