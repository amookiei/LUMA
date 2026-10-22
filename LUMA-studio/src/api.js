// Client for the studio persistence API. When the app is served as plain static files
// (no /api), `available` is false and the app keeps everything in memory instead.
export class StudioAPI {
  constructor(base = './api') {
    this.base = new URL(base, document.baseURI).href.replace(/\/$/, '');
    this.available = false;
  }

  async probe() {
    this.storageError = null;
    try {
      const response = await fetch(`${this.base}/health`, { cache: 'no-store' });
      const data = response.ok ? await response.json() : null;
      this.available = !!data?.ok;
      if (data && !data.ok && data.reason) this.storageError = data.reason;
    } catch { this.available = false; }
    return this.available;
  }

  async request(method, path, { json, body, headers = {} } = {}) {
    const response = await fetch(`${this.base}${path}`, { method, headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json !== undefined ? JSON.stringify(json) : body });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || `서버 요청에 실패했습니다 (${response.status}).`);
    return data;
  }

  listProjects() { return this.request('GET', '/projects'); }
  createProject(input) { return this.request('POST', '/projects', { json: input }); }
  updateProject(id, input) { return this.request('PATCH', `/projects/${id}`, { json: input }); }
  deleteProject(id) { return this.request('DELETE', `/projects/${id}`); }

  listRenders(projectId) { return this.request('GET', `/projects/${projectId}/renders`); }
  uploadRender(projectId, blob, meta) {
    return this.request('POST', `/projects/${projectId}/renders`, { body: blob, headers: { 'Content-Type': 'image/png', 'X-Luma-Render': encodeURIComponent(JSON.stringify(meta)) } });
  }
  deleteRender(id) { return this.request('DELETE', `/renders/${id}`); }
  clearRenders(projectId) { return this.request('DELETE', `/projects/${projectId}/renders`); }
  renderImageURL(id) { return `${this.base}/renders/${id}/image`; }
  async fetchRenderBlob(id) {
    const response = await fetch(this.renderImageURL(id));
    if (!response.ok) throw new Error('이미지를 불러오지 못했습니다.');
    return response.blob();
  }

  listLooks() { return this.request('GET', '/looks'); }
  createLook(input) { return this.request('POST', '/looks', { json: input }); }
  deleteLook(id) { return this.request('DELETE', `/looks/${id}`); }

  listViews(projectId) { return this.request('GET', `/projects/${projectId}/views`); }
  createView(projectId, input) { return this.request('POST', `/projects/${projectId}/views`, { json: input }); }
  deleteView(id) { return this.request('DELETE', `/views/${id}`); }
}
