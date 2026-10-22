import { StudioRenderer } from './renderer.js';
import { StudioAPI } from './api.js';
import { LIGHTING_PRESETS, PRESET_IDS, DEFAULT_PRESET, presetBackground } from './presets.js';
import { BUILTIN_VIEWS } from './views.js';
import { EFFECTS, EFFECT_DEFAULTS, applyEffects } from './effects.js';
import { zipSync, strToU8 } from 'fflate';

// ---------------------------------------------------------------------------
// Icons & DOM helpers
// ---------------------------------------------------------------------------
const icons = {
 upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
 download:'<path d="M12 3v13m-4-4 4 4 4-4M4 17v4h16v-4"/>',
 folder:'<path d="M3 7V4h6l2 3h10v13H3z"/>',
 box:'<path d="m12 2 9 5v10l-9 5-9-5V7zm0 10 9-5M12 12 3 7m9 5v10M7 4.8l9 5v4"/>',
 headphones:'<path d="M4 13V10a8 8 0 0 1 16 0v3M4 12H2v8h5v-8zm16 0h2v8h-5v-8z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.6 8.7a2.5 2.5 0 0 1 4.8 1c0 1.6-2.4 2-2.4 3.8m0 3h.01"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zM8 12l3 3 5-6"/>',
 reset:'<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
 mouse:'<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 6v4"/>',
 expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
 sliders:'<path d="M4 3v4m0 4v10M12 3v10m0 4v4M20 3v2m0 4v12M1 7h6v4H1zm8 6h6v4H9zm8-8h6v4h-6z"/>',
 image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-7 5 8"/>',
 sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM4 2v4M2 4h4"/>',
 aperture:'<circle cx="12" cy="12" r="9.5"/><path d="m8.5 3.2 5.7 9.8M17.7 4.5H6.4M21.3 13 15.5 3M15.5 21l-5.7-10M6.2 19.5h11.5M2.6 11l5.9 10"/>',
 'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 front:'<rect x="6" y="3" width="12" height="18" rx="3"/>',
 side:'<rect x="9" y="3" width="6" height="18" rx="2"/>',
 top:'<rect x="4" y="8" width="16" height="8" rx="3"/>',
 detail:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6m-11-14v6m-3-3h6"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 trash:'<path d="M4 7h16M9 7V4h6v3m-7 0 1 13h8l1-13"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
 orbit:'<circle cx="12" cy="12" r="3"/><path d="M3.5 12c0-2 3.8-4 8.5-4s8.5 2 8.5 4-3.8 4-8.5 4-8.5-2-8.5-4z" transform="rotate(-25 12 12)"/>',
 camera:'<path d="M4 8h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="3.5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.box}</svg>`;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
$$('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const defaults = { exposure: 1, lightStrength: 1, lightAngle: 0, roughness: .5, metalness: 0, materialMode: 'original', color: '#55565a', focalLength: 70, background: presetBackground(DEFAULT_PRESET), transparent: false, dof: false, fStop: 2.8 };
const LOOK_KEYS = ['exposure', 'lightStrength', 'lightAngle', 'roughness', 'metalness', 'materialMode', 'color', 'focalLength', 'background', 'transparent', 'dof', 'fStop'];
const state = {
  ready: false, busy: false, thumbnailBusy: false,
  preset: DEFAULT_PRESET, aspect: '1:1', view: 'hero',
  selected: new Set(BUILTIN_VIEWS.map(v => v.id)),
  settings: { ...defaults },
  effects: { ...EFFECT_DEFAULTS, watermarkText: 'LUMA STUDIO' },
  results: [],
  modelName: 'FORM / H-01',
  online: false, project: null, projects: [], looks: [], savedViews: [],
};
const api = new StudioAPI();
const thumbURLs = new Map();
let abortController, toastTimeout, thumbnailTimer, thumbAbort, engine;

// ---------------------------------------------------------------------------
// Generic UI helpers
// ---------------------------------------------------------------------------
function toast(message, error = false) {
  const el = $('#toast');
  el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.hidden = true, error ? 8000 : 4500);
}
function showPage(page) {
  if (state.busy) { toast('렌더링이 끝난 뒤 이동할 수 있습니다.'); return; }
  $('#studio-page').hidden = page !== 'studio';
  $('#gallery-page').hidden = page !== 'gallery';
  $$('.main-nav [data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'studio') requestAnimationFrame(() => { sizeViewport(); engine?.resize(); });
}
$$('[data-page]').forEach(el => el.addEventListener('click', () => showPage(el.dataset.page)));
function status({ type, message }) {
  $('#engine-status').textContent = message;
  if (type === 'error' || type === 'warning') toast(message, true);
}
function luminance(hex) { return [.2126, .7152, .0722].reduce((s, x, i) => s + x * parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255, 0); }
function safeName(value) { return value.replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 70) || 'product'; }
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const interactionLocked = () => !state.ready || state.busy || state.thumbnailBusy;

// A small prompt dialog used for naming projects, looks and cuts.
function askName({ eyebrow, title, value = '', submit = '저장' }) {
  return new Promise(resolve => {
    const dialog = $('#name-dialog'), input = $('#name-input');
    $('#name-eyebrow').textContent = eyebrow; $('#name-title').textContent = title; $('#name-submit').textContent = submit;
    input.value = value;
    const finish = result => { dialog.removeEventListener('close', onClose); resolve(result); };
    const onClose = () => finish(dialog.returnValue === 'ok' ? input.value.trim() : null);
    dialog.addEventListener('close', onClose);
    $('#name-form').onsubmit = event => { event.preventDefault(); if (input.value.trim()) dialog.close('ok'); };
    $('#name-cancel').onclick = () => dialog.close('cancel');
    dialog.returnValue = '';
    dialog.showModal();
    input.select();
  });
}

// ---------------------------------------------------------------------------
// Model info
// ---------------------------------------------------------------------------
function updateModel(info) {
  state.modelName = info.name;
  $('#model-name').textContent = info.name;
  $('#model-meta').textContent = `${info.isDemo ? '샘플 모델' : info.format.toUpperCase()} · ${info.meshes.toLocaleString()} meshes`;
  $('#model-stats').textContent = `${(info.triangles / 1000).toFixed(1)}K triangles`;
  $('#sample-badge').hidden = !info.isDemo;
  $('#stage-model').textContent = info.isDemo ? 'FORM / H–01' : info.format.toUpperCase() + ' / 01';
  if (!info.isDemo) rememberModel(info.name);
  updateProjectBar();
}
async function rememberModel(name) {
  const project = state.project;
  if (!project) return;
  const patch = { modelName: name };
  if (project.name === 'Untitled studio') patch.name = name.replace(/\.[^.]+$/, '');
  Object.assign(project, patch);
  if (state.online) { try { Object.assign(project, await api.updateProject(project.id, patch)); } catch (e) { console.warn('Project update failed:', e.message); } }
  updateProjectBar();
}
try { engine = new StudioRenderer($('#viewport'), { onStatus: status, onChange: updateModel }); } catch (e) { status({ type: 'error', message: e.message }); }

// ---------------------------------------------------------------------------
// Controls (lighting / material / effects)
// ---------------------------------------------------------------------------
function formatValue(key, value) {
  if (key === 'lightStrength') return `${Math.round(value * 100)}%`;
  if (key === 'lightAngle') return `${value}°`;
  if (key === 'focalLength') return `${value} mm`;
  if (key === 'fStop') return `f/${value.toFixed(1)}`;
  if (key === 'vignette' || key === 'grain') return `${Math.round(value * 100)}%`;
  return value.toFixed(2);
}
function updateRange(input) {
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  input.style.setProperty('--fill', `${(value - min) / (max - min) * 100}%`);
  const output = $(`#${input.id}-value`);
  if (output) output.value = formatValue(input.id, value);
}
function syncControls() {
  for (const [key, value] of Object.entries({ ...state.settings, ...state.effects })) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
    if (el.type === 'range') updateRange(el);
  }
  $('#background-hex').textContent = state.settings.background.toUpperCase();
  $('#stage-shell').classList.toggle('transparent', state.settings.transparent);
  $('#custom-material').classList.toggle('disabled', state.settings.materialMode === 'original');
  $$('#custom-material input').forEach(el => el.disabled = state.settings.materialMode === 'original');
  $('.dof-group').classList.toggle('disabled', !state.settings.dof);
  $('#fStop').disabled = !state.settings.dof;
  $('#watermarkText')?.toggleAttribute('disabled', !state.effects.watermark);
}
function changeSettings(partial) {
  Object.assign(state.settings, partial);
  if (state.ready && !state.busy) engine.setSettings(partial);
  syncControls();
}
function changeEffects(partial) { Object.assign(state.effects, partial); syncControls(); }

// Effects tab is generated from the registry so a new effect needs no markup.
function buildEffectControls() {
  const container = $('#effects-controls');
  container.innerHTML = EFFECTS.map(effect => effect.kind === 'toggle'
    ? `<div class="control-group"><label class="toggle-row" for="${effect.id}"><span>${effect.label}</span><input id="${effect.id}" type="checkbox"><span class="switch"></span></label>${effect.id === 'watermark' ? '<input id="watermarkText" class="text-input" type="text" maxlength="40" placeholder="LUMA STUDIO" aria-label="워터마크 문구">' : ''}<p class="control-hint compact">${effect.hint}</p></div>`
    : `<div class="control-group"><div class="control-label"><label for="${effect.id}">${effect.label}</label><output for="${effect.id}" id="${effect.id}-value"></output></div><input id="${effect.id}" type="range" min="${effect.min}" max="${effect.max}" step="${effect.step}" value="${effect.default}"><p class="control-hint compact">${effect.hint}</p></div>`
  ).join('') + '<p class="control-hint">효과는 두 렌더 엔진 모두의 완성 이미지에 적용되며, 컷 미리보기에도 반영됩니다.</p>';
  for (const effect of EFFECTS) {
    const el = $(`#${effect.id}`);
    if (effect.kind === 'toggle') el.addEventListener('change', () => { if (state.busy) return; changeEffects({ [effect.id]: el.checked }); queueThumbnails(); });
    else {
      updateRange(el);
      el.addEventListener('input', () => { if (state.busy || state.thumbnailBusy) return; changeEffects({ [effect.id]: Number(el.value) }); });
      el.addEventListener('change', () => queueThumbnails());
    }
  }
  $('#watermarkText').value = state.effects.watermarkText;
  $('#watermarkText').addEventListener('change', () => { changeEffects({ watermarkText: $('#watermarkText').value.trim() || 'LUMA STUDIO' }); queueThumbnails(); });
}

$$('#lighting-controls input[type=range], #material-controls input[type=range]').forEach(el => {
  updateRange(el);
  el.addEventListener('input', () => { if (state.busy || state.thumbnailBusy) return; changeSettings({ [el.id]: Number(el.value) }); });
  el.addEventListener('change', () => queueThumbnails());
});
['color', 'background', 'materialMode', 'transparent', 'dof'].forEach(id => $('#' + id).addEventListener('input', event => {
  if (state.busy || state.thumbnailBusy) return;
  const el = event.target;
  changeSettings({ [id]: el.type === 'checkbox' ? el.checked : el.value });
  if (id === 'background') $('#stage-shell').classList.toggle('light', luminance(el.value) > .5);
  queueThumbnails();
}));
$('#materialMode').addEventListener('change', () => {
  $('#material-hint').textContent = $('#materialMode').value === 'original' ? 'GLB / GLTF에 포함된 색상과 텍스처를 그대로 사용합니다.' : '모델 전체에 아래 색상·거칠기·금속성을 적용합니다. 원래 재질로 언제든 돌아갈 수 있습니다.';
});
$$('[data-control-tab]').forEach(el => el.addEventListener('click', () => {
  $$('[data-control-tab]').forEach(b => { const active = b === el; b.classList.toggle('active', active); b.setAttribute('aria-selected', active); });
  for (const tab of ['lighting', 'material', 'effects']) $(`#${tab}-controls`).hidden = el.dataset.controlTab !== tab;
}));
$('#reset-settings').addEventListener('click', () => {
  if (interactionLocked()) return;
  state.settings = { ...defaults, background: presetBackground(state.preset) };
  state.effects = { ...EFFECT_DEFAULTS, watermarkText: state.effects.watermarkText };
  engine.setSettings(state.settings); syncControls();
  $('#stage-shell').classList.toggle('light', luminance(state.settings.background) > .5);
  queueThumbnails();
  toast('조명·재질·효과 설정을 초기화했습니다.');
});

// ---------------------------------------------------------------------------
// Lighting presets & saved looks
// ---------------------------------------------------------------------------
function buildPresets() {
  $('#preset-grid').innerHTML = PRESET_IDS.map((id, index) => {
    const preset = LIGHTING_PRESETS[id], card = preset.card || {};
    const visual = card.image ? `<img src="${card.image}" alt="${card.alt || preset.ko}" style="object-position:${card.position || 'center'}">` : `<span class="preset-swatch" style="background:${card.gradient}"></span>`;
    return `<button class="preset preset-${id} ${card.dark ? 'preset-bright' : ''}" data-preset="${id}" aria-pressed="false">${visual}<span class="preset-shade"></span><span class="preset-number">${String(index + 1).padStart(2, '0')} / ${id.toUpperCase()}</span><span class="preset-check" data-icon="check">${icon('check')}</span><span class="preset-copy"><strong>${preset.ko}</strong><small>${preset.tagline}</small></span><span class="reference-label">${card.image ? 'REFERENCE' : 'STUDIO'}</span></button>`;
  }).join('');
  $('#preset-count').textContent = `${PRESET_IDS.length} LOOKS`;
  $$('[data-preset]').forEach(el => el.addEventListener('click', () => setPreset(el.dataset.preset)));
}
function setPreset(preset, { keepSettings = false } = {}) {
  if (interactionLocked() || !LIGHTING_PRESETS[preset]) return;
  state.preset = preset;
  if (!keepSettings) state.settings.background = presetBackground(preset);
  engine.setPreset(preset);
  if (keepSettings) engine.setSettings(state.settings);
  $$('[data-preset]').forEach(el => { const selected = el.dataset.preset === preset; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', selected); });
  $('#stage-preset').textContent = LIGHTING_PRESETS[preset].en;
  $('#stage-shell').classList.toggle('light', luminance(state.settings.background) > .5);
  syncControls();
  queueThumbnails(100);
}
function renderLooks() {
  const list = $('#look-list');
  if (!state.looks.length) { list.innerHTML = '<span class="look-empty">조명·재질 설정을 이름 붙여 저장하면 여기서 다시 불러올 수 있습니다.</span>'; return; }
  list.replaceChildren(...state.looks.map(look => {
    const chip = document.createElement('div'); chip.className = 'look-chip';
    const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'look-apply';
    apply.innerHTML = `<i style="background:${look.settings.background || presetBackground(look.basePreset)}"></i><span>${look.name}</span><small>${LIGHTING_PRESETS[look.basePreset]?.en || look.basePreset}</small>`;
    apply.title = `${look.name} 룩 적용`;
    apply.addEventListener('click', () => applyLook(look));
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'look-remove'; remove.setAttribute('aria-label', `${look.name} 삭제`); remove.innerHTML = icon('close');
    remove.addEventListener('click', () => deleteLook(look));
    chip.append(apply, remove);
    return chip;
  }));
}
function applyLook(look) {
  if (interactionLocked()) return;
  const settings = {};
  for (const key of LOOK_KEYS) if (key in look.settings) settings[key] = look.settings[key];
  Object.assign(state.settings, settings);
  if (look.settings.effects) Object.assign(state.effects, look.settings.effects);
  setPreset(LIGHTING_PRESETS[look.basePreset] ? look.basePreset : DEFAULT_PRESET, { keepSettings: true });
  toast(`‘${look.name}’ 룩을 적용했습니다.`);
}
async function saveLook() {
  if (interactionLocked()) return;
  const name = await askName({ eyebrow: 'LIGHTING LOOK', title: '현재 조명 룩 이름', value: `${LIGHTING_PRESETS[state.preset].ko} ${state.looks.length + 1}` });
  if (!name) return;
  const settings = Object.fromEntries(LOOK_KEYS.map(key => [key, state.settings[key]]));
  settings.effects = { ...state.effects };
  try {
    const look = state.online ? await api.createLook({ name, basePreset: state.preset, settings }) : { id: crypto.randomUUID(), name, basePreset: state.preset, settings };
    state.looks.push(look); renderLooks();
    toast(state.online ? `‘${name}’ 룩을 작업 공간에 저장했습니다.` : `‘${name}’ 룩을 이 탭에 저장했습니다. 서버로 실행하면 영구 보관됩니다.`);
  } catch (e) { toast(`룩을 저장하지 못했습니다. ${e.message}`, true); }
}
async function deleteLook(look) {
  try {
    if (state.online) await api.deleteLook(look.id);
    state.looks = state.looks.filter(item => item.id !== look.id); renderLooks();
  } catch (e) { toast(`룩을 삭제하지 못했습니다. ${e.message}`, true); }
}
$('#save-look').addEventListener('click', saveLook);

// ---------------------------------------------------------------------------
// Views (built-in cuts + saved camera cuts)
// ---------------------------------------------------------------------------
const savedViewId = view => `saved:${view.id}`;
function allViews() {
  return [...BUILTIN_VIEWS, ...state.savedViews.map(view => ({ id: savedViewId(view), label: view.name, en: view.name, icon: 'camera', camera: view.camera, saved: view }))];
}
// Final renders of the hero cut use the camera as the user left it; thumbnails and the
// other built-in cuts use their canonical framing. Saved cuts always restore their pose.
function captureTarget(view, { thumbnail = false } = {}) {
  if (view.camera) return { camera: view.camera };
  return { view: view.id === 'hero' && !thumbnail ? undefined : view.id };
}
function setView(viewId) {
  if (interactionLocked()) return;
  const view = allViews().find(v => v.id === viewId);
  if (!view) return;
  if (view.camera) engine.applyCameraState(view.camera); else engine.setView(view.id);
  state.view = viewId;
  $('#view-name').textContent = view.en;
  $$('.shot').forEach(el => el.classList.toggle('current', el.dataset.view === viewId));
}
$('#reset-view').addEventListener('click', () => setView('hero'));
$$('[data-rotate]').forEach(el => el.addEventListener('click', () => {
  if (interactionLocked()) return;
  engine.rotateModel(el.dataset.rotate); state.view = 'hero'; $('#view-name').textContent = 'Hero angle'; queueThumbnails();
}));
$('#fullscreen').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('#stage-shell').requestFullscreen(); } catch { toast('이 브라우저에서는 전체 화면을 사용할 수 없습니다.'); }
});
function buildShots() {
  const views = allViews();
  $('#shot-grid').innerHTML = views.map((v, i) => `<article class="shot ${state.selected.has(v.id) ? 'checked' : ''} ${v.id === state.view ? 'current' : ''} ${v.saved ? 'saved' : ''}" data-view="${v.id}"><button class="shot-preview" aria-label="${v.label} 미리보기"><span class="shot-placeholder">${icon(v.icon)}</span></button><label class="shot-select"><input type="checkbox" ${state.selected.has(v.id) ? 'checked' : ''} aria-label="${v.label} 렌더링 선택"><span>${icon('check')}</span></label>${v.saved ? `<button class="shot-remove" aria-label="${v.label} 컷 삭제">${icon('close')}</button>` : ''}<div class="shot-label"><strong>${v.label}</strong><span>${String(i + 1).padStart(2, '0')}</span></div></article>`).join('');
  $$('.shot').forEach(el => {
    const id = el.dataset.view;
    el.querySelector('.shot-preview').addEventListener('click', () => setView(id));
    if (thumbURLs.has(id)) el.querySelector('.shot-preview').replaceChildren(Object.assign(document.createElement('img'), { src: thumbURLs.get(id), alt: '' }));
    el.querySelector('input').addEventListener('change', e => { if (e.target.checked) state.selected.add(id); else state.selected.delete(id); el.classList.toggle('checked', e.target.checked); updateExport(); });
    el.querySelector('.shot-remove')?.addEventListener('click', () => deleteSavedView(views.find(v => v.id === id).saved));
  });
  updateExport();
}
$('#select-all').addEventListener('click', () => {
  if (state.busy) return;
  const views = allViews();
  state.selected = state.selected.size === views.length ? new Set() : new Set(views.map(v => v.id));
  $$('.shot').forEach(el => { const selected = state.selected.has(el.dataset.view); el.classList.toggle('checked', selected); el.querySelector('input').checked = selected; });
  updateExport();
});
async function saveView() {
  if (interactionLocked()) return;
  const name = await askName({ eyebrow: 'CAMERA CUT', title: '현재 구도 이름', value: `내 구도 ${state.savedViews.length + 1}` });
  if (!name) return;
  const camera = engine.getCameraState();
  try {
    const view = state.online && state.project ? await api.createView(state.project.id, { name, camera }) : { id: crypto.randomUUID(), name, camera };
    state.savedViews.push(view);
    state.selected.add(savedViewId(view));
    state.view = savedViewId(view);
    $('#view-name').textContent = name;
    buildShots(); queueThumbnails(100);
    toast(state.online ? `‘${name}’ 구도를 저장했습니다. 렌더링 컷에 추가되었습니다.` : `‘${name}’ 구도를 이 탭에 추가했습니다.`);
  } catch (e) { toast(`구도를 저장하지 못했습니다. ${e.message}`, true); }
}
async function deleteSavedView(view) {
  if (!view || state.busy) return;
  try {
    if (state.online) await api.deleteView(view.id);
    state.savedViews = state.savedViews.filter(item => item.id !== view.id);
    state.selected.delete(savedViewId(view));
    if (thumbURLs.has(savedViewId(view))) { URL.revokeObjectURL(thumbURLs.get(savedViewId(view))); thumbURLs.delete(savedViewId(view)); }
    if (state.view === savedViewId(view)) { state.view = 'hero'; $('#view-name').textContent = 'Hero angle'; }
    buildShots();
  } catch (e) { toast(`구도를 삭제하지 못했습니다. ${e.message}`, true); }
}
$('#save-view').addEventListener('click', saveView);

// ---------------------------------------------------------------------------
// Export settings, viewport sizing & thumbnails
// ---------------------------------------------------------------------------
function dimensions() {
  const size = Number($('#resolution').value);
  const [w, h] = state.aspect.split(':').map(Number);
  return w >= h ? { width: size, height: Math.round(size * h / w) } : { width: Math.round(size * w / h), height: size };
}
function updateExport() {
  const { width, height } = dimensions();
  $('#export-dimensions').textContent = `${width} × ${height}`;
  $('#selected-count').textContent = `${state.selected.size} CUTS`;
  $('#render-label').textContent = state.thumbnailBusy ? '미리보기 준비 중…' : `${state.selected.size}개 이미지 렌더링`;
  $('#render-button').disabled = interactionLocked() || !state.selected.size;
  $('#turntable-button').disabled = interactionLocked();
  $('#select-all').textContent = state.selected.size === allViews().length ? '전체 해제' : '전체 선택';
}
function sizeViewport() {
  const shell = $('#stage-shell');
  if (!shell.clientWidth || !shell.clientHeight) return;
  const [w, h] = state.aspect.split(':').map(Number), ratio = w / h;
  const width = Math.min(shell.clientWidth, shell.clientHeight * ratio), height = width / ratio;
  Object.assign($('#viewport').style, { width: width + 'px', height: height + 'px', left: '50%', top: '50%', right: 'auto', bottom: 'auto', transform: 'translate(-50%,-50%)' });
}
new ResizeObserver(sizeViewport).observe($('#stage-shell'));
$$('[data-aspect]').forEach(el => el.addEventListener('click', () => {
  if (state.busy || state.thumbnailBusy) return;
  state.aspect = el.dataset.aspect;
  $$('[data-aspect]').forEach(b => { b.classList.toggle('active', b === el); b.setAttribute('aria-pressed', b === el); });
  sizeViewport(); engine?.resize();
  setView(state.view);
  updateExport();
}));
$('#resolution').addEventListener('change', () => { updateExport(); if ($('#resolution').value === '4096' && $('#quality').value !== 'preview') toast('4K 정밀 렌더링은 GPU 메모리와 시간이 더 필요합니다.'); });
$('#quality').addEventListener('change', () => {
  $('#quality-hint').innerHTML = icon('sparkles') + ($('#quality').value === 'preview' ? '실시간 미리보기 엔진으로 빠르게 저장합니다. 피사계 심도는 적용되지 않습니다.' : '빛의 반사와 부드러운 그림자를 정밀하게 계산합니다.');
});
function queueThumbnails(wait = 600) { clearTimeout(thumbnailTimer); thumbnailTimer = setTimeout(() => refreshThumbnails(), wait); }
async function refreshThumbnails() {
  if (interactionLocked()) return;
  state.thumbnailBusy = true; updateExport(); document.body.classList.add('app-busy');
  thumbAbort = new AbortController();
  try {
    for (const v of allViews()) {
      let blob = await engine.capture({ width: 180, height: 180, quality: 'preview', ...captureTarget(v, { thumbnail: true }), signal: thumbAbort.signal });
      blob = await applyEffects(blob, state.effects);
      if (thumbURLs.has(v.id)) URL.revokeObjectURL(thumbURLs.get(v.id));
      const url = URL.createObjectURL(blob);
      thumbURLs.set(v.id, url);
      $(`.shot[data-view="${v.id}"] .shot-preview`)?.replaceChildren(Object.assign(document.createElement('img'), { src: url, alt: `${v.label} 모델 미리보기` }));
    }
  } catch (e) { if (e.name !== 'AbortError') console.warn('Thumbnail generation:', e.message); }
  finally { state.thumbnailBusy = false; document.body.classList.remove('app-busy'); updateExport(); }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------
async function loadFiles(files) {
  if (interactionLocked()) { toast('현재 작업이 끝난 뒤 파일을 불러와 주세요.'); return; }
  if (!files?.length) return;
  clearTimeout(thumbnailTimer);
  state.busy = true; updateExport();
  $('#stage-loading').hidden = false;
  $('#stage-loading strong').textContent = '모델을 스튜디오에 배치하고 있어요';
  $('#stage-loading>span').textContent = '재질과 텍스처를 불러옵니다.';
  try {
    await engine.loadFiles(files);
    state.view = 'hero'; $('#view-name').textContent = 'Hero angle';
    toast('모델을 불러왔습니다. 조명과 각도를 선택해 보세요.');
  } catch (e) { toast(e.message, true); }
  finally { state.busy = false; $('#stage-loading').hidden = true; $('#file-input').value = ''; updateExport(); await refreshThumbnails(); }
}
$('#upload-zone').addEventListener('click', () => { if (!state.busy && !state.thumbnailBusy) $('#file-input').click(); });
$('#file-input').addEventListener('change', e => loadFiles(e.target.files));
$('#demo-button').addEventListener('click', async () => {
  if (interactionLocked()) return;
  engine.loadDemo(); state.view = 'hero'; $('#view-name').textContent = 'Hero angle';
  await refreshThumbnails(); toast('샘플 헤드폰을 불러왔습니다.');
});
let dragCounter = 0;
document.addEventListener('dragenter', e => {
  if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
  e.preventDefault(); dragCounter++;
  $('#drop-overlay').hidden = false; $('#upload-zone').classList.add('dragging');
});
document.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', () => { dragCounter = Math.max(0, dragCounter - 1); if (!dragCounter) { $('#drop-overlay').hidden = true; $('#upload-zone').classList.remove('dragging'); } });
document.addEventListener('drop', e => { e.preventDefault(); dragCounter = 0; $('#drop-overlay').hidden = true; $('#upload-zone').classList.remove('dragging'); loadFiles(e.dataTransfer.files); });

// ---------------------------------------------------------------------------
// Projects & persistence
// ---------------------------------------------------------------------------
function updateProjectBar() {
  const project = state.project;
  $('#project-title').textContent = project ? project.name : (state.modelName === 'FORM / H-01' ? 'Untitled studio' : state.modelName.replace(/\.[^.]+$/, ''));
  $('#project-tools').hidden = !state.online;
  $('#project-title').classList.toggle('static', !state.online);
  $('#project-tag').textContent = project ? String(Math.max(1, state.projects.findIndex(p => p.id === project.id) + 1)).padStart(2, '0') : '01';
  const select = $('#project-select');
  select.replaceChildren(...state.projects.map(p => Object.assign(document.createElement('option'), { value: p.id, textContent: `${p.name} · ${p.renderCount ?? 0}컷`, selected: p.id === project?.id })));
  $('#project-delete').disabled = state.projects.length <= 1;
  const indicator = $('#storage-indicator');
  indicator.dataset.mode = state.online ? 'db' : 'memory';
  indicator.querySelector('em').textContent = state.online ? '작업 공간 DB 연결됨' : '로컬 렌더링 · 탭 메모리';
  indicator.title = state.online ? '렌더 결과, 조명 룩, 저장한 구도가 서버 데이터베이스에 보관됩니다.' : '서버 없이 실행 중입니다. 결과는 이 탭에만 보관됩니다.';
  $('#privacy-storage').textContent = state.online ? '렌더 결과만 작업 공간 DB에 저장됩니다.' : '결과 이미지는 이 탭에만 보관됩니다.';
  $('#gallery-note').textContent = state.online ? `‘${project?.name || ''}’ 프로젝트의 갤러리입니다. 이미지는 스튜디오 서버의 데이터베이스에 보관되며 언제든 다시 내려받을 수 있습니다.` : '이 갤러리는 현재 브라우저 탭에 보관됩니다. 탭을 닫기 전에 이미지를 다운로드하세요.';
  $('#gallery-subtitle').textContent = state.online && project ? `${project.name} · 생성한 이미지를 확인하고 원본 해상도로 다운로드하세요.` : '생성한 이미지를 확인하고 원본 해상도로 다운로드하세요.';
  $('#export-footnote').textContent = state.online ? '완성된 이미지는 프로젝트 갤러리(DB)에 저장됩니다.' : '완성된 이미지는 갤러리에서 저장하세요.';
}
function resultFromRecord(record) {
  return { id: record.id, blob: null, url: api.renderImageURL(record.id), viewId: record.viewId, label: record.label, preset: record.preset, presetLabel: record.presetLabel, width: record.width, height: record.height, engine: record.engine, engineLabel: record.engineLabel, filename: record.filename, createdAt: record.createdAt };
}
async function selectProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) return;
  state.project = project;
  try { localStorage.setItem('luma:project', id); } catch { /* private mode */ }
  state.results.forEach(r => { if (r.blob) URL.revokeObjectURL(r.url); });
  state.results = [];
  state.savedViews = [];
  try {
    const [renders, views] = await Promise.all([api.listRenders(id), api.listViews(id)]);
    state.results = renders.map(resultFromRecord);
    state.savedViews = views;
  } catch (e) { toast(`프로젝트를 불러오지 못했습니다. ${e.message}`, true); }
  state.selected = new Set(allViews().map(v => v.id));
  if (state.view.startsWith('saved:')) { state.view = 'hero'; $('#view-name').textContent = 'Hero angle'; }
  buildShots(); updateGallery(); updateProjectBar();
  if (state.ready) queueThumbnails(100);
}
async function bootPersistence() {
  state.online = await api.probe();
  if (!state.online) { updateProjectBar(); return; }
  try {
    state.projects = await api.listProjects();
    let last = null;
    try { last = localStorage.getItem('luma:project'); } catch { /* ignore */ }
    let project = state.projects.find(p => p.id === last) || state.projects[0];
    if (!project) { project = await api.createProject({ name: 'Untitled studio' }); state.projects = [project]; }
    state.looks = await api.listLooks(); renderLooks();
    await selectProject(project.id);
  } catch (e) {
    state.online = false; updateProjectBar();
    toast(`작업 공간 서버에 연결하지 못했습니다. 결과는 이 탭에만 보관됩니다. ${e.message}`, true);
  }
}
$('#project-select').addEventListener('change', e => { if (state.busy) { e.target.value = state.project.id; toast('렌더링이 끝난 뒤 전환할 수 있습니다.'); return; } selectProject(e.target.value); });
$('#project-new').addEventListener('click', async () => {
  if (state.busy) return;
  const name = await askName({ eyebrow: 'NEW PROJECT', title: '새 프로젝트 이름', value: `Studio ${state.projects.length + 1}`, submit: '만들기' });
  if (!name) return;
  try { const project = await api.createProject({ name }); state.projects.unshift(project); await selectProject(project.id); toast(`‘${name}’ 프로젝트를 만들었습니다.`); }
  catch (e) { toast(`프로젝트를 만들지 못했습니다. ${e.message}`, true); }
});
$('#project-title').addEventListener('click', async () => {
  if (!state.online || !state.project || state.busy) return;
  const name = await askName({ eyebrow: 'RENAME PROJECT', title: '프로젝트 이름 바꾸기', value: state.project.name });
  if (!name || name === state.project.name) return;
  try { Object.assign(state.project, await api.updateProject(state.project.id, { name })); updateProjectBar(); }
  catch (e) { toast(`이름을 바꾸지 못했습니다. ${e.message}`, true); }
});
$('#project-delete').addEventListener('click', async () => {
  if (!state.online || !state.project || state.busy || state.projects.length <= 1) return;
  const project = state.project;
  if (!confirm(`‘${project.name}’ 프로젝트와 렌더링 ${state.results.length}개를 모두 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    await api.deleteProject(project.id);
    state.projects = state.projects.filter(p => p.id !== project.id);
    await selectProject(state.projects[0].id);
    toast(`‘${project.name}’ 프로젝트를 삭제했습니다.`);
  } catch (e) { toast(`프로젝트를 삭제하지 못했습니다. ${e.message}`, true); }
});

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
async function resultBlob(item) {
  if (!item.blob) item.blob = await api.fetchRenderBlob(item.id);
  return item.blob;
}
function updateGallery() {
  $('#gallery-count').textContent = state.results.length;
  $('#gallery-empty').hidden = state.results.length > 0;
  $('#download-all').disabled = !state.results.length;
  $('#clear-gallery').disabled = !state.results.length;
  if (state.project) { state.project.renderCount = state.results.length; const option = $(`#project-select option[value="${state.project.id}"]`); if (option) option.textContent = `${state.project.name} · ${state.results.length}컷`; }
  const grid = $('#gallery-grid');
  grid.replaceChildren();
  for (const item of state.results) {
    const card = document.createElement('article'); card.className = 'gallery-card';
    const picture = document.createElement('button'); picture.className = 'gallery-picture'; picture.setAttribute('aria-label', `${item.label} 크게 보기`);
    picture.appendChild(Object.assign(document.createElement('img'), { src: item.url, alt: `${item.presetLabel} · ${item.label} 렌더링`, loading: 'lazy' }));
    picture.addEventListener('click', () => { $('#expanded-image').src = item.url; $('#expanded-caption').textContent = `${item.label} / ${item.presetLabel} · ${item.width} × ${item.height} · ${item.engineLabel}`; $('#image-dialog').showModal(); });
    const info = document.createElement('div'); info.className = 'gallery-card-info';
    const text = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = item.label;
    const small = document.createElement('small'); small.textContent = `${item.presetLabel} · ${item.width} × ${item.height} · ${item.engineLabel}${item.createdAt ? ' · ' + new Date(item.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : ''}`;
    text.append(strong, small);
    const actions = document.createElement('div'); actions.className = 'gallery-actions';
    const download = document.createElement('button'); download.className = 'icon-button'; download.setAttribute('aria-label', `${item.label} PNG 다운로드`); download.innerHTML = icon('download');
    download.addEventListener('click', async () => { try { downloadBlob(await resultBlob(item), item.filename); } catch (e) { toast(e.message, true); } });
    const remove = document.createElement('button'); remove.className = 'icon-button'; remove.setAttribute('aria-label', `${item.label} 삭제`); remove.innerHTML = icon('trash');
    remove.addEventListener('click', () => deleteResult(item));
    actions.append(download, remove);
    info.append(text, actions);
    card.append(picture, info);
    grid.append(card);
  }
}
async function deleteResult(item) {
  try {
    if (item.id && state.online) await api.deleteRender(item.id);
    if (item.blob) URL.revokeObjectURL(item.url);
    state.results = state.results.filter(r => r !== item);
    updateGallery();
  } catch (e) { toast(`삭제하지 못했습니다. ${e.message}`, true); }
}
$('#clear-gallery').addEventListener('click', async () => {
  if (!state.results.length) return;
  if (state.online && !confirm(`‘${state.project.name}’ 프로젝트의 렌더링 ${state.results.length}개를 모두 삭제할까요?`)) return;
  try {
    if (state.online && state.project) await api.clearRenders(state.project.id);
    state.results.forEach(r => { if (r.blob) URL.revokeObjectURL(r.url); });
    state.results = []; updateGallery();
    toast(state.online ? '프로젝트 갤러리를 비웠습니다.' : '현재 갤러리를 비웠습니다.');
  } catch (e) { toast(`갤러리를 비우지 못했습니다. ${e.message}`, true); }
});
$('#download-all').addEventListener('click', async () => {
  if (!state.results.length) return;
  const button = $('#download-all'); button.disabled = true;
  try {
    const files = {};
    const ordered = [...state.results].reverse();
    for (const [i, result] of ordered.entries()) files[`${String(i + 1).padStart(2, '0')}_${result.filename}`] = new Uint8Array(await (await resultBlob(result)).arrayBuffer());
    files['render-info.json'] = strToU8(JSON.stringify(ordered.map(({ filename, preset, width, height, engine, engineLabel, createdAt }) => ({ filename, preset, width, height, engine, engineLabel, createdAt })), null, 2));
    downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `LUMA-${safeName(state.project?.name || 'render-collection')}.zip`);
    toast('ZIP 파일을 준비했습니다. 다운로드를 확인하세요.');
  } catch (e) { toast('ZIP 생성에 실패했습니다. 이미지를 개별 다운로드해 주세요.', true); }
  finally { button.disabled = false; }
});

// ---------------------------------------------------------------------------
// Rendering (multi-cut batch & turntable sequence)
// ---------------------------------------------------------------------------
function openRenderModal(total, title) {
  state.busy = true;
  abortController = new AbortController();
  $('#render-modal').hidden = false;
  $('#render-title').textContent = title;
  $('#cancel-render').disabled = false; $('#cancel-render').textContent = '렌더링 중단';
  document.body.classList.add('app-busy');
  $('#render-progress').style.width = '0%'; $('#render-percent').textContent = '0%'; $('#render-step').textContent = `1 / ${total}`;
  updateExport();
  $('#cancel-render').focus();
}
function closeRenderModal() {
  state.busy = false;
  $('#render-modal').hidden = true;
  document.body.classList.remove('app-busy');
  updateExport();
}
function progressReporter(index, total) {
  return progress => { const percent = Math.min(100, Math.round((index + progress) / total * 100)); $('#render-progress').style.width = percent + '%'; $('#render-percent').textContent = percent + '%'; };
}
function engineLabelFor(info) {
  if (info.engine === 'pathtracing') return `패스 트레이싱 ${Math.round(info.samples)} spp${info.dof ? ' · DoF' : ''}`;
  return info.engine === 'fallback' ? 'PBR 대체 출력' : '실시간 PBR';
}
function snapshotSettings() { return { ...state.settings, effects: { ...state.effects }, aspect: state.aspect }; }

$('#render-button').addEventListener('click', async () => {
  if (interactionLocked() || !state.selected.size) return;
  clearTimeout(thumbnailTimer);
  const selected = allViews().filter(v => state.selected.has(v.id));
  const { width, height } = dimensions(), quality = $('#quality').value;
  openRenderModal(selected.length, '빛을 차곡차곡 쌓고 있어요.');
  const before = state.results.length;
  const batch = new Date().toISOString().replace(/[:.]/g, '-');
  let cancelled = false, failed = false, unsaved = 0;
  try {
    for (let i = 0; i < selected.length; i++) {
      const view = selected[i];
      $('#render-detail').textContent = `${view.label} · ${LIGHTING_PRESETS[state.preset].ko} · ${width} × ${height}`;
      $('#render-step').textContent = `${i + 1} / ${selected.length}`;
      let blob = await engine.capture({ width, height, quality, ...captureTarget(view), signal: abortController.signal, onProgress: progressReporter(i, selected.length) });
      blob = await applyEffects(blob, state.effects);
      const info = engine.lastCaptureInfo;
      const meta = { viewId: view.id, label: view.label, preset: state.preset, presetLabel: LIGHTING_PRESETS[state.preset].ko, width, height, engine: info.engine, engineLabel: engineLabelFor(info), quality, samples: Math.round(info.samples || 0), modelName: state.modelName,
        filename: `${safeName(state.modelName)}_${state.preset}_${view.saved ? safeName(view.label) : view.id}_${batch}.png`, settings: snapshotSettings() };
      const item = { ...meta, blob, url: URL.createObjectURL(blob), createdAt: new Date().toISOString() };
      if (state.online && state.project) {
        try { const saved = await api.uploadRender(state.project.id, blob, meta); item.id = saved.id; item.createdAt = saved.createdAt; }
        catch (e) { unsaved++; console.warn('Render upload failed:', e.message); }
      }
      state.results.unshift(item);
      updateGallery();
    }
  } catch (e) {
    if (e.name === 'AbortError') { cancelled = true; toast('렌더링을 중단했습니다. 완료된 컷은 갤러리에 보관됩니다.'); }
    else { failed = true; toast(e.message, true); }
  } finally {
    closeRenderModal();
    const completed = state.results.length - before;
    if (completed) {
      showPage('gallery');
      if (unsaved) toast(`${unsaved}개 컷을 서버에 저장하지 못해 이 탭에만 보관됩니다. 다운로드해 두세요.`, true);
      else if (!cancelled && !failed) toast(state.online ? `${completed}개 이미지가 완성되어 프로젝트에 저장되었습니다.` : `${completed}개 이미지가 완성되었습니다. PNG 또는 ZIP으로 저장하세요.`);
    }
    $('#engine-status').textContent = cancelled ? '렌더링 중단 · 완료된 컷은 갤러리에 저장됨' : failed ? '렌더링 실패 · 설정을 확인해 주세요' : '렌더링 완료 · 스튜디오 준비됨';
    $('#render-button').focus();
  }
});

$('#turntable-button').addEventListener('click', async () => {
  if (interactionLocked()) return;
  clearTimeout(thumbnailTimer);
  const frames = Number($('#turntable-frames').value);
  const { width, height } = dimensions(), quality = $('#quality').value;
  const base = engine.getCameraState();
  openRenderModal(frames, '제품을 한 바퀴 돌려 담고 있어요.');
  const files = {};
  let done = 0;
  try {
    for (let i = 0; i < frames; i++) {
      $('#render-detail').textContent = `턴테이블 ${Math.round(i / frames * 360)}° · ${LIGHTING_PRESETS[state.preset].ko} · ${width} × ${height}`;
      $('#render-step').textContent = `${i + 1} / ${frames}`;
      let blob = await engine.capture({ width, height, quality, camera: engine.orbitedCameraState(base, i / frames), signal: abortController.signal, onProgress: progressReporter(i, frames) });
      blob = await applyEffects(blob, state.effects);
      files[`frame_${String(i).padStart(3, '0')}.png`] = new Uint8Array(await blob.arrayBuffer());
      done++;
    }
  } catch (e) {
    if (e.name === 'AbortError') toast(done ? `턴테이블을 중단했습니다. 완료된 ${done}개 프레임을 ZIP으로 저장합니다.` : '턴테이블 렌더링을 중단했습니다.');
    else toast(e.message, true);
  } finally {
    closeRenderModal();
    if (done) {
      const info = engine.lastCaptureInfo;
      files['turntable.json'] = strToU8(JSON.stringify({ model: state.modelName, preset: state.preset, frames: done, requestedFrames: frames, degreesPerFrame: 360 / frames, width, height, quality, engine: info?.engine, effects: state.effects, camera: base }, null, 2));
      downloadBlob(new Blob([zipSync(files, { level: 0 })], { type: 'application/zip' }), `${safeName(state.modelName)}_${state.preset}_turntable_${done}f.zip`);
      $('#engine-status').textContent = `턴테이블 ${done}프레임 완료 · 스튜디오 준비됨`;
    }
    $('#turntable-button').focus();
  }
});
$('#cancel-render').addEventListener('click', () => { abortController?.abort(); $('#cancel-render').disabled = true; $('#cancel-render').textContent = '안전하게 중단하는 중…'; });

// ---------------------------------------------------------------------------
// Dialogs, keyboard & lifecycle
// ---------------------------------------------------------------------------
$('#help-open').addEventListener('click', () => $('#help-dialog').showModal());
$('#help-close').addEventListener('click', () => $('#help-dialog').close());
$('#image-close').addEventListener('click', () => $('#image-dialog').close());
$$('dialog').forEach(dialog => dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const r = dialog.getBoundingClientRect();
  if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
}));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.busy && abortController) abortController.abort();
  if (!state.busy) return;
  if (e.key === 'Tab' && !$('#render-modal').hidden) { e.preventDefault(); $('#cancel-render').focus(); }
});
window.addEventListener('beforeunload', event => {
  // Warn while rendering, or while the gallery holds images that only exist in this tab.
  if (state.busy || state.results.some(r => !r.id)) { event.preventDefault(); event.returnValue = ''; }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
buildPresets(); buildEffectControls(); buildShots(); syncControls(); updateGallery(); updateExport(); sizeViewport(); updateProjectBar();
$$('[data-preset]').forEach(el => { const selected = el.dataset.preset === state.preset; el.classList.toggle('selected', selected); el.setAttribute('aria-pressed', selected); });
const persistence = bootPersistence();
try {
  await engine.init();
  engine.setSettings(state.settings);
  state.ready = true;
  $('#stage-loading').hidden = true;
  updateExport();
  await persistence;
  await refreshThumbnails();
} catch (e) {
  $('#stage-loading .loader').hidden = true;
  $('#stage-loading strong').textContent = '3D 미리보기를 시작할 수 없습니다';
  $('#stage-loading>span').textContent = e.message;
  status({ type: 'error', message: e.message });
}
