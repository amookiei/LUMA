// LUMA studio server: serves the built app from dist/ and the persistence API under /api/.
//
// Configuration (environment variables):
//   PORT                 listen port (default 4173)
//   HOST                 bind address (default 127.0.0.1; use 0.0.0.0 to expose on a network)
//   LUMA_DATA_DIR        where render PNGs and the database live (default ./data)
//   LUMA_DB_PATH         SQLite file (default <LUMA_DATA_DIR>/luma.sqlite)
//   LUMA_MAX_UPLOAD_MB   largest accepted render upload (default 96)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { Store } from './store.mjs';
import { createRouter } from './routes.mjs';
import { HttpError, sendError } from './http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };

export function createApp({ dataDir = path.resolve(ROOT, process.env.LUMA_DATA_DIR || 'data'), dbPath = process.env.LUMA_DB_PATH || path.join(dataDir, 'luma.sqlite'),
  distDir = path.resolve(ROOT, 'dist'), maxUploadBytes = Number(process.env.LUMA_MAX_UPLOAD_MB || 96) * 1024 * 1024 } = {}) {
  const db = openDatabase(dbPath);
  const store = new Store(db, { dataDir });
  const router = createRouter(store, { maxUploadBytes });

  async function serveStatic(req, res, pathname) {
    const file = path.resolve(distDir, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (file !== distDir && !file.startsWith(distDir + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(pathname === '/' ? 'dist/ 폴더가 없습니다. 먼저 npm run build 를 실행하세요.' : 'Not found');
    }
  }

  const server = http.createServer(async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
      return serveStatic(req, res, pathname);
    }
    try {
      const match = router.match(req.method, pathname);
      if (!match) throw new HttpError(404, 'API 경로를 찾을 수 없습니다.');
      if (match.methodNotAllowed) throw new HttpError(405, '허용되지 않은 메서드입니다.');
      await match.handler(req, res, match.params);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      sendError(res, error);
    }
  });

  return {
    server, store, db,
    listen(port = Number(process.env.PORT || 4173), host = process.env.HOST || '127.0.0.1') {
      return new Promise(resolve => server.listen(port, host, () => resolve(server.address())));
    },
    async close() {
      await new Promise(resolve => server.close(resolve));
      db.close();
    },
  };
}

