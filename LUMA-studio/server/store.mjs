// Data access for projects, renders, saved lighting looks and saved camera cuts.
// Render pixels live as PNG files under the data directory; everything else is in SQLite.
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { badRequest, notFound } from './http.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const now = () => new Date().toISOString();
const text = (value, { field, max = 120, required = false, fallback = null }) => {
  if (value == null || value === '') {
    if (required) throw badRequest(`${field} 값이 필요합니다.`);
    return fallback;
  }
  if (typeof value !== 'string') throw badRequest(`${field} 값은 문자열이어야 합니다.`);
  const trimmed = value.trim();
  if (!trimmed && required) throw badRequest(`${field} 값이 필요합니다.`);
  return trimmed.slice(0, max);
};
const integer = (value, { field, min, max }) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw badRequest(`${field} 값은 ${min}–${max} 사이의 정수여야 합니다.`);
  return number;
};
const json = (value, { field, maxBytes = 16 * 1024 }) => {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${field} 값은 객체여야 합니다.`);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maxBytes) throw badRequest(`${field} 값이 너무 큽니다.`);
  return encoded;
};
const parse = value => { try { return value == null ? null : JSON.parse(value); } catch { return null; } };
const SAFE_FILENAME = /[^\p{L}\p{N}._-]+/gu;

export class Store {
  constructor(db, { dataDir }) {
    this.db = db;
    this.dataDir = dataDir;
    this.renderDir = path.join(dataDir, 'renders');
    this.statements = {
      insertProject: db.prepare('INSERT INTO projects (id, name, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'),
      listProjects: db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM renders r WHERE r.project_id = p.id) AS render_count,
        (SELECT id FROM renders r WHERE r.project_id = p.id ORDER BY created_at DESC LIMIT 1) AS cover_render_id
        FROM projects p ORDER BY updated_at DESC`),
      getProject: db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM renders r WHERE r.project_id = p.id) AS render_count,
        (SELECT id FROM renders r WHERE r.project_id = p.id ORDER BY created_at DESC LIMIT 1) AS cover_render_id
        FROM projects p WHERE p.id = ?`),
      updateProject: db.prepare('UPDATE projects SET name = ?, model_name = ?, updated_at = ? WHERE id = ?'),
      touchProject: db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?'),
      deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
      insertRender: db.prepare(`INSERT INTO renders (id, project_id, view_id, label, preset, preset_label, width, height, engine, engine_label, quality, samples, model_name, filename, file_path, bytes, settings, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      listRenders: db.prepare('SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC, rowid DESC'),
      getRender: db.prepare('SELECT * FROM renders WHERE id = ?'),
      deleteRender: db.prepare('DELETE FROM renders WHERE id = ?'),
      deleteProjectRenders: db.prepare('DELETE FROM renders WHERE project_id = ?'),
      insertLook: db.prepare('INSERT INTO looks (id, name, base_preset, settings, created_at) VALUES (?, ?, ?, ?, ?)'),
      listLooks: db.prepare('SELECT * FROM looks ORDER BY created_at'),
      getLook: db.prepare('SELECT * FROM looks WHERE id = ?'),
      deleteLook: db.prepare('DELETE FROM looks WHERE id = ?'),
      insertView: db.prepare('INSERT INTO camera_views (id, project_id, name, camera, created_at) VALUES (?, ?, ?, ?, ?)'),
      listViews: db.prepare('SELECT * FROM camera_views WHERE project_id = ? ORDER BY created_at'),
      getView: db.prepare('SELECT * FROM camera_views WHERE id = ?'),
      deleteView: db.prepare('DELETE FROM camera_views WHERE id = ?'),
      counts: db.prepare('SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM renders) AS renders, (SELECT COUNT(*) FROM looks) AS looks, (SELECT COUNT(*) FROM camera_views) AS views'),
    };
  }

  // ---- projects -------------------------------------------------------------
  projectRow(row) {
    if (!row) return null;
    return { id: row.id, name: row.name, modelName: row.model_name, renderCount: row.render_count ?? 0, coverRenderId: row.cover_render_id ?? null, createdAt: row.created_at, updatedAt: row.updated_at };
  }

  listProjects() { return this.statements.listProjects.all().map(row => this.projectRow(row)); }

  getProject(id) {
    const project = this.projectRow(this.statements.getProject.get(id));
    if (!project) throw notFound('프로젝트를 찾을 수 없습니다.');
    return project;
  }

  createProject(input = {}) {
    const id = randomUUID(), time = now();
    this.statements.insertProject.run(id, text(input.name, { field: 'name', fallback: 'Untitled studio' }) || 'Untitled studio', text(input.modelName, { field: 'modelName' }), time, time);
    return this.getProject(id);
  }

  updateProject(id, input = {}) {
    const current = this.getProject(id);
    const name = input.name === undefined ? current.name : (text(input.name, { field: 'name', required: true }));
    const modelName = input.modelName === undefined ? current.modelName : text(input.modelName, { field: 'modelName' });
    this.statements.updateProject.run(name, modelName, now(), id);
    return this.getProject(id);
  }

  async deleteProject(id) {
    this.getProject(id);
    this.statements.deleteProject.run(id);
    await rm(path.join(this.renderDir, id), { recursive: true, force: true });
  }

  // ---- renders --------------------------------------------------------------
  renderRow(row) {
    if (!row) return null;
    return { id: row.id, projectId: row.project_id, viewId: row.view_id, label: row.label, preset: row.preset, presetLabel: row.preset_label, width: row.width, height: row.height,
      engine: row.engine, engineLabel: row.engine_label, quality: row.quality, samples: row.samples, modelName: row.model_name, filename: row.filename, bytes: row.bytes, settings: parse(row.settings), createdAt: row.created_at };
  }

  listRenders(projectId) { this.getProject(projectId); return this.statements.listRenders.all(projectId).map(row => this.renderRow(row)); }

  getRender(id) {
    const render = this.renderRow(this.statements.getRender.get(id));
    if (!render) throw notFound('렌더링을 찾을 수 없습니다.');
    return render;
  }

  async createRender(projectId, png, meta = {}) {
    this.getProject(projectId);
    if (!Buffer.isBuffer(png) || png.length < 67 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) throw badRequest('PNG 이미지 본문이 필요합니다.');
    const id = randomUUID();
    const record = {
      id, projectId,
      viewId: text(meta.viewId, { field: 'viewId', max: 60, fallback: 'custom' }),
      label: text(meta.label, { field: 'label', max: 80, fallback: '렌더링' }),
      preset: text(meta.preset, { field: 'preset', max: 60, fallback: 'custom' }),
      presetLabel: text(meta.presetLabel, { field: 'presetLabel', max: 80, fallback: '' }),
      width: integer(meta.width, { field: 'width', min: 1, max: 16384 }),
      height: integer(meta.height, { field: 'height', min: 1, max: 16384 }),
      engine: text(meta.engine, { field: 'engine', max: 40, fallback: 'preview' }),
      engineLabel: text(meta.engineLabel, { field: 'engineLabel', max: 80, fallback: '' }),
      quality: text(meta.quality, { field: 'quality', max: 40 }),
      samples: meta.samples == null ? 0 : integer(meta.samples, { field: 'samples', min: 0, max: 1_000_000 }),
      modelName: text(meta.modelName, { field: 'modelName', max: 200 }),
      filename: (text(meta.filename, { field: 'filename', max: 160, fallback: `${id}.png` }) || `${id}.png`).replace(SAFE_FILENAME, '-'),
      settings: json(meta.settings, { field: 'settings' }),
      createdAt: now(),
    };
    if (!/\.png$/i.test(record.filename)) record.filename += '.png';
    const relative = path.posix.join(projectId, `${id}.png`);
    await mkdir(path.join(this.renderDir, projectId), { recursive: true });
    await writeFile(path.join(this.renderDir, relative), png);
    this.statements.insertRender.run(id, projectId, record.viewId, record.label, record.preset, record.presetLabel, record.width, record.height, record.engine, record.engineLabel, record.quality, record.samples, record.modelName, record.filename, relative, png.length, record.settings, record.createdAt);
    this.statements.touchProject.run(record.createdAt, projectId);
    return this.getRender(id);
  }

  renderFile(id) {
    const row = this.statements.getRender.get(id);
    if (!row) throw notFound('렌더링을 찾을 수 없습니다.');
    const file = path.resolve(this.renderDir, row.file_path);
    if (!file.startsWith(path.resolve(this.renderDir) + path.sep)) throw notFound('렌더링을 찾을 수 없습니다.');
    return { file, render: this.renderRow(row) };
  }

  async readRenderImage(id) {
    const { file, render } = this.renderFile(id);
    try { await stat(file); } catch { throw notFound('이미지 파일이 없습니다. 저장소를 확인해 주세요.'); }
    return { render, data: await readFile(file) };
  }

  async deleteRender(id) {
    const { file, render } = this.renderFile(id);
    this.statements.deleteRender.run(id);
    this.statements.touchProject.run(now(), render.projectId);
    await rm(file, { force: true });
    return render;
  }

  async clearRenders(projectId) {
    this.getProject(projectId);
    const rows = this.statements.listRenders.all(projectId);
    this.statements.deleteProjectRenders.run(projectId);
    this.statements.touchProject.run(now(), projectId);
    await Promise.all(rows.map(row => rm(path.join(this.renderDir, row.file_path), { force: true })));
    return rows.length;
  }

  // ---- saved lighting looks -------------------------------------------------
  lookRow(row) { return row ? { id: row.id, name: row.name, basePreset: row.base_preset, settings: parse(row.settings) || {}, createdAt: row.created_at } : null; }
  listLooks() { return this.statements.listLooks.all().map(row => this.lookRow(row)); }
  createLook(input = {}) {
    const id = randomUUID();
    const settings = json(input.settings, { field: 'settings' });
    if (!settings) throw badRequest('settings 값이 필요합니다.');
    this.statements.insertLook.run(id, text(input.name, { field: 'name', max: 60, required: true }), text(input.basePreset, { field: 'basePreset', max: 60, required: true }), settings, now());
    return this.lookRow(this.statements.getLook.get(id));
  }
  deleteLook(id) {
    if (!this.statements.getLook.get(id)) throw notFound('저장된 조명 룩을 찾을 수 없습니다.');
    this.statements.deleteLook.run(id);
  }

  // ---- saved camera cuts ----------------------------------------------------
  viewRow(row) { return row ? { id: row.id, projectId: row.project_id, name: row.name, camera: parse(row.camera) || {}, createdAt: row.created_at } : null; }
  listViews(projectId) { this.getProject(projectId); return this.statements.listViews.all(projectId).map(row => this.viewRow(row)); }
  createView(projectId, input = {}) {
    this.getProject(projectId);
    const camera = input.camera;
    const vector = (value, field) => {
      if (!Array.isArray(value) || value.length !== 3 || !value.every(n => Number.isFinite(Number(n)))) throw badRequest(`camera.${field} 값은 숫자 3개 배열이어야 합니다.`);
      return value.map(Number);
    };
    if (!camera || typeof camera !== 'object') throw badRequest('camera 값이 필요합니다.');
    const safe = { position: vector(camera.position, 'position'), target: vector(camera.target, 'target'), up: camera.up == null ? [0, 1, 0] : vector(camera.up, 'up'),
      focalLength: Number.isFinite(Number(camera.focalLength)) ? Math.min(400, Math.max(5, Number(camera.focalLength))) : 70 };
    const id = randomUUID();
    this.statements.insertView.run(id, projectId, text(input.name, { field: 'name', max: 60, required: true }), JSON.stringify(safe), now());
    this.statements.touchProject.run(now(), projectId);
    return this.viewRow(this.statements.getView.get(id));
  }
  deleteView(id) {
    const row = this.statements.getView.get(id);
    if (!row) throw notFound('저장된 구도를 찾을 수 없습니다.');
    this.statements.deleteView.run(id);
    return this.viewRow(row);
  }

  counts() { return this.statements.counts.get(); }
}
