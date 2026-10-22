# LUMA × Supabase 연동 가이드

3D 모델, 렌더 결과, 조명 룩, 저장 구도를 Supabase(Postgres + Storage + Auth)에 보관하는 방법입니다.
스키마는 [`supabase/migrations/20261022000000_luma_studio.sql`](../supabase/migrations/20261022000000_luma_studio.sql) 한 파일입니다.

## 1. 구조

```
브라우저(LUMA)  ──supabase-js──▶  Supabase
                                  ├─ Auth      : 사용자 식별 (auth.uid())
                                  ├─ Postgres  : projects · models · model_files · renders · looks · camera_views
                                  └─ Storage   : models 버킷(3D 파일) · renders 버킷(PNG)
```

- **브라우저가 Supabase에 직접 연결**합니다. 별도 Node 서버가 필요 없으므로 Vercel 정적 배포에서도 DB 모드가 켜집니다.
- 보안은 **RLS(Row Level Security)** 가 담당합니다. 모든 행과 모든 Storage 객체는 `owner_id = auth.uid()` 인 사용자만 읽고 쓸 수 있습니다. 공개 anon 키를 프런트엔드에 넣어도 다른 사용자의 데이터에는 접근할 수 없습니다.
- 3D 파일의 **바이트는 Storage**, **메타데이터는 Postgres** 에 둡니다. GLTF(.gltf + .bin + 텍스처)나 OBJ(.obj + .mtl + 텍스처)처럼 여러 파일로 된 모델은 `models` 1행 + `model_files` N행으로 저장합니다.

> 지금까지 LUMA는 “모델 파일은 기기 밖으로 나가지 않는다”고 안내했습니다. Supabase에 모델을 저장하면 이 문구(`index.html` 의 `.privacy-note`, 도움말)를 “내 계정의 비공개 저장소에 보관됩니다”로 바꿔야 합니다.

### 테이블 요약

| 테이블 | 용도 | 핵심 컬럼 |
| --- | --- | --- |
| `projects` | 작업 공간 | `name`, `updated_at` (렌더 추가 시 자동 갱신) |
| `models` | 3D 모델 1개 | `name`(주 파일명), `format`(glb/gltf/obj/stl), `total_bytes`(≤300 MB), `mesh_count`, `triangle_count`, `dimensions[3]`, `thumbnail_path` |
| `model_files` | 모델을 이루는 파일들 | `role`(main/bin/mtl/texture/other), `name`, `relative_path`, `storage_path`(버킷 내 키), `size_bytes`, `sha256` |
| `renders` | 렌더 결과 | `view_id`, `preset`, `width/height`, `engine`, `samples`, `settings`(jsonb 스냅숏), `storage_path` |
| `looks` | 저장한 조명 룩 | `base_preset`, `settings`(jsonb) |
| `camera_views` | 저장한 구도 | `camera`(jsonb: position/target/up/focalLength) |
| `project_overview` (뷰) | 프로젝트 목록용 | `render_count`, `model_count`, `cover_render_id`, `latest_model_id` |

### Storage 키 규칙

```
models/  <owner_id>/<project_id>/<model_id>/<파일명>          예) …/arc.gltf, …/arc.bin, …/textures/albedo.png
renders/ <owner_id>/<project_id>/<render_id>.png
renders/ <owner_id>/<project_id>/<model_id>/thumbnail.png     (모델 썸네일, 선택)
```

첫 폴더가 사용자 uid 이므로 Storage 정책이 추가 조회 없이 소유자를 확인합니다. `register_model()` RPC 는 이 접두사가 아닌 경로를 거부합니다.

### RPC (SQL 함수)

| 함수 | 설명 |
| --- | --- |
| `register_model(p_project_id, p_name, p_format, p_total_bytes, p_files jsonb, p_model_id?, p_mesh_count?, p_triangle_count?, p_dimensions?, p_has_instancing?, p_thumbnail_path?) → uuid` | 모델 1행 + 파일 N행을 한 트랜잭션으로 등록. `p_files` 는 `[{role,name,relative_path,storage_path,mime_type,size_bytes,sha256}]` |
| `model_with_files(p_model_id) → (model jsonb, files jsonb)` | 모델을 다시 불러올 때 필요한 모든 정보 |
| `project_storage_paths(p_project_id) → (bucket, path)` | 프로젝트 삭제 전에 지워야 할 Storage 객체 목록 |

## 2. Supabase 설정 (10분)

1. **프로젝트 생성** → [supabase.com/dashboard](https://supabase.com/dashboard) → New project.
2. **스키마 적용**
   - 방법 A: SQL Editor 에 `supabase/migrations/20261022000000_luma_studio.sql` 내용을 붙여 넣고 Run.
   - 방법 B(CLI):
     ```bash
     npm i -g supabase
     supabase login
     supabase link --project-ref <project-ref>
     supabase db push            # LUMA-studio 폴더에서 실행
     ```
   - 마이그레이션은 멱등이라 다시 실행해도 안전합니다. 버킷 `models`, `renders` 도 함께 만들어집니다.
3. **Auth 설정** → Authentication → Providers
   - 가장 간단한 방식: **Anonymous sign-ins** 켜기. 사용자는 로그인 없이 바로 쓰고, 브라우저에 세션이 남습니다. 나중에 이메일을 연결(`updateUser`)하면 같은 데이터가 유지됩니다.
   - 계정이 필요하면 Email(Magic Link) 또는 OAuth 를 켜세요. 스키마는 어느 쪽이든 동일합니다.
4. **키 확인** → Project Settings → API: `Project URL`, `anon public` 키. `service_role` 키는 절대 프런트엔드에 넣지 마세요.
5. **(선택) Storage 용량**: Free 플랜의 객체 최대 크기는 50 MB 입니다. 300 MB 모델을 올리려면 Pro 플랜에서 Global file size limit 을 올리세요. 버킷의 `file_size_limit` 은 300 MB 로 설정돼 있습니다.

## 3. LUMA에 연결

### 3-1. 의존성과 환경 변수

```bash
cd LUMA-studio
npm i @supabase/supabase-js
```

`build.mjs` 의 esbuild 옵션에 빌드 시점 상수를 넣습니다. Vercel 에서는 Project Settings → Environment Variables 에 같은 이름으로 등록하면 됩니다.

```js
// build.mjs
define: {
  'globalThis.LUMA_SUPABASE_URL': JSON.stringify(process.env.LUMA_SUPABASE_URL || ''),
  'globalThis.LUMA_SUPABASE_ANON_KEY': JSON.stringify(process.env.LUMA_SUPABASE_ANON_KEY || ''),
},
```

### 3-2. 클라이언트와 로그인

```js
// src/supabase.js
import { createClient } from '@supabase/supabase-js';

export const supabase = globalThis.LUMA_SUPABASE_URL
  ? createClient(globalThis.LUMA_SUPABASE_URL, globalThis.LUMA_SUPABASE_ANON_KEY)
  : null;

export async function ensureSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user;
  const { data, error } = await supabase.auth.signInAnonymously();   // Anonymous sign-ins 가 켜져 있어야 합니다
  if (error) throw error;
  return data.user;
}
```

### 3-3. 기존 `StudioAPI` 를 Supabase 로 대체하기

`src/api.js` 의 `StudioAPI` 가 쓰는 메서드 이름을 그대로 구현하면 `app.js` 는 바꿀 필요가 없습니다.

| `StudioAPI` 메서드 | Supabase 호출 |
| --- | --- |
| `probe()` | `ensureSession()` 성공 여부 |
| `listProjects()` | `from('project_overview').select('*').order('updated_at', {ascending:false})` |
| `createProject({name})` | `from('projects').insert({name}).select().single()` |
| `updateProject(id, patch)` | `from('projects').update(patch).eq('id', id).select().single()` |
| `deleteProject(id)` | `rpc('project_storage_paths', {p_project_id:id})` → 버킷별 `storage.from(b).remove(paths)` → `from('projects').delete().eq('id', id)` |
| `listRenders(projectId)` | `from('renders').select('*').eq('project_id', projectId).order('created_at', {ascending:false})` |
| `uploadRender(projectId, blob, meta)` | 아래 3-5 |
| `renderImageURL(id)` | `storage.from('renders').createSignedUrl(path, 3600)` (비공개 버킷이므로 서명 URL) |
| `deleteRender(id)` | `storage.from('renders').remove([path])` → `from('renders').delete().eq('id', id)` |
| `listLooks()` / `createLook()` / `deleteLook()` | `from('looks')` 의 select / insert / delete |
| `listViews(projectId)` / `createView()` / `deleteView()` | `from('camera_views')` 의 select / insert / delete |

컬럼명은 snake_case(`project_id`, `preset_label` …)이고 앱 내부는 camelCase 이므로 어댑터에서 변환하세요.

### 3-4. 3D 모델 저장 (업로드 → 등록)

`engine.loadFiles(files)` 가 받는 `File[]` 을 그대로 올립니다. 모델 정보(`meshes`, `triangles`, `dimensions`)는 로드 뒤 `engine.info` 에 있습니다.

```js
export async function saveModel({ projectId, files, mainFile, info }) {
  const user = await ensureSession();
  const modelId = crypto.randomUUID();
  const prefix = `${user.id}/${projectId}/${modelId}/`;
  const roleOf = f => f === mainFile ? 'main'
    : /\.bin$/i.test(f.name) ? 'bin'
    : /\.mtl$/i.test(f.name) ? 'mtl'
    : /\.(png|jpe?g|webp|avif|ktx2)$/i.test(f.name) ? 'texture' : 'other';
  const relativeDir = f => (f.webkitRelativePath || f.name).split('/').slice(0, -1).join('/');

  const uploaded = [];
  for (const file of files) {
    const storagePath = prefix + (relativeDir(file) ? relativeDir(file) + '/' : '') + file.name;
    const { error } = await supabase.storage.from('models').upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream', upsert: false,
    });
    if (error) { await supabase.storage.from('models').remove(uploaded.map(u => u.storage_path)); throw error; }
    uploaded.push({ role: roleOf(file), name: file.name, relative_path: relativeDir(file), storage_path: storagePath,
      mime_type: file.type || null, size_bytes: file.size });
  }

  const { data, error } = await supabase.rpc('register_model', {
    p_project_id: projectId, p_model_id: modelId,
    p_name: mainFile.name, p_format: mainFile.name.split('.').pop().toLowerCase(),
    p_total_bytes: files.reduce((n, f) => n + f.size, 0),
    p_mesh_count: info.meshes, p_triangle_count: info.triangles, p_dimensions: info.dimensions,
    p_has_instancing: !!info.hasInstancing, p_files: uploaded,
  });
  if (error) { await supabase.storage.from('models').remove(uploaded.map(u => u.storage_path)); throw error; }
  return data; // model id
}
```

`app.js` 의 `loadFiles()` 성공 지점에서 `saveModel({ projectId: state.project.id, files: [...files], mainFile, info: engine.info })` 를 호출하면 됩니다. 300 MB 제한과 파일 종류 검사는 기존 `renderer.loadFiles()` 가 이미 수행합니다.

### 3-5. 저장한 모델 다시 불러오기

Storage 에서 내려받아 `File` 객체로 복원하면 기존 로더가 사이드카(bin/mtl/텍스처)를 그대로 해석합니다. `webkitRelativePath` 는 읽기 전용이라 하위 폴더 구조는 파일명에 경로를 포함해 전달합니다. `renderer.js` 의 `findFile()` 은 경로 끝부분 일치로도 찾기 때문에 동작합니다.

```js
export async function loadSavedModel(modelId, engine) {
  const { data, error } = await supabase.rpc('model_with_files', { p_model_id: modelId }).single();
  if (error) throw error;
  const files = await Promise.all(data.files.map(async f => {
    const { data: blob, error } = await supabase.storage.from('models').download(f.storage_path);
    if (error) throw error;
    const name = f.relative_path ? `${f.relative_path}/${f.name}` : f.name;
    return new File([blob], name, { type: f.mime_type || 'application/octet-stream' });
  }));
  await engine.loadFiles(files);
  return data.model;
}
```

### 3-6. 렌더 결과 저장

```js
export async function uploadRender(projectId, blob, meta, modelId = null) {
  const user = await ensureSession();
  const id = crypto.randomUUID();
  const storagePath = `${user.id}/${projectId}/${id}.png`;
  const { error: upErr } = await supabase.storage.from('renders').upload(storagePath, blob, { contentType: 'image/png' });
  if (upErr) throw upErr;
  const { data, error } = await supabase.from('renders').insert({
    id, project_id: projectId, model_id: modelId,
    view_id: meta.viewId, label: meta.label, preset: meta.preset, preset_label: meta.presetLabel,
    width: meta.width, height: meta.height, engine: meta.engine, engine_label: meta.engineLabel,
    quality: meta.quality, samples: meta.samples, filename: meta.filename,
    storage_path: storagePath, size_bytes: blob.size, settings: meta.settings,
  }).select().single();
  if (error) { await supabase.storage.from('renders').remove([storagePath]); throw error; }
  return data;
}
```

## 4. 자주 쓰는 쿼리

```sql
-- 내 프로젝트 목록 (렌더·모델 수 포함)
select * from project_overview order by updated_at desc;

-- 프로젝트의 모델과 파일 수
select m.id, m.name, m.format, m.triangle_count, count(f.*) as files
from models m left join model_files f on f.model_id = m.id
where m.project_id = '<project id>'
group by m.id order by m.created_at desc;

-- 특정 모델을 다시 여는 데 필요한 파일 경로
select * from model_with_files('<model id>');

-- 프로젝트의 렌더 (최신순) 와 사용한 프리셋
select label, preset_label, width, height, engine_label, settings->>'exposure' as exposure, created_at
from renders where project_id = '<project id>' order by created_at desc;

-- 어떤 모델로 어떤 렌더를 만들었는지
select m.name as model, r.label, r.created_at
from renders r join models m on m.id = r.model_id
where r.project_id = '<project id>' order by r.created_at desc;

-- 내 저장 용량 (바이트)
select (select coalesce(sum(size_bytes),0) from model_files) as model_bytes,
       (select coalesce(sum(size_bytes),0) from renders)     as render_bytes;

-- 프로젝트 삭제 전에 지울 Storage 객체
select * from project_storage_paths('<project id>');
```

## 5. 운영 메모

- **삭제 순서**: Storage 객체는 SQL 의 `on delete cascade` 로 지워지지 않습니다. `project_storage_paths()` 로 경로를 받아 `storage.remove()` 를 먼저 호출한 뒤 행을 지우세요. 고아 객체 정리가 필요하면 Edge Function 이나 pg_cron 으로 `storage.objects` 와 `model_files`/`renders` 를 대조하면 됩니다.
- **서명 URL**: 두 버킷 모두 비공개입니다. 갤러리 이미지는 `createSignedUrl(path, 3600)` 또는 `createSignedUrls()` 로 한 번에 받고, 만료 전에 갱신하세요.
- **중복 업로드 방지**: 같은 파일을 다시 올릴 때는 `sha256` 을 계산해 `model_files` 에서 먼저 조회하면 Storage 용량을 아낄 수 있습니다(`crypto.subtle.digest('SHA-256', await file.arrayBuffer())`).
- **대용량 업로드**: 6 MB 를 넘는 파일은 supabase-js 가 자동으로 재개 가능한 TUS 업로드(`upload()` 대신 `uploadToSignedUrl`/`resumable`)를 쓰도록 할 수 있습니다. 300 MB 급 모델은 `tus-js-client` 사용을 권장합니다.
- **기존 SQLite 서버와의 관계**: `server/store.mjs` 는 로컬·자체 호스팅용으로 그대로 둡니다. Supabase 어댑터는 같은 `StudioAPI` 인터페이스를 구현하므로 `app.js` 의 `new StudioAPI()` 자리에서 환경에 따라 골라 쓰면 됩니다.

## 6. 검증

이 마이그레이션은 PostgreSQL 16 에서 Supabase 의 `auth`/`storage` 스키마 스텁을 두고 두 번 연속 실행(멱등성)하고, 사용자 A 로 프로젝트·모델(파일 2개)·렌더·룩·구도를 만든 뒤 사용자 B 로는 행과 Storage 객체가 전혀 보이지 않고 다른 사용자 폴더에 쓸 수 없음을 확인했습니다. 잘못된 접두사의 `storage_path` 는 `register_model()` 이 거부합니다.
