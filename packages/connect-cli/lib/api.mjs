export class ConnectApiError extends Error {
  constructor(code, message, status = 0, details = null) {
    super(message || code);
    this.name = 'ConnectApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ConnectApi {
  constructor({ origin, accessToken = null, fetchImpl = globalThis.fetch } = {}) {
    this.origin = String(origin || 'https://nakwol-auth.sepsd21.workers.dev').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  withToken(accessToken) {
    return new ConnectApi({ origin: this.origin, accessToken, fetchImpl: this.fetchImpl });
  }

  async request(path, { method = 'GET', body, auth = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    const response = await this.fetchImpl(`${this.origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new ConnectApiError(
        payload?.error?.code || 'REMOTE_REQUEST_FAILED',
        payload?.error?.message || `NAKWOL Connect request failed (${response.status})`,
        response.status,
        payload,
      );
    }
    return payload.data;
  }

  startDevice(metadata = {}) {
    return this.request('/connect/api/device/start', { method: 'POST', body: metadata, auth: false });
  }

  pollDevice(deviceCode) {
    return this.request('/connect/api/device/poll', { method: 'POST', body: { device_code: deviceCode }, auth: false });
  }

  me() {
    return this.request('/connect/api/cli/me');
  }

  createApp(input) {
    return this.request('/connect/api/cli/apps', { method: 'POST', body: input });
  }

  getApp(clientId) {
    return this.request(`/connect/api/cli/apps/${encodeURIComponent(clientId)}`);
  }

  updateApp(clientId, patch) {
    return this.request(`/connect/api/cli/apps/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: patch });
  }

  addUrl(clientId, url) {
    return this.request(`/connect/api/cli/apps/${encodeURIComponent(clientId)}/urls`, { method: 'POST', body: { url } });
  }

  disableApp(clientId) {
    return this.request(`/connect/api/cli/apps/${encodeURIComponent(clientId)}/disable`, { method: 'POST', body: {} });
  }
}
