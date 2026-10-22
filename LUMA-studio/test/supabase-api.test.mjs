import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseStudioAPI, roleFor, relativeDirOf, mimeFor, sha256Hex } from '../src/supabase-api.js';

const USER = { id: '11111111-1111-1111-1111-111111111111' };

// A tiny stand-in for supabase-js: records every call and answers from `respond`.
function fakeClient({ respond, session = null, signIn = { data: { user: USER }, error: null } } = {}) {
  const calls = [];
  const builder = (table) => {
    const q = { table, op: 'select', filters: [], payload: null, single: false, order: null, columns: '*' };
    const b = {
      select(columns = '*') { if (q.op === 'select') q.columns = columns; return b; },
      insert(payload) { q.op = 'insert'; q.payload = payload; return b; },
      update(payload) { q.op = 'update'; q.payload = payload; return b; },
      delete() { q.op = 'delete'; return b; },
      eq(column, value) { q.filters.push([column, value]); return b; },
      order(column, opts) { q.order = [column, opts]; return b; },
      single() { q.single = true; return b; },
      then(resolve, reject) { calls.push({ kind: 'db', ...q }); return Promise.resolve(respond({ kind: 'db', ...q })).then(resolve, reject); },
    };
    return b;
  };
  const storage = { from: bucket => ({
    upload: (path, body, opts) => { calls.push({ kind: 'storage', bucket, op: 'upload', path, size: body.size, opts }); return Promise.resolve(respond({ kind: 'storage', bucket, op: 'upload', path, opts })); },
    remove: paths => { calls.push({ kind: 'storage', bucket, op: 'remove', paths }); return Promise.resolve(respond({ kind: 'storage', bucket, op: 'remove', paths })); },
    download: path => { calls.push({ kind: 'storage', bucket, op: 'download', path }); return Promise.resolve(respond({ kind: 'storage', bucket, op: 'download', path })); },
    createSignedUrls: (paths, ttl) => { calls.push({ kind: 'storage', bucket, op: 'sign', paths, ttl }); return Promise.resolve(respond({ kind: 'storage', bucket, op: 'sign', paths })); },
  }) };
  const client = {
    from: builder,
    rpc: (fn, args) => ({ then(resolve, reject) { calls.push({ kind: 'rpc', fn, args }); return Promise.resolve(respond({ kind: 'rpc', fn, args })).then(resolve, reject); } }),
    storage,
    auth: {
      getSession: async () => { calls.push({ kind: 'auth', op: 'getSession' }); return { data: { session }, error: null }; },
      signInAnonymously: async () => { calls.push({ kind: 'auth', op: 'signInAnonymously' }); return signIn; },
    },
  };
  return { client, calls };
}
const ok = data => ({ data, error: null });
const fail = message => ({ data: null, error: { message } });
async function ready(opts) { const fake = fakeClient(opts); const api = new SupabaseStudioAPI({ client: fake.client }); assert.equal(await api.probe(), true); return { api, ...fake }; }

test('helpers classify files and compute hashes', async () => {
  const main = new File(['x'], 'arc.gltf'), bin = new File(['y'], 'arc.bin'), tex = new File(['z'], 'albedo.png'), mtl = new File(['m'], 'arc.mtl');
  assert.equal(roleFor(main, main), 'main'); assert.equal(roleFor(bin, main), 'bin'); assert.equal(roleFor(tex, main), 'texture'); assert.equal(roleFor(mtl, main), 'mtl');
  assert.equal(mimeFor(main), 'model/gltf+json'); assert.equal(mimeFor(new File([''], 'thing.glb')), 'model/gltf-binary'); assert.equal(mimeFor(new File([''], 'x.unknown')), 'application/octet-stream');
  assert.equal(relativeDirOf(new File([''], 'textures/albedo.png')), 'textures');
  assert.equal(relativeDirOf(new File([''], 'arc.gltf')), '');
  assert.equal(await sha256Hex(new Blob(['abc'])), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('probe signs in anonymously when there is no session and reports failures', async () => {
  const { api, calls } = await ready({ respond: () => ok([]) });
  assert.deepEqual(calls.map(c => c.op), ['getSession', 'signInAnonymously']);
  assert.equal(api.uid(), USER.id);
  const broken = fakeClient({ respond: () => ok([]), signIn: { data: null, error: { message: 'Anonymous sign-ins are disabled' } } });
  const api2 = new SupabaseStudioAPI({ client: broken.client });
  assert.equal(await api2.probe(), false);
  assert.match(api2.storageError, /Anonymous sign-ins/);
});

test('projects are read from project_overview and mapped to camelCase', async () => {
  const { api, calls } = await ready({ respond: q => q.table === 'project_overview'
    ? ok([{ id: 'p1', name: 'Arc', render_count: '3', model_count: 1, cover_render_id: 'r9', latest_model_id: 'm1', created_at: 'c', updated_at: 'u' }])
    : ok(null) });
  const [project] = await api.listProjects();
  assert.deepEqual(project, { id: 'p1', name: 'Arc', modelName: null, renderCount: 3, modelCount: 1, coverRenderId: 'r9', latestModelId: 'm1', createdAt: 'c', updatedAt: 'u' });
  assert.deepEqual(calls.at(-1).order, ['updated_at', { ascending: false }]);
});

test('updateProject ignores modelName (not stored in Supabase) and only sends a trimmed name', async () => {
  const seen = [];
  const { api } = await ready({ respond: q => { seen.push(q); return q.op === 'update' ? ok(null) : ok({ id: 'p1', name: 'New', render_count: 0 }); } });
  await api.updateProject('p1', { modelName: 'arc.glb' });
  assert.ok(!seen.some(q => q.op === 'update'));
  await api.updateProject('p1', { name: '  New  ', modelName: 'arc.glb' });
  const update = seen.find(q => q.op === 'update');
  assert.deepEqual(update.payload, { name: 'New' });
  assert.deepEqual(update.filters, [['id', 'p1']]);
});

test('uploadRender stores the PNG under <uid>/<project>/<id>.png and rolls back on insert failure', async () => {
  let failInsert = false;
  const { api, calls } = await ready({ respond: q => {
    if (q.kind === 'storage') return ok({ path: q.path });
    if (q.op === 'insert') return failInsert ? fail('boom') : ok({ ...q.payload, size_bytes: 3, created_at: 'now' });
    return ok(null);
  } });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const render = await api.uploadRender('p1', blob, { viewId: 'hero', label: '히어로', preset: 'dark', presetLabel: '차콜', width: 10, height: 10, engine: 'preview', engineLabel: '실시간', quality: 'preview', samples: 0, filename: 'a.png', settings: { exposure: 1 }, modelId: 'm1' });
  const upload = calls.find(c => c.op === 'upload');
  assert.match(upload.path, new RegExp(`^${USER.id}/p1/[0-9a-f-]{36}\\.png$`));
  assert.equal(upload.opts.contentType, 'image/png');
  const insert = calls.find(c => c.op === 'insert');
  assert.equal(insert.payload.project_id, 'p1'); assert.equal(insert.payload.model_id, 'm1'); assert.equal(insert.payload.preset_label, '차콜'); assert.equal(insert.payload.storage_path, upload.path);
  assert.equal(render.projectId, 'p1'); assert.equal(render.bytes, 3); assert.equal(render.storagePath, upload.path);
  failInsert = true;
  await assert.rejects(api.uploadRender('p1', blob, { width: 1, height: 1 }), /boom/);
  const remove = calls.filter(c => c.op === 'remove').at(-1);
  assert.equal(remove.bucket, 'renders'); assert.equal(remove.paths.length, 1);
});

test('listRenders signs image URLs in one batch and exposes them on records', async () => {
  const { api } = await ready({ respond: q => {
    if (q.kind === 'db' && q.table === 'renders') return ok([{ id: 'r1', project_id: 'p1', storage_path: 'u/p1/r1.png', width: 1, height: 1, label: 'A' }, { id: 'r2', project_id: 'p1', storage_path: 'u/p1/r2.png', width: 1, height: 1, label: 'B' }]);
    if (q.op === 'sign') return ok(q.paths.map(path => ({ path, signedUrl: `https://signed/${path}` })));
    return ok(null);
  } });
  const renders = await api.listRenders('p1');
  assert.equal(renders[0].imageUrl, 'https://signed/u/p1/r1.png');
  assert.equal(api.renderImageURL('r2'), 'https://signed/u/p1/r2.png');
});

test('saveModel hashes files, skips duplicates, uploads with folder structure and registers via RPC', async () => {
  const main = new File(['gltf'], 'arc.gltf'), bin = new File(['bin-bytes'], 'arc.bin'), tex = new File(['png'], 'albedo.png');
  Object.defineProperty(tex, 'webkitRelativePath', { value: 'arc/textures/albedo.png' });
  const mainSha = await sha256Hex(main);
  let duplicateRows = [];
  let registered = null;
  const { api, calls } = await ready({ respond: q => {
    if (q.kind === 'db' && q.table === 'models' && q.op === 'select' && q.filters.some(([c]) => c === 'total_bytes')) return ok(duplicateRows);
    if (q.kind === 'rpc' && q.fn === 'register_model') { registered = q.args; return ok(q.args.p_model_id); }
    if (q.kind === 'db' && q.table === 'models' && q.single) return ok({ id: registered.p_model_id, project_id: 'p1', name: 'arc.gltf', format: 'gltf', total_bytes: registered.p_total_bytes, created_at: 'now' });
    if (q.kind === 'storage') return ok({ path: q.path });
    return ok(null);
  } });
  const { model, duplicate } = await api.saveModel({ projectId: 'p1', files: [main, bin, tex], mainFile: main, info: { meshes: 2, triangles: 300, dimensions: [1, 2, 3] } });
  assert.equal(duplicate, false);
  assert.equal(model.name, 'arc.gltf');
  const uploads = calls.filter(c => c.op === 'upload');
  const prefix = `${USER.id}/p1/${registered.p_model_id}/`;
  assert.deepEqual(uploads.map(u => u.path), [`${prefix}arc.gltf`, `${prefix}arc.bin`, `${prefix}arc/textures/albedo.png`]);
  assert.equal(uploads[0].opts.contentType, 'model/gltf+json');
  assert.equal(registered.p_total_bytes, main.size + bin.size + tex.size);
  assert.deepEqual(registered.p_dimensions, [1, 2, 3]);
  assert.equal(registered.p_files.length, 3);
  assert.deepEqual(registered.p_files.map(f => f.role), ['main', 'bin', 'texture']);
  assert.equal(registered.p_files[0].sha256, mainSha);
  assert.equal(registered.p_files[2].relative_path, 'arc/textures');

  // Second save of the same content is detected as a duplicate: no uploads, no RPC.
  duplicateRows = [{ id: 'existing', project_id: 'p1', name: 'arc.gltf', format: 'gltf', total_bytes: registered.p_total_bytes, model_files: [{ role: 'main', sha256: mainSha }] }];
  const before = calls.length;
  const again = await api.saveModel({ projectId: 'p1', files: [main, bin, tex], mainFile: main });
  assert.equal(again.duplicate, true); assert.equal(again.model.id, 'existing');
  assert.ok(!calls.slice(before).some(c => c.op === 'upload' || c.kind === 'rpc'));
});

test('saveModel removes uploaded objects when registration fails', async () => {
  const main = new File(['glb'], 'thing.glb');
  const { api, calls } = await ready({ respond: q => {
    if (q.kind === 'rpc') return fail('storage_path must start with …');
    if (q.kind === 'storage') return ok({ path: q.path });
    return ok([]);
  } });
  await assert.rejects(api.saveModel({ projectId: 'p1', files: [main], mainFile: main }), /storage_path/);
  const remove = calls.find(c => c.op === 'remove');
  assert.equal(remove.bucket, 'models'); assert.equal(remove.paths.length, 1);
});

test('loadModelFiles rebuilds File objects with sub-folder names', async () => {
  const { api } = await ready({ respond: q => {
    if (q.kind === 'rpc' && q.fn === 'model_with_files') return ok([{ model: { id: 'm1', name: 'arc.gltf', format: 'gltf', total_bytes: 9 },
      files: [{ role: 'main', name: 'arc.gltf', relative_path: '', storage_path: 'a', mime_type: 'model/gltf+json' }, { role: 'texture', name: 'albedo.png', relative_path: 'textures', storage_path: 'b', mime_type: 'image/png' }] }]);
    if (q.op === 'download') return ok(new Blob([q.path]));
    return ok(null);
  } });
  const { model, files } = await api.loadModelFiles('m1');
  assert.equal(model.id, 'm1');
  assert.deepEqual(files.map(f => f.name), ['arc.gltf', 'textures/albedo.png']);
  assert.equal(files[1].type, 'image/png');
  assert.equal(await files[0].text(), 'a');
});

test('deleteProject removes storage objects per bucket before deleting the row', async () => {
  const { api, calls } = await ready({ respond: q => {
    if (q.kind === 'rpc') return ok([{ bucket: 'models', path: 'u/p1/m/arc.glb' }, { bucket: 'renders', path: 'u/p1/r1.png' }, { bucket: 'renders', path: 'u/p1/r2.png' }]);
    return ok(null);
  } });
  await api.deleteProject('p1');
  const removes = calls.filter(c => c.op === 'remove');
  assert.deepEqual(removes.map(r => [r.bucket, r.paths.length]), [['models', 1], ['renders', 2]]);
  const del = calls.find(c => c.kind === 'db' && c.op === 'delete');
  assert.equal(del.table, 'projects');
  assert.ok(calls.indexOf(removes[1]) < calls.indexOf(del));
});
