export class ConnectApiError extends Error {
  constructor(code, message, status, payload = null) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ConnectApiError';
    this.code = code || 'API_ERROR';
    this.status = status;
    this.payload = payload;
  }
}

export class ConnectApi {
  constructor({ authOrigin, accessToken = null, fetchImpl = globalThis.fetch }) {
    this.authOrigin = String(authOrigin).replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }

  withToken(accessToken) {
    return new ConnectApi({ authOrigin: this.authOrigin, accessToken, fetchImpl: this.fetchImpl });
  }

  async request(path, options = {}, allowedStatuses = []) {
    const headers = new Headers(options.headers || {});
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(`${this.authOrigin}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const error = payload?.error;
      throw new ConnectApiError(
        typeof error === 'string' ? error : error?.code,
        typeof error === 'string' ? error : error?.message,
        response.status,
        payload,
      );
    }
    return { response, payload };
  }

  async startDevice() {
    return (await this.request('/connect/cli/device/start', { method: 'POST', body: JSON.stringify({ scopes: ['connect:apps'] }) })).payload;
  }

  async pollDevice(deviceCode) {
    return this.request('/connect/cli/device/token', { method: 'POST', body: JSON.stringify({ device_code: deviceCode }) }, [400, 403, 428]);
  }

  async me() {
    return (await this.request('/connect/cli/me')).payload;
  }

  async createApp(input) {
    return (await this.request('/connect/cli/apps', { method: 'POST', body: JSON.stringify(input) })).payload;
  }

  async getApp(clientId) {
    return (await this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}`)).payload;
  }

  async patchApp(clientId, input) {
    return (await this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}`, { method: 'PATCH', body: JSON.stringify(input) })).payload;
  }

  async addRedirect(clientId, redirectUri) {
    return (await this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}/redirects`, { method: 'POST', body: JSON.stringify({ redirect_uri: redirectUri }) })).payload;
  }

  async diagnose(clientId) {
    return (await this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}/diagnose`)).payload;
  }
}
