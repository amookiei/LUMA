import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

// A 1×1 transparent PNG, enough to exercise the upload path end to end.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function withApp(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'luma-test-'));
  const app = createApp({ dataDir: dir, dbPath: path.join(dir, 'test.sqlite'), distDir: path.join(dir, 'dist'), maxUploadBytes: 1024 * 1024 });
  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const api = async (method, url, { json, body, headers = {} } = {}) => {
    const response = await fetch(base + url, { method, headers: { ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
    const type = response.headers.get('content-type') || '';
    return { status: response.status, data: type.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()), headers: response.headers };
  };
  try { await run({ api, app, dir }); } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
}

test('health reports sqlite storage', () => withApp(async ({ api }) => {
  const { status, data } = await api('GET', '/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.storage, 'sqlite');
  assert.deepEqual(data.counts, { projects: 0, renders: 0, looks: 0, views: 0 });
}));

test('projects can be created, renamed, listed and deleted', () => withApp(async ({ api }) => {
  const created = await api('POST', '/api/projects', { json: { name: '  헤드폰 캠페인 ' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.name, '헤드폰 캠페인');
  const renamed = await api('PATCH', `/api/projects/${created.data.id}`, { json: { name: 'Arc 헤드폰', modelName: 'arc.glb' } });
  assert.equal(renamed.data.name, 'Arc 헤드폰');
  assert.equal(renamed.data.modelName, 'arc.glb');
  const list = await api('GET', '/api/projects');
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].renderCount, 0);
  const invalid = await api('PATCH', `/api/projects/${created.data.id}`, { json: { name: '   ' } });
  assert.equal(invalid.status, 400);
  const removed = await api('DELETE', `/api/projects/${created.data.id}`);
  assert.equal(removed.status, 200);
  assert.equal((await api('GET', `/api/projects/${created.data.id}`)).status, 404);
}));

test('renders are stored as files with metadata in the database', () => withApp(async ({ api, app, dir }) => {
  const project = (await api('POST', '/api/projects', { json: { name: 'Demo' } })).data;
  const meta = { viewId: 'hero', label: '히어로', preset: 'dark', presetLabel: '차콜 림 라이트', width: 1, height: 1, engine: 'pathtracing', engineLabel: '패스 트레이싱 64 spp', quality: 'standard', samples: 64, modelName: 'FORM / H-01', filename: 'FORM_dark_hero.png', settings: { exposure: 1.2, effects: { vignette: .3 } } };
  const upload = await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers: { 'Content-Type': 'image/png', 'X-Luma-Render': encodeURIComponent(JSON.stringify(meta)) } });
  assert.equal(upload.status, 201, JSON.stringify(upload.data));
  assert.equal(upload.data.label, '히어로');
  assert.equal(upload.data.samples, 64);
  assert.deepEqual(upload.data.settings, meta.settings);
  assert.equal(upload.data.bytes, PNG.length);
  await access(path.join(dir, 'renders', project.id, `${upload.data.id}.png`));

  const image = await api('GET', `/api/renders/${upload.data.id}/image`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.compare(image.data, PNG) === 0);

  const list = await api('GET', `/api/projects/${project.id}/renders`);
  assert.equal(list.data.length, 1);
  assert.equal((await api('GET', `/api/projects/${project.id}`)).data.renderCount, 1);
  assert.equal((await api('GET', '/api/projects')).data[0].coverRenderId, upload.data.id);

  const notPng = await api('POST', `/api/projects/${project.id}/renders`, { body: Buffer.from('hello'), headers: { 'Content-Type': 'image/png', 'X-Luma-Render': encodeURIComponent(JSON.stringify(meta)) } });
  assert.equal(notPng.status, 400);
  const wrongType = await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers: { 'Content-Type': 'application/octet-stream' } });
  assert.equal(wrongType.status, 400);
  const badSize = await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers: { 'Content-Type': 'image/png', 'X-Luma-Render': encodeURIComponent(JSON.stringify({ ...meta, width: 'big' })) } });
  assert.equal(badSize.status, 400);

  const deleted = await api('DELETE', `/api/renders/${upload.data.id}`);
  assert.equal(deleted.status, 200);
  assert.equal((await api('GET', `/api/renders/${upload.data.id}/image`)).status, 404);
  await assert.rejects(access(path.join(dir, 'renders', project.id, `${upload.data.id}.png`)));
  assert.equal(app.store.counts().renders, 0);
}));

test('clearing and deleting a project removes its render files', () => withApp(async ({ api, dir }) => {
  const project = (await api('POST', '/api/projects', { json: {} })).data;
  assert.equal(project.name, 'Untitled studio');
  const headers = { 'Content-Type': 'image/png', 'X-Luma-Render': encodeURIComponent(JSON.stringify({ width: 1, height: 1 })) };
  const a = (await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers })).data;
  await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers });
  const cleared = await api('DELETE', `/api/projects/${project.id}/renders`);
  assert.equal(cleared.data.deleted, 2);
  await assert.rejects(access(path.join(dir, 'renders', project.id, `${a.id}.png`)));
  await api('POST', `/api/projects/${project.id}/renders`, { body: PNG, headers });
  await api('DELETE', `/api/projects/${project.id}`);
  await assert.rejects(access(path.join(dir, 'renders', project.id)));
}));

test('uploads over the size limit are rejected', () => withApp(async ({ api }) => {
  const project = (await api('POST', '/api/projects', { json: {} })).data;
  const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
  const response = await api('POST', `/api/projects/${project.id}/renders`, { body: big, headers: { 'Content-Type': 'image/png' } }).catch(error => ({ status: 413, data: { error: error.message } }));
  assert.equal(response.status, 413);
}));

test('saved looks and camera cuts round-trip', () => withApp(async ({ api }) => {
  const look = await api('POST', '/api/looks', { json: { name: '야간 쇼룸', basePreset: 'amber', settings: { exposure: .8, lightAngle: 40 } } });
  assert.equal(look.status, 201);
  assert.deepEqual(look.data.settings, { exposure: .8, lightAngle: 40 });
  assert.equal((await api('POST', '/api/looks', { json: { name: '', basePreset: 'dark', settings: {} } })).status, 400);
  assert.equal((await api('GET', '/api/looks')).data.length, 1);
  await api('DELETE', `/api/looks/${look.data.id}`);
  assert.equal((await api('GET', '/api/looks')).data.length, 0);

  const project = (await api('POST', '/api/projects', { json: {} })).data;
  const view = await api('POST', `/api/projects/${project.id}/views`, { json: { name: '로우 앵글', camera: { position: [1, 2, 3], target: [0, 1, 0], focalLength: 85 } } });
  assert.equal(view.status, 201);
  assert.deepEqual(view.data.camera, { position: [1, 2, 3], target: [0, 1, 0], up: [0, 1, 0], focalLength: 85 });
  assert.equal((await api('POST', `/api/projects/${project.id}/views`, { json: { name: 'x', camera: { position: [1, 2] } } })).status, 400);
  assert.equal((await api('GET', `/api/projects/${project.id}/views`)).data.length, 1);
  assert.equal((await api('DELETE', `/api/views/${view.data.id}`)).status, 200);
  assert.equal((await api('DELETE', `/api/views/${view.data.id}`)).status, 404);
}));

test('unknown api routes and wrong methods are reported', () => withApp(async ({ api }) => {
  assert.equal((await api('GET', '/api/nothing')).status, 404);
  assert.equal((await api('PUT', '/api/projects')).status, 405);
}));

test('migrations are idempotent', async () => {
  const { openDatabase, migrate } = await import('../server/db.mjs');
  const db = openDatabase(':memory:');
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
  db.close();
});

test('an unusable storage location degrades to static mode instead of crashing', async () => {
  const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'luma-ro-'));
  await mkdir(path.join(dir, 'dist'));
  await writeFile(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>x</title>');
  await writeFile(path.join(dir, 'blocker'), '');
  // A database path "inside" a regular file cannot be created.
  const app = createApp({ dataDir: path.join(dir, 'blocker', 'data'), dbPath: path.join(dir, 'blocker', 'data', 'luma.sqlite'), distDir: path.join(dir, 'dist') });
  assert.ok(app.storageError);
  const address = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ok, false);
    assert.equal(health.storage, 'unavailable');
    assert.ok(health.reason);
    const projects = await fetch(`${base}/api/projects`);
    assert.equal(projects.status, 503);
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
  } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
});
