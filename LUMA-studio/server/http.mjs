// Minimal HTTP helpers: a pattern router, bounded body reading and JSON responses.
// Kept dependency-free so the studio server runs on a plain Node 22 install.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message, details) { return new HttpError(400, message, details); }
export function notFound(message = '요청한 항목을 찾을 수 없습니다.') { return new HttpError(404, message); }

export class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler) {
    const keys = [];
    const source = pattern.replace(/\/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; });
    this.routes.push({ method, keys, regex: new RegExp(`^${source}/?$`), handler });
    return this;
  }

  get(pattern, handler) { return this.add('GET', pattern, handler); }
  post(pattern, handler) { return this.add('POST', pattern, handler); }
  patch(pattern, handler) { return this.add('PATCH', pattern, handler); }
  delete(pattern, handler) { return this.add('DELETE', pattern, handler); }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.routes) {
      const found = route.regex.exec(pathname);
      if (!found) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((key, index) => { params[key] = decodeURIComponent(found[index + 1]); });
      return { handler: route.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

export function readBody(req, { limit }) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { reject(new HttpError(413, `요청 본문이 너무 큽니다. 최대 ${Math.round(limit / 1048576)} MB까지 허용됩니다.`)); req.resume(); return; }
    const chunks = [];
    let received = 0;
    req.on('data', chunk => {
      received += chunk.length;
      if (received > limit) { reject(new HttpError(413, `요청 본문이 너무 큽니다. 최대 ${Math.round(limit / 1048576)} MB까지 허용됩니다.`)); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJSON(req, { limit = 1024 * 1024 } = {}) {
  const body = await readBody(req, { limit });
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); } catch { throw badRequest('JSON 본문을 해석할 수 없습니다.'); }
}

export function sendJSON(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

export function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error(error);
  sendJSON(res, status, { error: status >= 500 ? '서버 내부 오류가 발생했습니다.' : error.message, ...(error.details ? { details: error.details } : {}) });
}
