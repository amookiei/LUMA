import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { createDemoHeadphones } from './demo.js';
import { LIGHTING_PRESETS, DEFAULT_PRESET } from './presets.js';
import { VIEW_BY_ID } from './views.js';

const PRESETS = LIGHTING_PRESETS;
export const SETTING_RANGES = { exposure: [.1, 4], lightStrength: [.05, 5], lightAngle: [-360, 360], roughness: [.02, 1], metalness: [0, 1], focalLength: [15, 200], fStop: [1, 22] };
const delay = () => new Promise(resolve => setTimeout(resolve, 0));
const clamp = THREE.MathUtils.clamp;
const abort = signal => { if (signal?.aborted) throw new DOMException('렌더링을 취소했습니다.', 'AbortError'); };
const cleanPath = value => {
  let path = value.replace(/\\/g, '/').split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { /* Keep literal invalid percent sequences. */ }
  const segments = [];
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/').toLowerCase();
};
const basename = value => cleanPath(value).split('/').pop();
const directory = value => cleanPath(value).split('/').slice(0, -1).join('/');

function disposeObject(object) {
  if (!object) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  object.traverse(child => {
    if (child.geometry) geometries.add(child.geometry);
    for (const mat of [child.material, child.userData?.studioOriginal].flat().filter(Boolean)) materials.add(mat);
  });
  materials.forEach(mat => {
    Object.values(mat).forEach(value => { if (value?.isTexture) textures.add(value); });
    mat.dispose();
  });
  textures.forEach(texture => texture.dispose());
  geometries.forEach(geometry => geometry.dispose());
}

// An entirely local HDR softbox environment, shared by preview and path tracing.
// Built from the preset's softbox list so new looks need no shader or asset work.
function makeEnvironment(preset) {
  const width = 512, height = 256;
  const data = new Float32Array(width * height * 4);
  const boxes = preset.softboxes;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      const ambient = preset.envAmbient;
      let r = ambient, g = ambient, b = ambient;
      for (const box of boxes) {
        const dx = Math.min(Math.abs(u - box.u), 1 - Math.abs(u - box.u));
        const edgeX = 1 - THREE.MathUtils.smoothstep(dx, box.w * .86, box.w);
        const edgeY = 1 - THREE.MathUtils.smoothstep(Math.abs(v - box.v), box.h * .90, box.h);
        const value = edgeX * edgeY * box.power;
        r += value * box.rgb[0]; g += value * box.rgb[1]; b += value * box.rgb[2];
      }
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class StudioRenderer {
  constructor(container, { onStatus = () => {}, onChange = () => {} } = {}) {
    this.container = container;
    this.onStatus = onStatus;
    this.onChange = onChange;
    this.preset = DEFAULT_PRESET;
    this.view = 'hero';
    this.settings = { exposure: 1, lightStrength: 1, lightAngle: 0, roughness: .5, metalness: .5, materialMode: 'original', color: '#55565a', focalLength: 70, background: PRESETS[DEFAULT_PRESET].background, transparent: false, dof: false, fStop: 2.8 };
    this.info = { name: 'FORM / H-01', format: 'DEMO', meshes: 0, triangles: 0, dimensions: [0, 0, 0], isDemo: true };
    this.environments = new Map();
    this._capturing = false;
    this._loading = false;
    this._disposed = false;
    this._contextLost = false;
  }

  _status(type, message, progress) { this.onStatus({ type, message, ...(progress == null ? {} : { progress }) }); }

  async init() {
    this._status('loading', '3D 스튜디오를 준비하고 있습니다.');
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('이 브라우저에서 WebGL 2를 사용할 수 없습니다. 최신 Chrome 또는 Edge에서 하드웨어 가속을 켜 주세요.');
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('aria-label', '제품 3D 미리보기. 드래그하여 회전, 스크롤하여 확대합니다.');
    this.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this._contextLost = true;
      this._status('error', '그래픽 메모리가 부족하거나 GPU 연결이 끊겼습니다. 출력 크기를 줄이거나 페이지를 새로고침해 주세요.');
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this._contextLost = false; this._disposePathTracer();
      this._status('ready', '그래픽 연결을 복구했습니다.');
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, .02, 200);
    this.camera.setFocalLength(this.settings.focalLength);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .10;
    this.controls.minDistance = .5;
    this.controls.maxDistance = 35;
    this.controls.maxPolarAngle = Math.PI * .95;
    this.controls.addEventListener('change', () => { if (!this._capturing) this.view = 'custom'; });
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x151619, roughness: .92, metalness: .02 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -.012;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
    RectAreaLightUniformsLib.init();
    this.lightRig = new THREE.Group();
    this.scene.add(this.lightRig);
    this.key = new THREE.RectAreaLight(0xffffff, 5, 4, 5);
    this.key.position.set(-3.5, 4.6, 3.5); this.key.lookAt(0, 1.3, 0);
    this.rim = new THREE.RectAreaLight(0xffffff, 16, 2.5, 4.5);
    this.rim.position.set(2, 3.5, -3); this.rim.lookAt(0, 1.3, 0);
    this.fill = new THREE.RectAreaLight(0xffffff, 1.6, 3, 4);
    this.fill.position.set(4, 2, 4); this.fill.lookAt(0, 1.2, 0);
    this.lightRig.add(this.key, this.rim, this.fill);
    this.shadowLight = new THREE.DirectionalLight(0xffffff, .6);
    this.shadowLight.position.set(-3, 6, 3);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(2048, 2048);
    Object.assign(this.shadowLight.shadow.camera, { left: -4, right: 4, top: 5, bottom: -4, near: .1, far: 20 });
    this.shadowLight.shadow.bias = -.00025;
    this.shadowLight.shadow.normalBias = .018;
    this.shadowLight.shadow.radius = 3;
    this.lightRig.add(this.shadowLight, this.shadowLight.target);
    this.ambient = new THREE.HemisphereLight(0xffffff, 0x111217, .12);
    this.scene.add(this.ambient);
    this.setPreset(DEFAULT_PRESET);
    this.resize();
    this.loadDemo();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
    const frame = () => {
      if (this._disposed) return;
      this._frame = requestAnimationFrame(frame);
      if (!this._capturing && !this._contextLost) {
        this.controls.update(); this.renderer.render(this.scene, this.camera);
      }
    };
    frame();
    this._status('ready', '스튜디오 준비 완료');
    return this;
  }

  loadDemo() {
    if (this._capturing || this._loading) return;
    this._setModel(createDemoHeadphones(), { name: 'FORM / H-01', format: 'DEMO', isDemo: true });
    this._status('ready', '데모 헤드폰을 불러왔습니다.');
    return this.info;
  }

  async loadFiles(fileList) {
    if (this._capturing || this._loading) throw new Error('진행 중인 작업이 끝난 뒤 파일을 불러와 주세요.');
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const models = files.filter(file => /\.(glb|gltf|obj|stl)$/i.test(file.name));
    if (models.length !== 1) throw new Error('제품 모델은 한 번에 하나씩 선택해 주세요. GLB, GLTF, OBJ 또는 STL 파일과 관련 텍스처를 함께 넣을 수 있습니다.');
    if (files.reduce((total, file) => total + file.size, 0) > 300 * 1024 * 1024) throw new Error('전체 파일 크기는 300 MB 이하여야 합니다. 모델이나 텍스처 크기를 줄여 주세요.');
    const main = models[0], extension = main.name.split('.').pop().toLowerCase();
    this._loading = true;
    this._status('loading', `${main.name} 불러오는 중…`);
    const objectURLs = new Map();
    let loadedObject;
    let draco;
    try {
      const paths = new Map(), names = new Map();
      files.forEach(file => {
        paths.set(cleanPath(file.webkitRelativePath || file.name), file);
        const key = basename(file.name);
        names.set(key, names.has(key) ? null : file);
      });
      const mainDirectory = directory(main.webkitRelativePath || main.name);
      const findFile = (path, relativeTo = '') => {
        const normalized = cleanPath(relativeTo ? `${relativeTo}/${path}` : path);
        const exact = paths.get(normalized);
        if (exact) return exact;
        const matches = [...paths].filter(([key]) => key.endsWith('/' + normalized));
        if (matches.length === 1) return matches[0][1];
        return names.get(basename(path));
      };
      const getObjectURL = file => {
        if (!objectURLs.has(file)) objectURLs.set(file, URL.createObjectURL(file));
        return objectURLs.get(file);
      };
      let pending = false, waitResolve;
      const resourceErrors = [];
      const manager = new THREE.LoadingManager();
      manager.onStart = () => { pending = true; };
      manager.onLoad = () => { pending = false; waitResolve?.(); };
      manager.onError = url => { resourceErrors.push(basename(url)); };
      manager.setURLModifier(url => {
        if (/^data:/i.test(url)) return url;
        if ([...objectURLs.values()].includes(url)) return url;
        // GLTFLoader creates these URLs for embedded image bufferViews; input
        // JSON URIs are independently checked before parsing below.
        if ((extension === 'glb' || extension === 'gltf') && /^blob:/i.test(url)) return url;
        // Files never cause an external network request. Sidecars must be supplied.
        if (/^(https?:|\/\/|file:|blob:)/i.test(url)) throw new Error(`외부 파일 참조는 지원하지 않습니다: ${basename(url)}. 모델에 포함하거나 로컬 파일로 함께 선택해 주세요.`);
        const file = findFile(url);
        if (!file) throw new Error(`필요한 파일이 없습니다: ${basename(url)}. 모델의 BIN·MTL·텍스처 파일을 함께 선택해 주세요.`);
        return getObjectURL(file);
      });
      if (extension === 'glb' || extension === 'gltf') {
        const data = await main.arrayBuffer();
        let json;
        if (extension === 'gltf') json = JSON.parse(new TextDecoder().decode(data));
        else if (data.byteLength >= 20 && new DataView(data).getUint32(0, true) === 0x46546c67) {
          const size = new DataView(data).getUint32(12, true);
          if (size > data.byteLength - 20) throw new Error('GLB 파일이 손상되었습니다.');
          json = JSON.parse(new TextDecoder().decode(new Uint8Array(data, 20, size)).replace(/\0+$/, ''));
        }
        if (json?.extensionsRequired?.includes('KHR_texture_basisu')) throw new Error('이 파일은 KTX2 압축 텍스처를 사용합니다. PNG/JPG 텍스처를 포함한 GLB로 다시 내보내 주세요.');
        for (const uri of [...(json?.buffers || []), ...(json?.images || [])].map(item => item.uri).filter(Boolean)) {
          if (/^data:/i.test(uri)) continue;
          if (/^(https?:|\/\/|file:|blob:)/i.test(uri)) throw new Error(`외부 파일 참조는 지원하지 않습니다: ${basename(uri)}.`);
          if (!findFile(uri, mainDirectory)) throw new Error(`필요한 파일이 없습니다: ${basename(uri)}. GLTF와 BIN·텍스처를 함께 선택해 주세요.`);
        }
        const loader = new GLTFLoader(manager);
        draco = new DRACOLoader();
        draco.setDecoderPath(new URL('./draco/gltf/', document.baseURI).href);
        loader.setDRACOLoader(draco);
        loader.setMeshoptDecoder(MeshoptDecoder);
        const gltf = await loader.parseAsync(extension === 'gltf' ? JSON.stringify(json) : data, mainDirectory ? `${mainDirectory}/` : '');
        loadedObject = gltf.scene;
      } else if (extension === 'obj') {
        const content = await main.text();
        const materialRefs = [...content.matchAll(/^mtllib\s+(.+)$/gm)].map(match => match[1].trim());
        const loader = new OBJLoader(manager);
        if (materialRefs.length) {
          const merged = {};
          for (const reference of materialRefs) {
            const mtl = findFile(reference, mainDirectory);
            if (!mtl) throw new Error(`필요한 MTL 파일이 없습니다: ${reference}. OBJ와 함께 선택해 주세요.`);
            const materialDirectory = directory(mtl.webkitRelativePath || mtl.name);
            const creator = new MTLLoader(manager).parse(await mtl.text(), materialDirectory ? `${materialDirectory}/` : '');
            creator.preload();
            Object.assign(merged, creator.materials);
          }
          loader.setMaterials({ create: name => merged[name] || new THREE.MeshStandardMaterial({ color: 0x777777, roughness: .55 }) });
        }
        loadedObject = loader.parse(content);
      } else {
        const geometry = new STLLoader().parse(await main.arrayBuffer());
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        loadedObject = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x777a80, metalness: .30, roughness: .38, vertexColors: !!geometry.attributes.color }));
      }
      if (pending) await new Promise(resolve => { waitResolve = resolve; });
      if (resourceErrors.length) throw new Error('텍스처를 읽을 수 없습니다. 파일 형식과 누락된 파일을 확인해 주세요.');
      this._setModel(loadedObject, { name: main.name, format: extension.toUpperCase(), isDemo: false });
      loadedObject = null;
      this._status('ready', `${main.name} · 로컬에서 불러왔습니다.`);
      return this.info;
    } catch (error) {
      disposeObject(loadedObject);
      const message = error instanceof Error ? error.message : '모델을 불러오지 못했습니다.';
      this._status('error', message);
      throw error;
    } finally {
      objectURLs.forEach(url => URL.revokeObjectURL(url));
      draco?.dispose();
      this._loading = false;
    }
  }

  _setModel(object, metadata) {
    let meshes = 0, triangles = 0, hasInstancing = false;
    const upgraded = new Map();
    object.traverse(child => {
      if (child.isLight || child.isCamera) child.visible = false;
      if (!child.isMesh) return;
      meshes++;
      hasInstancing ||= !!child.isInstancedMesh;
      triangles += (child.geometry.index?.count || child.geometry.attributes.position?.count || 0) / 3 * (child.isInstancedMesh ? child.count : 1);
      child.castShadow = child.receiveShadow = true;
      if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals();
      const convert = material => {
        if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) return material;
        if (upgraded.has(material)) return upgraded.get(material);
        const next = new THREE.MeshStandardMaterial({ color: material.color || 0x777777, map: material.map || null,
          normalMap: material.normalMap || null, bumpMap: material.bumpMap || null, bumpScale: material.bumpScale ?? 1,
          alphaMap: material.alphaMap || null, transparent: material.transparent, opacity: material.opacity,
          side: material.side, vertexColors: material.vertexColors,
          roughness: material.shininess == null ? .5 : clamp(Math.sqrt(2 / (material.shininess + 2)), .08, 1), metalness: 0,
          alphaTest: material.alphaTest || 0, emissive: material.emissive || 0,
          emissiveMap: material.emissiveMap || null, emissiveIntensity: material.emissiveIntensity ?? 1 });
        if (material.normalScale) next.normalScale.copy(material.normalScale);
        upgraded.set(material, next); material.dispose(); return next;
      };
      child.material = Array.isArray(child.material) ? child.material.map(convert) : convert(child.material);
      child.userData.studioOriginal = child.material;
      for (const mat of [child.material].flat()) {
        if (mat.map) mat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      }
    });
    if (!meshes) throw new Error('이 파일에서 렌더링할 수 있는 3D 메시를 찾지 못했습니다.');
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.length()) || size.length() < 1e-8) throw new Error('제품의 크기를 계산할 수 없습니다. 3D 파일을 확인해 주세요.');
    const previous = this.model;
    if (previous) this.scene.remove(previous);
    this.model = new THREE.Group();
    this.model.name = 'studio-product';
    const scale = 3.2 / Math.max(size.x, size.y, size.z);
    object.scale.multiplyScalar(scale);
    object.updateMatrixWorld(true);
    const normalized = new THREE.Box3().setFromObject(object), center = normalized.getCenter(new THREE.Vector3());
    object.position.sub(new THREE.Vector3(center.x, normalized.min.y, center.z));
    this.model.add(object);
    this.scene.add(this.model);
    this.info = { ...metadata, meshes, triangles: Math.round(triangles), dimensions: size.toArray(), hasInstancing };
    this._updateBounds();
    this._applyMaterial();
    this.setView('hero');
    disposeObject(previous);
    this.onChange({ ...this.info });
  }

  _updateBounds() {
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const center = box.getCenter(new THREE.Vector3());
    this.model.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    this.model.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.model);
    this.center = this.bounds.getCenter(new THREE.Vector3());
    this.radius = this.bounds.getBoundingSphere(new THREE.Sphere()).radius;
  }

  setPreset(preset) {
    if (!PRESETS[preset]) return;
    this.preset = preset;
    this.settings.background = PRESETS[preset].background;
    if (!this.environments.has(preset)) this.environments.set(preset, makeEnvironment(PRESETS[preset]));
    this.scene.environment = this.environments.get(preset);
    this._applyLighting();
  }

  _applyLighting() {
    const preset = PRESETS[this.preset], strength = this.settings.lightStrength;
    this.scene.background = this.settings.transparent ? null : new THREE.Color(this.settings.background || preset.background);
    this.scene.environmentIntensity = preset.environment * strength;
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(this.settings.lightAngle);
    this.lightRig.rotation.y = THREE.MathUtils.degToRad(this.settings.lightAngle);
    this.key.intensity = preset.key * strength; this.key.color.setHex(preset.color);
    this.rim.intensity = preset.rim * strength; this.rim.color.setHex(preset.rimColor);
    this.fill.intensity = preset.fill * strength;
    this.shadowLight.intensity = preset.shadow * strength;
    this.ambient.intensity = preset.ambient * strength;
    this.floor.visible = !this.settings.transparent;
    this.floor.material.color.set(this.settings.background && this.settings.background !== preset.background ? this.settings.background : preset.floor);
    this.renderer.toneMappingExposure = this.settings.exposure;
  }

  setSettings(settings) {
    const oldFocalLength = this.settings.focalLength;
    const safe = { ...settings };
    for (const [key, range] of Object.entries(SETTING_RANGES)) {
      if (key in safe) safe[key] = Number.isFinite(Number(safe[key])) ? clamp(Number(safe[key]), ...range) : this.settings[key];
    }
    if ('dof' in safe) safe.dof = !!safe.dof;
    if ('transparent' in safe) safe.transparent = !!safe.transparent;
    if (safe.background && !/^#[\da-f]{6}$/i.test(safe.background)) delete safe.background;
    if (safe.color && !/^#[\da-f]{6}$/i.test(safe.color)) delete safe.color;
    Object.assign(this.settings, safe);
    this._applyLighting();
    this._applyMaterial();
    if (oldFocalLength !== this.settings.focalLength) {
      const distance = this.camera.position.distanceTo(this.controls.target);
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.setFocalLength(this.settings.focalLength);
      this.camera.position.copy(this.controls.target).addScaledVector(direction, distance * this.settings.focalLength / oldFocalLength);
      this.camera.updateProjectionMatrix();
    }
  }

  _applyMaterial() {
    if (!this.model) return;
    if (!this.customMaterial) this.customMaterial = new THREE.MeshPhysicalMaterial({ clearcoat: .12 });
    this.customMaterial.color.set(this.settings.color);
    this.customMaterial.roughness = this.settings.roughness;
    this.customMaterial.metalness = this.settings.metalness;
    this.model.traverse(child => {
      if (!child.isMesh) return;
      child.material = this.settings.materialMode === 'custom' ? this.customMaterial : child.userData.studioOriginal;
    });
  }

  setView(view) {
    if (!this.model) return;
    const definition = VIEW_BY_ID[view] || VIEW_BY_ID.hero;
    const direction = new THREE.Vector3(...definition.direction).normalize();
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const limitingFov = Math.min(halfFov, Math.atan(Math.tan(halfFov) * this.camera.aspect));
    let distance = this.radius / Math.sin(limitingFov) * 1.03;
    const target = this.center.clone();
    if (definition.zoom) distance *= definition.zoom;
    if (definition.lift) target.y += definition.lift;
    this.camera.up.set(...(definition.up || [0, 1, 0]));
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.view = view;
    this.controls.saveState();
  }

  resetView() { this.setView('hero'); }

  // Serialisable camera pose, used for saved cuts and turntable frames.
  getCameraState() {
    return { position: this.camera.position.toArray(), target: this.controls.target.toArray(), up: this.camera.up.toArray(), focalLength: this.camera.getFocalLength() };
  }

  // Restores a pose from getCameraState(). Focal length is applied without the dolly
  // compensation of setSettings so the saved framing comes back exactly.
  applyCameraState(state) {
    if (!state?.position || !state?.target) return;
    this.camera.up.fromArray(state.up || [0, 1, 0]);
    this.controls.target.fromArray(state.target);
    this.camera.position.fromArray(state.position);
    if (Number.isFinite(state.focalLength)) { this.camera.setFocalLength(state.focalLength); this.settings.focalLength = this.camera.getFocalLength(); }
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.view = 'custom';
  }

  // Camera pose rotated around the vertical axis through the target. 0..1 maps to one full turn.
  orbitedCameraState(state, turn) {
    const target = new THREE.Vector3().fromArray(state.target);
    const offset = new THREE.Vector3().fromArray(state.position).sub(target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn * Math.PI * 2);
    return { ...state, position: target.clone().add(offset).toArray() };
  }

  rotateModel(axis = 'y') {
    if (!this.model || !['x', 'y', 'z'].includes(axis) || this._capturing) return;
    this.model.rotation[axis] += Math.PI / 2;
    this._updateBounds(); this.setView('hero');
  }

  resize() {
    if (!this.renderer || this._capturing) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  async capture({ width = 1600, height = 1600, quality = 'standard', view, camera, preset, signal, onProgress = () => {} } = {}) {
    if (this._capturing || this._loading) throw new Error('다른 렌더링 작업이 진행 중입니다.');
    if (!this.model) throw new Error('먼저 3D 모델을 불러와 주세요.');
    if (this._contextLost) throw new Error('GPU 연결이 끊겼습니다. 페이지를 새로고침해 주세요.');
    abort(signal);
    const max = Math.min(this.renderer.capabilities.maxTextureSize, 4096);
    width = Math.round(Number(width)); height = Math.round(Number(height));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32 || width > max || height > max) throw new Error(`출력 크기는 32–${max}px 범위에서 선택해 주세요.`);
    const state = { size: this.renderer.getSize(new THREE.Vector2()), ratio: this.renderer.getPixelRatio(), position: this.camera.position.clone(), quaternion: this.camera.quaternion.clone(), up: this.camera.up.clone(), target: this.controls.target.clone(), aspect: this.camera.aspect, preset: this.preset, settings: { ...this.settings }, view: this.view, controls: this.controls.enabled };
    this._capturing = true; this.controls.enabled = false;
    try {
      this.renderer.setPixelRatio(1); this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
      if (preset) this.setPreset(preset);
      if (camera) this.applyCameraState(camera);
      else if (view) this.setView(view);
      this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
      onProgress(.02);
      let engine = 'preview';
      if (quality !== 'preview') {
        try {
          this._status('loading', '고품질 패스 트레이싱 준비 중…', 0);
          await delay(); abort(signal);
          if (!this.renderer.extensions.has('EXT_color_buffer_float')) throw new Error('GPU 부동소수점 렌더 타깃 미지원');
          if (this.info.triangles > 1500000) throw new Error('150만 개가 넘는 삼각형은 미리보기 엔진으로 출력합니다');
          if (this.info.hasInstancing) throw new Error('인스턴스가 포함된 모델은 실시간 PBR 엔진으로 출력합니다');
          if (!this.pathTracer) {
            const { WebGLPathTracer, PhysicalCamera } = await import('three-gpu-pathtracer');
            abort(signal);
            this.pathTracer = new WebGLPathTracer(this.renderer);
            this.PhysicalCamera = PhysicalCamera;
          }
          const tracer = this.pathTracer;
          // Depth of field is a path-tracing feature: a physical camera with a real aperture
          // focused on the orbit target. The preview keeps using the pinhole camera.
          let renderCamera = this.camera;
          if (this.settings.dof) {
            renderCamera = new this.PhysicalCamera().copy(this.camera);
            renderCamera.fStop = this.settings.fStop;
            renderCamera.focusDistance = this.camera.position.distanceTo(this.controls.target);
            renderCamera.apertureBlades = 6;
            renderCamera.updateMatrixWorld(true);
          }
          tracer.tiles.set(width > 1600 || height > 1600 ? 4 : 2, width > 1600 || height > 1600 ? 4 : 2);
          tracer.renderDelay = 0; tracer.fadeDuration = 0; tracer.minSamples = 1;
          tracer.bounces = quality === 'high' ? 8 : 5;
          tracer.filterGlossyFactor = .5;
          tracer.textureSize.set(1024, 1024);
          tracer.setScene(this.scene, renderCamera);
          abort(signal);
          const targetSamples = quality === 'high' ? 256 : 64;
          let lastProgressAt = performance.now(), lastSamples = -1;
          while (tracer.samples < targetSamples) {
            abort(signal);
            if (this._contextLost) throw new Error('GPU 연결이 끊겼습니다');
            tracer.renderSample();
            if (tracer.samples !== lastSamples) { lastProgressAt = performance.now(); lastSamples = tracer.samples; }
            if (performance.now() - lastProgressAt > 60000) throw new Error('GPU 셰이더 준비 시간이 초과되었습니다');
            const progress = .08 + Math.min(tracer.samples / targetSamples, 1) * .89;
            onProgress(progress);
            await delay();
          }
          engine = 'pathtracing';
        } catch (error) {
          if (error.name === 'AbortError' || this._contextLost) throw error;
          this._status('warning', `패스 트레이싱을 사용할 수 없어 실시간 PBR 엔진으로 출력합니다. ${error.message}`);
          this._disposePathTracer();
          this.renderer.setRenderTarget(null);
          this.renderer.render(this.scene, this.camera);
          engine = 'fallback';
        }
      } else this.renderer.render(this.scene, this.camera);
      abort(signal);
      const blob = await new Promise((resolve, reject) => this.renderer.domElement.toBlob(value => value ? resolve(value) : reject(new Error('PNG 이미지 생성에 실패했습니다. 출력 크기를 줄여 주세요.')), 'image/png'));
      abort(signal);
      this.lastCaptureInfo = { engine, quality, width, height, samples: engine === 'pathtracing' ? this.pathTracer.samples : 0, dof: engine === 'pathtracing' && this.settings.dof };
      onProgress(1);
      return blob;
    } finally {
      this.setPreset(state.preset); Object.assign(this.settings, state.settings); this._applyLighting();
      this.camera.position.copy(state.position); this.camera.quaternion.copy(state.quaternion); this.camera.up.copy(state.up);
      this.controls.target.copy(state.target); this.camera.aspect = state.aspect;
      this.camera.setFocalLength(state.settings.focalLength); this.camera.updateProjectionMatrix();
      this.renderer.setPixelRatio(state.ratio); this.renderer.setSize(state.size.x, state.size.y, false);
      this.renderer.setRenderTarget(null);
      this.controls.enabled = state.controls; this.view = state.view;
      this._capturing = false;
      this.resize();
      if (!this._contextLost) this.renderer.render(this.scene, this.camera);
    }
  }

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._frame);
    this.observer?.disconnect(); this.controls?.dispose(); this._disposePathTracer();
    disposeObject(this.model); disposeObject(this.floor);
    this.customMaterial?.dispose();
    this.environments.forEach(texture => texture.dispose());
    this.renderer?.dispose(); this.renderer?.domElement.remove();
  }

  _disposePathTracer() {
    const tracer = this.pathTracer;
    if (!tracer) return;
    // 0.0.24's public dispose omits the low-res pass and material uniforms.
    // The dependency is pinned; release its owned resources, never model maps.
    const released = new Set();
    const release = resource => {
      if (!resource || released.has(resource)) return;
      released.add(resource);
      if (resource.isTexture && resource.renderTarget) {
        release(resource.renderTarget);
        return;
      }
      if (resource.fsQuad?.material) release(resource.fsQuad.material);
      resource.dispose?.();
    };
    for (const pass of [tracer._pathTracer, tracer._lowResPathTracer]) {
      const material = pass?.material;
      if (material && !released.has(material)) {
        for (const [name, uniform] of Object.entries(material.uniforms)) {
          if (name === 'backgroundMap' || name === 'sobolTexture') continue;
          const value = uniform.value;
          if (value?.dispose) release(value);
          else if (value?.tex?.isTexture) release(value.tex);
        }
        release(material);
      }
      release(pass?._blendQuad?.material);
    }
    release(tracer._internalBackground); release(tracer._colorBackground);
    release(tracer._generator?.geometry);
    const generator = tracer._generator?.staticGeometryGenerator;
    generator?._intermediateGeometry?.forEach(geometry => release(geometry));
    if (generator?._dummyMesh) disposeObject(generator._dummyMesh);
    tracer.dispose();
    tracer._lowResPathTracer?.dispose();
    this.pathTracer = null;
  }
}
