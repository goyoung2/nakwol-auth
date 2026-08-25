#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ConnectApi, ConnectApiError } from '../lib/api.mjs';
import {
  PROJECT_CONFIG_FILE,
  buildProjectConfig,
  clearSession,
  readProjectConfig,
  readSession,
  writeProjectConfig,
  writeSession,
} from '../lib/config.mjs';
import { applyIntegration, doctorIntegration, InstallError, removeLocalIntegration } from '../lib/install.mjs';
import { defaultLocalUrl, findProjectRoot, inspectProject, projectName } from '../lib/project.mjs';

const VERSION = '0.2.0';
const DEFAULT_ORIGIN = 'https://nakwol-auth.sepsd21.workers.dev';
const origin = (process.env.NAKWOL_CONNECT_ORIGIN || DEFAULT_ORIGIN).replace(/\/$/, '');
const argv = process.argv.slice(2);
const jsonMode = argv.includes('--json');

function value(name) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : null;
}

function has(name) {
  return argv.includes(name);
}

function commandName() {
  return argv.find((arg) => !arg.startsWith('-')) || 'help';
}

function emit(event, data = {}) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ event, ...data })}\n`);
    return;
  }
  if (event === 'device_authorization') {
    console.log('\nNAKWOL Connect 인증이 필요합니다.');
    console.log(`코드: ${data.user_code}`);
    console.log(`승인: ${data.verification_uri_complete}`);
    console.log('브라우저에서 승인하면 이 명령이 자동으로 계속 진행됩니다.\n');
    return;
  }
  if (event === 'ok') console.log(`✓ ${data.message}`);
  else if (event === 'info') console.log(data.message);
  else if (event === 'result') console.log(typeof data.value === 'string' ? data.value : JSON.stringify(data.value, null, 2));
}

function fail(code, message, details = null) {
  const payload = { ok: false, error: { code, message, ...(details ? { details } : {}) } };
  if (jsonMode) process.stderr.write(`${JSON.stringify(payload)}\n`);
  else {
    console.error(`\nNAKWOL Connect 오류 [${code}]`);
    console.error(message);
    if (details?.instruction) console.error(`\n${details.instruction}`);
  }
  process.exitCode = 1;
}

function help() {
  const text = `NAKWOL Connect CLI v${VERSION}\n\n사용법:\n  nakwol-connect init [--url URL] [--client-id ID] [--name NAME] [--policy member|public|admin]\n  nakwol-connect login\n  nakwol-connect status\n  nakwol-connect doctor\n  nakwol-connect add-url <URL>\n  nakwol-connect sync\n  nakwol-connect remove [--remote]\n\n옵션:\n  --json       에이전트용 JSON Lines 출력\n  --url URL    등록할 정확한 redirect URI\n  --client-id  선호 Client ID (충돌 시 서버가 suffix 추가)\n  --policy     기본 member\n`;
  emit('result', { value: text });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openBrowser(url) {
  if (process.env.NAKWOL_CONNECT_NO_BROWSER === '1') return false;
  try {
    let child;
    if (process.platform === 'win32') child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    else if (process.platform === 'darwin') child = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function validatedSession() {
  const session = await readSession();
  if (!session || session.origin !== origin) return null;
  const api = new ConnectApi({ origin, accessToken: session.accessToken });
  try {
    const me = await api.me();
    return { session, api, me };
  } catch (error) {
    if (error instanceof ConnectApiError && [401, 403].includes(error.status)) await clearSession();
    return null;
  }
}

async function login(metadata = {}, { force = false } = {}) {
  if (!force) {
    const existing = await validatedSession();
    if (existing) {
      emit('ok', { message: `${existing.me.display_name || existing.me.id} 계정으로 이미 로그인됨` });
      return existing;
    }
  }

  const publicApi = new ConnectApi({ origin });
  const device = await publicApi.startDevice(metadata);
  emit('device_authorization', device);
  openBrowser(device.verification_uri_complete);

  const deadline = Date.now() + Number(device.expires_in || 600) * 1000;
  const interval = Math.max(1, Number(device.interval || 2)) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    try {
      const result = await publicApi.pollDevice(device.device_code);
      if (result.status === 'pending') continue;
      if (result.access_token) {
        const expiresAt = Date.now() + Number(result.expires_in || 2592000) * 1000;
        const session = { origin, accessToken: result.access_token, expiresAt };
        await writeSession(session);
        const api = new ConnectApi({ origin, accessToken: result.access_token });
        const me = await api.me();
        emit('ok', { message: `CLI 로그인 완료: ${me.display_name || me.id}` });
        return { session, api, me };
      }
    } catch (error) {
      if (error instanceof ConnectApiError && error.code === 'DEVICE_DENIED') throw error;
      if (error instanceof ConnectApiError && ['DEVICE_EXPIRED', 'DEVICE_CONSUMED'].includes(error.code)) throw error;
      throw error;
    }
  }
  throw new ConnectApiError('DEVICE_EXPIRED', 'CLI 승인 시간이 만료되었습니다. 다시 login/init을 실행해 주세요.');
}

async function ensureLogin(metadata = {}) {
  return (await validatedSession()) || login(metadata);
}

function nonLocalHomepage(urlValue) {
  if (!urlValue) return null;
  try {
    const url = new URL(urlValue);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function projectContext() {
  const root = await findProjectRoot(process.cwd());
  const project = await inspectProject(root);
  return { root, project, config: await readProjectConfig(root) };
}

async function initCommand() {
  const { root, project, config: existingConfig } = await projectContext();
  const name = value('--name') || projectName(project);
  const explicitUrl = value('--url');
  const redirectUri = explicitUrl || existingConfig?.redirectUris?.[0] || defaultLocalUrl(project.framework);
  if (!redirectUri) {
    throw new InstallError('INVALID_REDIRECT_URI', '이 프로젝트는 개발 서버 URL을 안전하게 추정할 수 없습니다. --url <정확한 URL>을 지정해 주세요.', {
      instruction: '예: npx ... init --url https://my-app.pages.dev/',
    });
  }

  const { api } = await ensureLogin({ project_name: name, framework: project.framework, homepage_url: nonLocalHomepage(explicitUrl) });
  let remote;
  if (existingConfig?.clientId) {
    remote = await api.getApp(existingConfig.clientId);
    if (!remote.redirect_uris.includes(redirectUri)) remote = await api.addUrl(existingConfig.clientId, redirectUri);
  } else {
    remote = await api.createApp({
      name,
      requested_client_id: value('--client-id') || name,
      framework: project.framework,
      homepage_url: nonLocalHomepage(explicitUrl),
      redirect_uris: [redirectUri],
      access_policy: value('--policy') || 'member',
    });
    emit('ok', { message: `중앙 앱 등록: ${remote.client_id}` });
  }

  const patch = await applyIntegration(project, { clientId: remote.client_id, redirectUri, origin });
  emit('ok', { message: `${patch.file} ${patch.changed ? '수정 완료' : '이미 설치됨'}` });

  const config = buildProjectConfig({
    clientId: remote.client_id,
    framework: project.framework,
    redirectUris: remote.redirect_uris,
  });
  await writeProjectConfig(root, config);
  emit('ok', { message: `${PROJECT_CONFIG_FILE} 저장` });

  const doctor = await doctorIntegration(project, { ...config, redirectUris: [redirectUri, ...config.redirectUris.filter((item) => item !== redirectUri)] }, origin);
  if (!doctor.ok) throw new InstallError('DOCTOR_FAILED', '설치는 수행했지만 로컬 검증이 실패했습니다.', { checks: doctor.checks });
  emit('result', { value: { ok: true, client_id: remote.client_id, framework: project.framework, redirect_uri: redirectUri, file: patch.file, doctor } });
}

async function statusCommand() {
  const { project, config } = await projectContext();
  const local = { config, framework: project.framework };
  const session = await validatedSession();
  let remote = null;
  if (session && config?.clientId) {
    try { remote = await session.api.getApp(config.clientId); } catch (error) { remote = { error: error.code || error.message }; }
  }
  emit('result', { value: { ok: Boolean(config), local, remote, authenticated: Boolean(session) } });
}

async function doctorCommand() {
  const { project, config } = await projectContext();
  const doctor = await doctorIntegration(project, config, origin);
  emit('result', { value: doctor });
  if (!doctor.ok) process.exitCode = 1;
}

async function addUrlCommand() {
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  const url = positional[1] || value('--url');
  if (!url) throw new InstallError('INVALID_REDIRECT_URI', '추가할 URL이 필요합니다.');
  const { root, config } = await projectContext();
  if (!config?.clientId) throw new InstallError('NOT_INITIALIZED', '먼저 init을 실행해 주세요.');
  const { api } = await ensureLogin();
  const remote = await api.addUrl(config.clientId, url);
  await writeProjectConfig(root, buildProjectConfig({ clientId: config.clientId, framework: config.framework, redirectUris: remote.redirect_uris }));
  emit('result', { value: { ok: true, client_id: config.clientId, redirect_uris: remote.redirect_uris } });
}

async function syncCommand() {
  const { root, project, config } = await projectContext();
  if (!config?.clientId) throw new InstallError('NOT_INITIALIZED', '먼저 init을 실행해 주세요.');
  const { api } = await ensureLogin();
  const remote = await api.updateApp(config.clientId, { framework: project.framework, redirect_uris: config.redirectUris });
  await writeProjectConfig(root, buildProjectConfig({ clientId: remote.client_id, framework: project.framework, redirectUris: remote.redirect_uris }));
  const redirectUri = config.redirectUris[0];
  if (redirectUri) await applyIntegration(project, { clientId: remote.client_id, redirectUri, origin });
  emit('result', { value: { ok: true, app: remote } });
}

async function removeCommand() {
  const { root, project, config } = await projectContext();
  if (!config?.clientId) throw new InstallError('NOT_INITIALIZED', 'NAKWOL Connect 설정이 없습니다.');
  if (has('--remote')) {
    const { api } = await ensureLogin();
    await api.disableApp(config.clientId);
    emit('ok', { message: `원격 앱 ${config.clientId} 비활성화` });
  }
  const local = await removeLocalIntegration(project, config.clientId);
  try { await fs.unlink(path.join(root, PROJECT_CONFIG_FILE)); } catch {}
  emit('result', { value: { ok: true, removed_file: local.file, source_changed: local.changed, remote_disabled: has('--remote') } });
}

async function main() {
  if (has('--version') || argv[0] === 'version') {
    emit('result', { value: VERSION });
    return;
  }
  if (has('--help') || argv[0] === 'help' || argv.length === 0) {
    help();
    return;
  }
  const command = commandName();
  if (command === 'init') return initCommand();
  if (command === 'login') {
    const project = await inspectProject(await findProjectRoot(process.cwd()));
    const result = await login({ project_name: projectName(project), framework: project.framework }, { force: has('--force') });
    emit('result', { value: { ok: true, user: result.me } });
    return;
  }
  if (command === 'status') return statusCommand();
  if (command === 'doctor') return doctorCommand();
  if (command === 'add-url') return addUrlCommand();
  if (command === 'sync') return syncCommand();
  if (command === 'remove') return removeCommand();
  throw new InstallError('UNKNOWN_COMMAND', `알 수 없는 명령: ${command}`);
}

main().catch((error) => {
  if (error instanceof ConnectApiError || error instanceof InstallError) fail(error.code, error.message, error.details);
  else fail(error?.code || 'UNEXPECTED_ERROR', error?.message || String(error));
});
