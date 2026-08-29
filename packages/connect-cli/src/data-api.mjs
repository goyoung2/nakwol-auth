export class ConnectDataApiError extends Error {
  constructor(code, message, status, payload = null) {
    super(message || code || `HTTP ${status}`);
    this.name = 'ConnectDataApiError';
    this.code = code || 'DATA_API_ERROR';
    this.status = status;
    this.payload = payload;
  }
}
export class ConnectDataApi {
  constructor({ dataOrigin, accessToken = null, fetchImpl = globalThis.fetch }) {
    this.dataOrigin = String(dataOrigin).replace(/\/$/, '');
    this.accessToken = accessToken;
    this.fetchImpl = fetchImpl;
  }
  async publicRequest(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(`${this.dataOrigin}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = payload?.error;
      throw new ConnectDataApiError(error?.code, error?.message, response.status, payload);
    }
    return payload;
  }
  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.accessToken) headers.set('Authorization', `Bearer ${this.accessToken}`);
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const response = await this.fetchImpl(`${this.dataOrigin}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = payload?.error;
      throw new ConnectDataApiError(error?.code, error?.message, response.status, payload);
    }
    return payload;
  }
  async describe() { return this.publicRequest('/openapi.json'); }
  async getScopes(clientId) { return this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}/scopes`); }
  async setScopes(clientId, scopes) { return this.request(`/connect/cli/apps/${encodeURIComponent(clientId)}/scopes`, { method:'PUT', body:JSON.stringify({ scopes }) }); }
}
