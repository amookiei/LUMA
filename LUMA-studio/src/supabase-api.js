// Supabase adapter. Implements the same interface as StudioAPI (src/api.js) so app.js can
// use either backend, and adds model persistence (3D files in the private `models` bucket).
//
// Configuration is baked in at build time by build.mjs from LUMA_SUPABASE_URL and
// LUMA_SUPABASE_ANON_KEY (see docs/supabase.md). Data access is protected by RLS, so the
// public anon key is safe to ship in the bundle.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_CONFIG = {
  url: (typeof globalThis.LUMA_SUPABASE_URL === 'string' && globalThis.LUMA_SUPABASE_URL) || '',
  anonKey: (typeof globalThis.LUMA_SUPABASE_ANON_KEY === 'string' && globalThis.LUMA_SUPABASE_ANON_KEY) || '',
};

const MIME_BY_EXTENSION = { glb: 'model/gltf-binary', gltf: 'model/gltf+json', obj: 'model/obj', stl: 'model/stl', mtl: 'model/mtl', bin: 'application/octet-stream',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', ktx2: 'image/ktx2', json: 'application/json' };
const extensionOf = name => (name.split('.').pop() || '').toLowerCase();
export const mimeFor = file => MIME_BY_EXTENSION[extensionOf(file.name)] || file.type || 'application/octet-stream';
export const roleFor = (file, mainFile) => {
  if (file === mainFile) return 'main';
  const ext = extensionOf(file.name);
  if (ext === 'bin') return 'bin';
  if (ext === 'mtl') return 'mtl';
  if (['png', 'jpg', 'jpeg', 'webp', 'avif', 'ktx2'].includes(ext)) return 'texture';
  return 'other';
};
// Folder of a picked file relative to the selection root ('' when flat). Normalised like renderer.js.
export const relativeDirOf = file => (file.webkitRelativePath || file.name).replace(/\\/g, '/').split('/').slice(0, -1).filter(s => s && s !== '.').join('/');

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };

export class SupabaseStudioAPI {
  static isConfigured() { return !!(SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey); }

  constructor({ client, url = SUPABASE_CONFIG.url, anonKey = SUPABASE_CONFIG.anonKey, signedUrlTTL = 6 * 3600 } = {}) {
    this.client = client || createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    this.kind = 'supabase';
    this.supportsModels = true;
    this.available = false;
    this.storageError = null;
    this.user = null;
    this.signedUrlTTL = signedUrlTTL;
    this.renderPaths = new Map();   // render id → storage path
    this.signedUrls = new Map();    // render id → signed URL
  }

  // ---- session ---------------------------------------------------------------
  async probe() {
    this.storageError = null;
    try { await this.ensureSession(); this.available = true; }
    catch (error) { this.available = false; this.storageError = error.message || String(error); }
    return this.available;
  }

  async ensureSession() {
    const { data: { session } = {}, error } = await this.client.auth.getSession();
    if (error) throw error;
    if (session?.user) { this.user = session.user; return this.user; }
    const { data, error: signInError } = await this.client.auth.signInAnonymously();
    if (signInError) throw new Error(`Supabase 로그인 실패: ${signInError.message} (Authentication → Providers 에서 Anonymous sign-ins 를 켜 주세요)`);
    this.user = data.user;
    return this.user;
  }

  uid() {
    if (!this.user) throw new Error('Supabase 세션이 없습니다. 페이지를 새로고침해 주세요.');
    return this.user.id;
  }

  async run(query, context = '요청') {
    const { data, error } = await query;
    if (error) throw new Error(`${context} 실패: ${error.message || error}`);
    return data;
  }

  // ---- row mapping -----------------------------------------------------------
  projectRow(row) {
    return row && { id: row.id, name: row.name, modelName: null, renderCount: Number(row.render_count ?? 0), modelCount: Number(row.model_count ?? 0),
      coverRenderId: row.cover_render_id ?? null, latestModelId: row.latest_model_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  renderRow(row) {
    if (!row) return null;
    this.renderPaths.set(row.id, row.storage_path);
    return { id: row.id, projectId: row.project_id, modelId: row.model_id, viewId: row.view_id, label: row.label, preset: row.preset, presetLabel: row.preset_label, width: row.width, height: row.height,
      engine: row.engine, engineLabel: row.engine_label, quality: row.quality, samples: row.samples, filename: row.filename, storagePath: row.storage_path, bytes: row.size_bytes,
      settings: row.settings, createdAt: row.created_at, imageUrl: this.signedUrls.get(row.id) || null };
  }
  lookRow(row) { return row && { id: row.id, name: row.name, basePreset: row.base_preset, settings: row.settings || {}, createdAt: row.created_at }; }
  viewRow(row) { return row && { id: row.id, projectId: row.project_id, name: row.name, camera: row.camera || {}, createdAt: row.created_at }; }
  modelRow(row) {
    return row && { id: row.id, projectId: row.project_id, name: row.name, format: row.format, totalBytes: row.total_bytes, meshCount: row.mesh_count, triangleCount: row.triangle_count,
      dimensions: row.dimensions, hasInstancing: row.has_instancing, thumbnailPath: row.thumbnail_path, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  // ---- projects --------------------------------------------------------------
  async listProjects() {
    const rows = await this.run(this.client.from('project_overview').select('*').order('updated_at', { ascending: false }), '프로젝트 목록 조회');
    return rows.map(row => this.projectRow(row));
  }
  async createProject({ name } = {}) {
    const row = await this.run(this.client.from('projects').insert({ name: (name || '').trim() || 'Untitled studio' }).select().single(), '프로젝트 생성');
    return this.projectRow(row);
  }
  async updateProject(id, patch = {}) {
    const safe = {};
    if (typeof patch.name === 'string' && patch.name.trim()) safe.name = patch.name.trim().slice(0, 120);
    if (!Object.keys(safe).length) return this.getProject(id);   // modelName is not stored per project in Supabase
    await this.run(this.client.from('projects').update(safe).eq('id', id), '프로젝트 수정');
    return this.getProject(id);
  }
  async getProject(id) {
    return this.projectRow(await this.run(this.client.from('project_overview').select('*').eq('id', id).single(), '프로젝트 조회'));
  }
  async deleteProject(id) {
    const paths = await this.run(this.client.rpc('project_storage_paths', { p_project_id: id }), '프로젝트 파일 목록 조회');
    await this.removeObjects(paths || []);
    await this.run(this.client.from('projects').delete().eq('id', id), '프로젝트 삭제');
    return { ok: true };
  }
  async removeObjects(entries) {
    const byBucket = new Map();
    for (const { bucket, path } of entries) { if (!byBucket.has(bucket)) byBucket.set(bucket, []); byBucket.get(bucket).push(path); }
    for (const [bucket, paths] of byBucket) {
      for (const part of chunk(paths, 100)) await this.run(this.client.storage.from(bucket).remove(part), `${bucket} 파일 삭제`);
    }
  }

  // ---- renders ---------------------------------------------------------------
  async signRenders(rows) {
    const paths = rows.map(row => row.storage_path);
    if (!paths.length) return;
    for (const part of chunk(paths, 100)) {
      const signed = await this.run(this.client.storage.from('renders').createSignedUrls(part, this.signedUrlTTL), '이미지 주소 발급');
      for (const [index, entry] of signed.entries()) {
        const row = rows.find(r => r.storage_path === (entry.path || part[index]));
        if (row && entry.signedUrl) this.signedUrls.set(row.id, entry.signedUrl);
      }
    }
  }
  async listRenders(projectId) {
    const rows = await this.run(this.client.from('renders').select('*').eq('project_id', projectId).order('created_at', { ascending: false }), '렌더 목록 조회');
    await this.signRenders(rows);
    return rows.map(row => this.renderRow(row));
  }
  async uploadRender(projectId, blob, meta = {}) {
    const id = crypto.randomUUID();
    const storagePath = `${this.uid()}/${projectId}/${id}.png`;
    await this.run(this.client.storage.from('renders').upload(storagePath, blob, { contentType: 'image/png', upsert: false }), '렌더 이미지 업로드');
    try {
      const row = await this.run(this.client.from('renders').insert({
        id, project_id: projectId, model_id: meta.modelId || null,
        view_id: meta.viewId || 'custom', label: meta.label || '렌더링', preset: meta.preset || 'custom', preset_label: meta.presetLabel || '',
        width: meta.width, height: meta.height, engine: meta.engine || 'preview', engine_label: meta.engineLabel || '', quality: meta.quality || null,
        samples: Math.round(meta.samples || 0), filename: meta.filename || `${id}.png`, storage_path: storagePath, size_bytes: blob.size, settings: meta.settings || null,
      }).select().single(), '렌더 정보 저장');
      return this.renderRow(row);
    } catch (error) {
      await this.client.storage.from('renders').remove([storagePath]).catch(() => {});
      throw error;
    }
  }
  renderImageURL(id) { return this.signedUrls.get(id) || ''; }
  async renderPath(id) {
    if (this.renderPaths.has(id)) return this.renderPaths.get(id);
    const row = await this.run(this.client.from('renders').select('storage_path').eq('id', id).single(), '렌더 조회');
    this.renderPaths.set(id, row.storage_path);
    return row.storage_path;
  }
  async fetchRenderBlob(id) {
    return this.run(this.client.storage.from('renders').download(await this.renderPath(id)), '이미지 다운로드');
  }
  async deleteRender(id) {
    const path = await this.renderPath(id);
    await this.run(this.client.storage.from('renders').remove([path]), '이미지 삭제');
    await this.run(this.client.from('renders').delete().eq('id', id), '렌더 삭제');
    this.renderPaths.delete(id); this.signedUrls.delete(id);
    return { id };
  }
  async clearRenders(projectId) {
    const rows = await this.run(this.client.from('renders').select('id, storage_path').eq('project_id', projectId), '렌더 목록 조회');
    await this.removeObjects(rows.map(row => ({ bucket: 'renders', path: row.storage_path })));
    await this.run(this.client.from('renders').delete().eq('project_id', projectId), '렌더 삭제');
    rows.forEach(row => { this.renderPaths.delete(row.id); this.signedUrls.delete(row.id); });
    return { ok: true, deleted: rows.length };
  }

  // ---- looks & camera cuts ---------------------------------------------------
  async listLooks() { return (await this.run(this.client.from('looks').select('*').order('created_at'), '조명 룩 조회')).map(row => this.lookRow(row)); }
  async createLook({ name, basePreset, settings }) {
    return this.lookRow(await this.run(this.client.from('looks').insert({ name, base_preset: basePreset, settings: settings || {} }).select().single(), '조명 룩 저장'));
  }
  async deleteLook(id) { await this.run(this.client.from('looks').delete().eq('id', id), '조명 룩 삭제'); return { ok: true }; }
  async listViews(projectId) { return (await this.run(this.client.from('camera_views').select('*').eq('project_id', projectId).order('created_at'), '구도 조회')).map(row => this.viewRow(row)); }
  async createView(projectId, { name, camera }) {
    return this.viewRow(await this.run(this.client.from('camera_views').insert({ project_id: projectId, name, camera }).select().single(), '구도 저장'));
  }
  async deleteView(id) { await this.run(this.client.from('camera_views').delete().eq('id', id), '구도 삭제'); return { ok: true }; }

  // ---- 3D models -------------------------------------------------------------
  async listModels(projectId) {
    const rows = await this.run(this.client.from('models').select('*').eq('project_id', projectId).order('created_at', { ascending: false }), '모델 목록 조회');
    return rows.map(row => this.modelRow(row));
  }

  // Finds a model in the project whose main file has the same content (sha256 + size).
  async findDuplicateModel(projectId, mainSha, totalBytes) {
    const rows = await this.run(this.client.from('models').select('*, model_files(role, sha256)').eq('project_id', projectId).eq('total_bytes', totalBytes), '모델 중복 검사');
    const match = rows.find(row => (row.model_files || []).some(file => file.role === 'main' && file.sha256 === mainSha));
    return match ? this.modelRow(match) : null;
  }

  // Uploads every picked file and registers the model. Returns { model, duplicate }.
  async saveModel({ projectId, files, mainFile, info = {}, onProgress = () => {} }) {
    const uid = this.uid();
    const list = Array.from(files);
    if (!list.includes(mainFile)) throw new Error('주 모델 파일이 선택 목록에 없습니다.');
    const totalBytes = list.reduce((sum, file) => sum + file.size, 0);
    onProgress({ stage: 'hash', done: 0, total: list.length });
    const hashes = new Map();
    for (const [index, file] of list.entries()) { hashes.set(file, await sha256Hex(file)); onProgress({ stage: 'hash', done: index + 1, total: list.length }); }

    const duplicate = await this.findDuplicateModel(projectId, hashes.get(mainFile), totalBytes);
    if (duplicate) return { model: duplicate, duplicate: true };

    const modelId = crypto.randomUUID();
    const prefix = `${uid}/${projectId}/${modelId}/`;
    const uploaded = [];
    try {
      for (const [index, file] of list.entries()) {
        const dir = relativeDirOf(file);
        const storagePath = prefix + (dir ? `${dir}/` : '') + file.name;
        onProgress({ stage: 'upload', done: index, total: list.length, file: file.name });
        await this.run(this.client.storage.from('models').upload(storagePath, file, { contentType: mimeFor(file), upsert: false }), `${file.name} 업로드`);
        uploaded.push({ role: roleFor(file, mainFile), name: file.name, relative_path: dir, storage_path: storagePath, mime_type: mimeFor(file), size_bytes: file.size, sha256: hashes.get(file) });
      }
      onProgress({ stage: 'register', done: list.length, total: list.length });
      await this.run(this.client.rpc('register_model', {
        p_project_id: projectId, p_model_id: modelId, p_name: mainFile.name, p_format: extensionOf(mainFile.name), p_total_bytes: totalBytes, p_files: uploaded,
        p_mesh_count: info.meshes ?? null, p_triangle_count: info.triangles ?? null,
        p_dimensions: Array.isArray(info.dimensions) && info.dimensions.length === 3 ? info.dimensions : null, p_has_instancing: !!info.hasInstancing,
      }), '모델 등록');
    } catch (error) {
      if (uploaded.length) await this.client.storage.from('models').remove(uploaded.map(file => file.storage_path)).catch(() => {});
      throw error;
    }
    const model = this.modelRow(await this.run(this.client.from('models').select('*').eq('id', modelId).single(), '모델 조회'));
    return { model, duplicate: false };
  }

  // Downloads a saved model as File objects that renderer.loadFiles() understands.
  // Sub-folder sidecars keep their folder in the file name (webkitRelativePath is read-only).
  async loadModelFiles(modelId, onProgress = () => {}) {
    const rows = await this.run(this.client.rpc('model_with_files', { p_model_id: modelId }), '모델 정보 조회');
    const entry = Array.isArray(rows) ? rows[0] : rows;
    if (!entry?.model) throw new Error('저장된 모델을 찾을 수 없습니다.');
    const files = [];
    for (const [index, file] of entry.files.entries()) {
      onProgress({ done: index, total: entry.files.length, file: file.name });
      const blob = await this.run(this.client.storage.from('models').download(file.storage_path), `${file.name} 다운로드`);
      const name = file.relative_path ? `${file.relative_path}/${file.name}` : file.name;
      files.push(new File([blob], name, { type: file.mime_type || 'application/octet-stream' }));
    }
    onProgress({ done: entry.files.length, total: entry.files.length });
    return { model: this.modelRow(entry.model), files };
  }

  async deleteModel(id) {
    const files = await this.run(this.client.from('model_files').select('storage_path').eq('model_id', id), '모델 파일 조회');
    const model = await this.run(this.client.from('models').select('thumbnail_path').eq('id', id).single(), '모델 조회');
    await this.removeObjects([...files.map(file => ({ bucket: 'models', path: file.storage_path })), ...(model.thumbnail_path ? [{ bucket: 'renders', path: model.thumbnail_path }] : [])]);
    await this.run(this.client.from('models').delete().eq('id', id), '모델 삭제');
    return { ok: true };
  }
}
