import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { detectProject } from './project.mjs';
import { installIntegration, removeIntegration } from './integration.mjs';
import { readProjectConfig, writeProjectConfig, removeProjectConfig } from './config.mjs';
import { ensureSession, readSession, defaultSessionPath } from './session.mjs';
import { ConnectApi } from './api.mjs';

export const DEFAULT_AUTH_ORIGIN = 'https://nakwol-auth.sepsd21.workers.dev';

async function markerPresent(root, project) {
  if (!project?.targetFile) return false;
  try {
    const source = await readFile(join(root, project.targetFile), 'utf8');
    return source.includes('NAKWOL-CONNECT:START');
  } catch {
    return false;
  }
}

async function authenticatedApi(options) {
  const session = await ensureSession({
    authOrigin: options.authOrigin || DEFAULT_AUTH_ORIGIN,
    sessionPath: options.sessionPath || defaultSessionPath(),
    noOpen: Boolean(options.noOpen),
    output: options.output || console.log,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    sleep: options.sleep,
  });
  return {
    session,
    api: new ConnectApi({
      authOrigin: options.authOrigin || DEFAULT_AUTH_ORIGIN,
      accessToken: session.accessToken,
      fetchImpl: options.fetchImpl || globalThis.fetch,
    }),
  };
}

export async function initProject(options = {}) {
  const root = options.root || process.cwd();
  const authOrigin = options.authOrigin || DEFAULT_AUTH_ORIGIN;
  const output = options.output || console.log;
  const project = await detectProject(root);
  if (!project.targetFile || project.framework === 'unknown') throw new Error('지원되는 웹 프로젝트를 찾지 못했습니다.');

  const existingConfig = await readProjectConfig(root);
  const { api } = await authenticatedApi({ ...options, root, authOrigin, output });
  let app;

  if (existingConfig?.clientId) {
    try {
      app = (await api.getApp(existingConfig.clientId)).data;
    } catch (error) {
      if (error?.status === 404) app = null;
      else throw error;
    }
  }

  if (!app) {
    const redirectUris = [...new Set([
      ...(existingConfig?.redirectUris || []),
      ...(options.url ? [options.url] : []),
      ...(project.defaultRedirectUri ? [project.defaultRedirectUri] : []),
    ])];
    const payload = await api.createApp({
      name: options.name || project.projectName,
      client_id: options.clientId || existingConfig?.clientId || project.projectName,
      homepage_url: options.url || null,
      framework: project.framework,
      access_policy: options.accessPolicy || 'member',
      redirect_uris: redirectUris,
    });
    app = payload.data;
  } else if (options.url && !app.redirect_uris.includes(options.url)) {
    app = (await api.addRedirect(app.client_id, options.url)).data;
  }

  const install = await installIntegration(root, project, app.client_id);
  const config = await writeProjectConfig(root, {
    clientId: app.client_id,
    framework: project.framework,
    redirectUris: app.redirect_uris,
    integration: install.integration,
  });
  const doctor = await doctorProject({ root, offline: true });
  if (!doctor.ok) throw new Error(`로컬 Connect 설치 검증 실패: ${doctor.checks.filter((c) => !c.ok).map((c) => c.name).join(', ')}`);
  output(`NAKWOL Connect 연결 완료: ${app.client_id}`);
  return { clientId: app.client_id, project, config, app, doctor };
}

export async function doctorProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const project = await detectProject(root);
  const checks = [
    { name: 'config', ok: Boolean(config?.clientId), detail: config?.clientId || '.nakwol-connect.json missing' },
    { name: 'framework', ok: Boolean(project.targetFile && project.framework !== 'unknown'), detail: project.framework },
    { name: 'marker', ok: await markerPresent(root, project), detail: project.targetFile || 'target missing' },
  ];

  if (!options.offline && config?.clientId) {
    const authOrigin = options.authOrigin || DEFAULT_AUTH_ORIGIN;
    const sessionPath = options.sessionPath || defaultSessionPath();
    const session = await readSession(sessionPath);
    if (session?.accessToken) {
      try {
        const api = new ConnectApi({ authOrigin, accessToken: session.accessToken, fetchImpl: options.fetchImpl || globalThis.fetch });
        const app = (await api.getApp(config.clientId)).data;
        checks.push({ name: 'central_app', ok: Boolean(app?.client_id), detail: app?.status || 'not found' });
        checks.push({ name: 'redirects', ok: (config.redirectUris || []).every((uri) => app.redirect_uris.includes(uri)), detail: `${app.redirect_uris.length} registered` });
      } catch (error) {
        checks.push({ name: 'central_app', ok: false, detail: error.message });
      }
    } else {
      checks.push({ name: 'central_app', ok: false, detail: 'CLI session missing; run init' });
    }
  }
  return { ok: checks.every((item) => item.ok), checks, config, project };
}

export async function statusProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  const project = await detectProject(root);
  const local = { configured: Boolean(config), config, project, marker: await markerPresent(root, project) };
  if (!config?.clientId) return { ok: false, local, central: null };
  const session = await readSession(options.sessionPath || defaultSessionPath());
  if (!session?.accessToken) return { ok: true, local, central: null, note: 'CLI session missing' };
  try {
    const api = new ConnectApi({ authOrigin: options.authOrigin || DEFAULT_AUTH_ORIGIN, accessToken: session.accessToken, fetchImpl: options.fetchImpl || globalThis.fetch });
    return { ok: true, local, central: (await api.getApp(config.clientId)).data };
  } catch (error) {
    return { ok: false, local, central: null, error: error.message };
  }
}

export async function addUrlProject(url, options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) throw new Error('.nakwol-connect.json이 없습니다. 먼저 init을 실행하세요.');
  const { api } = await authenticatedApi(options);
  const app = (await api.addRedirect(config.clientId, url)).data;
  const updated = await writeProjectConfig(root, { ...config, redirectUris: app.redirect_uris });
  return { ok: true, clientId: config.clientId, redirectUris: updated.redirectUris };
}

export async function syncProject(options = {}) {
  const root = options.root || process.cwd();
  const config = await readProjectConfig(root);
  if (!config?.clientId) return initProject(options);
  const project = await detectProject(root);
  const { api } = await authenticatedApi(options);
  const app = (await api.getApp(config.clientId)).data;
  const install = await installIntegration(root, project, config.clientId);
  const updated = await writeProjectConfig(root, {
    ...config,
    framework: project.framework,
    redirectUris: app.redirect_uris,
    integration: install.integration,
  });
  return { ok: true, clientId: config.clientId, config: updated, changedFiles: install.changedFiles };
}

export async function removeProject(options = {}) {
  const root = options.root || process.cwd();
  const project = await detectProject(root);
  const config = await readProjectConfig(root);
  const removed = await removeIntegration(root, project);
  await removeProjectConfig(root);
  return { ok: true, clientId: config?.clientId || null, changedFiles: removed.changedFiles, centralAppPreserved: true };
}
