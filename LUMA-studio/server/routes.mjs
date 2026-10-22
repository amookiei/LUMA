// REST API for the studio. Every route is JSON except the raw PNG upload/download.
import { Router, readBody, readJSON, sendJSON, badRequest } from './http.mjs';

export const API_VERSION = 1;

export function createRouter(store, { maxUploadBytes }) {
  const router = new Router();

  router.get('/api/health', (req, res) => sendJSON(res, 200, { ok: true, api: API_VERSION, storage: 'sqlite', counts: store.counts() }));

  router.get('/api/projects', (req, res) => sendJSON(res, 200, store.listProjects()));
  router.post('/api/projects', async (req, res) => sendJSON(res, 201, store.createProject(await readJSON(req))));
  router.get('/api/projects/:id', (req, res, { id }) => sendJSON(res, 200, store.getProject(id)));
  router.patch('/api/projects/:id', async (req, res, { id }) => sendJSON(res, 200, store.updateProject(id, await readJSON(req))));
  router.delete('/api/projects/:id', async (req, res, { id }) => { await store.deleteProject(id); sendJSON(res, 200, { ok: true }); });

  router.get('/api/projects/:id/renders', (req, res, { id }) => sendJSON(res, 200, store.listRenders(id)));
  router.post('/api/projects/:id/renders', async (req, res, { id }) => {
    if (!/^image\/png\b/i.test(req.headers['content-type'] || '')) throw badRequest('Content-Type은 image/png 이어야 합니다.');
    let meta = {};
    const header = req.headers['x-luma-render'];
    if (header) {
      try { meta = JSON.parse(decodeURIComponent(String(header))); } catch { throw badRequest('X-Luma-Render 헤더를 해석할 수 없습니다.'); }
    }
    const png = await readBody(req, { limit: maxUploadBytes });
    sendJSON(res, 201, await store.createRender(id, png, meta));
  });
  router.delete('/api/projects/:id/renders', async (req, res, { id }) => sendJSON(res, 200, { ok: true, deleted: await store.clearRenders(id) }));

  router.get('/api/renders/:id', (req, res, { id }) => sendJSON(res, 200, store.getRender(id)));
  router.get('/api/renders/:id/image', async (req, res, { id }) => {
    const { render, data } = await store.readRenderImage(id);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': data.length, 'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(render.filename)}` });
    res.end(data);
  });
  router.delete('/api/renders/:id', async (req, res, { id }) => sendJSON(res, 200, await store.deleteRender(id)));

  router.get('/api/looks', (req, res) => sendJSON(res, 200, store.listLooks()));
  router.post('/api/looks', async (req, res) => sendJSON(res, 201, store.createLook(await readJSON(req))));
  router.delete('/api/looks/:id', (req, res, { id }) => { store.deleteLook(id); sendJSON(res, 200, { ok: true }); });

  router.get('/api/projects/:id/views', (req, res, { id }) => sendJSON(res, 200, store.listViews(id)));
  router.post('/api/projects/:id/views', async (req, res, { id }) => sendJSON(res, 201, store.createView(id, await readJSON(req))));
  router.delete('/api/views/:id', (req, res, { id }) => sendJSON(res, 200, store.deleteView(id)));

  return router;
}
