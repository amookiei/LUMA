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

## 3. LUMA에 연결 (구현되어 있음)

어댑터는 `src/supabase-api.js` 에 들어 있습니다. 빌드할 때 두 환경 변수가 있으면 `app.js` 가 SQLite 서버 클라이언트(`StudioAPI`) 대신 `SupabaseStudioAPI` 를 사용합니다. 두 클래스는 같은 메서드를 가지므로 나머지 앱 코드는 동일합니다.

### 3-1. 키 설정

```
LUMA_SUPABASE_URL=https://<project-ref>.supabase.co
LUMA_SUPABASE_ANON_KEY=<anon public 키>
```

- 로컬: `LUMA-studio/.env` 에 적습니다(`.env.example` 복사). `build.mjs` 가 `process.loadEnvFile` 로 읽어 `dist/app.js` 에 굽습니다.
- Vercel: Settings → Environment Variables 에 같은 이름으로 추가하고 Redeploy 합니다. 값은 빌드에 포함되므로 바꾸면 재배포가 필요합니다.
- `service_role` 키는 절대 넣지 마세요. anon 키는 공개 키이고 데이터는 RLS 가 보호합니다.

빌드 로그 마지막 줄에 `Supabase: https://…` 가 보이면 적용된 것이고, `(Supabase not configured)` 면 SQLite/정적 모드로 빌드된 것입니다. 실행 중인 앱에서는 헤더에 `Supabase 연결됨` 이 표시됩니다.

### 3-2. 동작 방식

| 동작 | 구현 |
| --- | --- |
| 로그인 | 첫 방문에 `signInAnonymously()`. 세션은 브라우저에 저장되어 다음 방문에도 같은 사용자(같은 데이터)입니다. 브라우저 데이터를 지우면 새 익명 사용자가 되므로, 데이터를 오래 보관하려면 Auth → Users 에서 이메일을 연결하거나 Magic Link 로그인을 추가하세요. |
| 프로젝트 | `project_overview` 로 목록, `projects` 에 insert/update. 삭제 시 `project_storage_paths()` 로 받은 객체를 먼저 지우고 행을 삭제합니다. |
| 3D 모델 | 모델을 불러오면 자동으로 저장됩니다. 파일별 SHA-256 을 계산해 같은 프로젝트에 같은 주 파일(해시·총 용량 일치)이 있으면 업로드하지 않고 기존 모델을 선택합니다. 파일은 `models/<uid>/<project>/<model>/<하위폴더/파일명>` 으로 올라가고 `register_model()` 로 한 번에 등록됩니다. 등록이 실패하면 올린 파일을 되돌립니다. |
| 모델 다시 열기 | 왼쪽 ‘저장된 모델’ 목록에서 클릭 → `model_with_files()` → Storage 다운로드 → `File[]` 로 복원해 기존 로더(`renderer.loadFiles`)에 전달합니다. 하위 폴더 사이드카는 파일명에 경로를 포함해 전달하며 로더가 경로 끝 일치로 찾습니다. |
| 렌더 | `renders/<uid>/<project>/<render>.png` 업로드 후 `renders` 에 insert. 현재 모델의 id 가 `model_id` 로 연결됩니다. 갤러리 이미지는 `createSignedUrls()` 로 한 번에 6시간짜리 서명 URL 을 받습니다. |
| 룩 · 구도 | `looks`, `camera_views` 의 select / insert / delete. |

### 3-3. 직접 확장할 때

- 새 컬럼을 추가하면 `supabase-api.js` 의 `*Row()` 매핑 함수(snake_case → camelCase)만 고치면 됩니다.
- Storage 객체는 SQL cascade 로 지워지지 않으므로, 삭제 동작을 추가할 때는 어댑터의 `removeObjects()` 를 먼저 호출하세요.
- 테스트: `test/supabase-api.test.mjs` 가 가짜 supabase-js 클라이언트로 경로 규칙, 중복 검사, 롤백, 파일 복원을 검증합니다. `npm test` 로 실행합니다.

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

어댑터는 가짜 Supabase 엔드포인트(GoTrue 익명 가입, PostgREST, Storage)를 띄운 헤드리스 Chromium 에서 OBJ+MTL 업로드 → 중복 감지 → 모델에 연결된 렌더 저장 → 새로고침 후 갤러리(서명 URL)·모델·룩·구도 복원 → 저장 모델 다시 열기 → 모델 삭제까지 확인했습니다. 실제 Supabase 프로젝트에서의 첫 실행은 직접 확인해 주세요.

이 마이그레이션은 PostgreSQL 16 에서 Supabase 의 `auth`/`storage` 스키마 스텁을 두고 두 번 연속 실행(멱등성)하고, 사용자 A 로 프로젝트·모델(파일 2개)·렌더·룩·구도를 만든 뒤 사용자 B 로는 행과 Storage 객체가 전혀 보이지 않고 다른 사용자 폴더에 쓸 수 없음을 확인했습니다. 잘못된 접두사의 `storage_path` 는 `register_model()` 이 거부합니다.
