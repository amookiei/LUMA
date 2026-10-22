-- LUMA Product Render Studio — Supabase schema
--
-- Stores 3D models (file metadata; the bytes live in Storage), projects, render
-- results, saved lighting looks and saved camera cuts. Every row is owned by the
-- signed-in user (auth.uid()) and protected with Row Level Security, so the browser
-- can talk to Supabase directly with the public anon key.
--
-- Apply with the Supabase CLI (`supabase db push`) or paste into the SQL editor.
-- Idempotent: safe to run again.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Owners can never be reassigned through the API.
create or replace function public.lock_owner()
returns trigger language plpgsql as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot be changed';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null default 'Untitled studio' check (char_length(name) between 1 and 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists projects_owner_updated on public.projects (owner_id, updated_at desc);

drop trigger if exists projects_updated_at on public.projects;
create trigger projects_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
drop trigger if exists projects_lock_owner on public.projects;
create trigger projects_lock_owner before update on public.projects
  for each row execute function public.lock_owner();

-- ---------------------------------------------------------------------------
-- 3D models
--   A model is one product: a main file (GLB / GLTF / OBJ / STL) plus optional
--   sidecars (GLTF .bin and textures, OBJ .mtl and textures). Each file is one row
--   in model_files and one object in the private `models` storage bucket at
--     <owner_id>/<project_id>/<model_id>/<file name>
-- ---------------------------------------------------------------------------
create table if not exists public.models (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 200),  -- main file name, e.g. "arc-headphones.glb"
  format          text not null check (format in ('glb', 'gltf', 'obj', 'stl')),
  total_bytes     bigint not null check (total_bytes > 0 and total_bytes <= 300 * 1024 * 1024),
  mesh_count      integer check (mesh_count >= 0),
  triangle_count  integer check (triangle_count >= 0),
  dimensions      double precision[] check (dimensions is null or cardinality(dimensions) = 3),  -- original size x,y,z
  has_instancing  boolean not null default false,
  thumbnail_path  text,                       -- optional preview PNG in the `renders` bucket
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists models_project_created on public.models (project_id, created_at desc);
create index if not exists models_owner on public.models (owner_id);

drop trigger if exists models_updated_at on public.models;
create trigger models_updated_at before update on public.models
  for each row execute function public.set_updated_at();
drop trigger if exists models_lock_owner on public.models;
create trigger models_lock_owner before update on public.models
  for each row execute function public.lock_owner();

create table if not exists public.model_files (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  model_id      uuid not null references public.models (id) on delete cascade,
  role          text not null check (role in ('main', 'bin', 'mtl', 'texture', 'other')),
  name          text not null check (char_length(name) between 1 and 255),   -- file name as referenced by the model
  relative_path text not null default '',                                      -- sub-folder relative to the main file ('' = same folder)
  storage_path  text not null unique,                                          -- object key inside the `models` bucket
  mime_type     text,
  size_bytes    bigint not null check (size_bytes >= 0),
  sha256        text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  unique (model_id, relative_path, name)
);
create index if not exists model_files_model on public.model_files (model_id);
create unique index if not exists model_files_one_main on public.model_files (model_id) where role = 'main';

-- ---------------------------------------------------------------------------
-- Render results (PNG bytes live in the private `renders` bucket)
-- ---------------------------------------------------------------------------
create table if not exists public.renders (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  model_id      uuid references public.models (id) on delete set null,
  view_id       text not null default 'custom',
  label         text not null default '렌더링',
  preset        text not null default 'custom',
  preset_label  text not null default '',
  width         integer not null check (width between 1 and 16384),
  height        integer not null check (height between 1 and 16384),
  engine        text not null default 'preview' check (engine in ('preview', 'pathtracing', 'fallback')),
  engine_label  text not null default '',
  quality       text,
  samples       integer not null default 0 check (samples >= 0),
  filename      text not null,
  storage_path  text not null unique,     -- <owner_id>/<project_id>/<render_id>.png in the `renders` bucket
  size_bytes    bigint not null check (size_bytes > 0),
  settings      jsonb,                    -- lighting / material / effects snapshot at render time
  created_at    timestamptz not null default now()
);
create index if not exists renders_project_created on public.renders (project_id, created_at desc);
create index if not exists renders_owner on public.renders (owner_id);

-- A new render bumps the project's updated_at so project lists sort by activity.
create or replace function public.touch_project_on_render()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.projects set updated_at = now() where id = coalesce(new.project_id, old.project_id);
  return coalesce(new, old);
end $$;
drop trigger if exists renders_touch_project on public.renders;
create trigger renders_touch_project after insert or delete on public.renders
  for each row execute function public.touch_project_on_render();

-- ---------------------------------------------------------------------------
-- Saved lighting looks (per user) and saved camera cuts (per project)
-- ---------------------------------------------------------------------------
create table if not exists public.looks (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  base_preset  text not null check (char_length(base_preset) between 1 and 60),
  settings     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists looks_owner_created on public.looks (owner_id, created_at);

create table if not exists public.camera_views (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  camera      jsonb not null,   -- {position:[x,y,z], target:[x,y,z], up:[x,y,z], focalLength}
  created_at  timestamptz not null default now(),
  constraint camera_views_camera_shape check (
    jsonb_typeof(camera -> 'position') = 'array' and jsonb_typeof(camera -> 'target') = 'array'
  )
);
create index if not exists camera_views_project_created on public.camera_views (project_id, created_at);

-- ---------------------------------------------------------------------------
-- Convenience view: projects with counts and the newest render / model
-- ---------------------------------------------------------------------------
create or replace view public.project_overview
with (security_invoker = true) as
select
  p.id, p.owner_id, p.name, p.created_at, p.updated_at,
  (select count(*) from public.renders r where r.project_id = p.id)             as render_count,
  (select count(*) from public.models m where m.project_id = p.id)              as model_count,
  (select r.id from public.renders r where r.project_id = p.id order by r.created_at desc limit 1) as cover_render_id,
  (select m.id from public.models m where m.project_id = p.id order by m.created_at desc limit 1) as latest_model_id
from public.projects p;

-- ---------------------------------------------------------------------------
-- Row Level Security: every table is private to its owner
-- ---------------------------------------------------------------------------
alter table public.projects     enable row level security;
alter table public.models       enable row level security;
alter table public.model_files  enable row level security;
alter table public.renders      enable row level security;
alter table public.looks        enable row level security;
alter table public.camera_views enable row level security;

do $$
declare t text;
begin
  foreach t in array array['projects', 'models', 'model_files', 'renders', 'looks', 'camera_views'] loop
    execute format('drop policy if exists "%1$s: owner select" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner insert" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner update" on public.%1$I', t);
    execute format('drop policy if exists "%1$s: owner delete" on public.%1$I', t);
    execute format('create policy "%1$s: owner select" on public.%1$I for select to authenticated using (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner insert" on public.%1$I for insert to authenticated with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner update" on public.%1$I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
    execute format('create policy "%1$s: owner delete" on public.%1$I for delete to authenticated using (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Child rows must point at a parent the same user owns.
drop policy if exists "model_files: owner insert" on public.model_files;
create policy "model_files: owner insert" on public.model_files for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.models m where m.id = model_id and m.owner_id = auth.uid()));
drop policy if exists "models: owner insert" on public.models;
create policy "models: owner insert" on public.models for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
drop policy if exists "renders: owner insert" on public.renders;
create policy "renders: owner insert" on public.renders for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));
drop policy if exists "camera_views: owner insert" on public.camera_views;
create policy "camera_views: owner insert" on public.camera_views for insert to authenticated
  with check (owner_id = auth.uid() and exists (select 1 from public.projects p where p.id = project_id and p.owner_id = auth.uid()));

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.projects, public.models, public.model_files, public.renders, public.looks, public.camera_views to authenticated;
grant select on public.project_overview to authenticated;

-- ---------------------------------------------------------------------------
-- Storage buckets
--   models  : 3D files, private, 300 MB per object
--   renders : PNG outputs and model thumbnails, private, 96 MB per object
-- Object keys start with the owner's uid so the policies below can scope access
-- without an extra lookup:  <owner_id>/<project_id>/<model_id>/<file name>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('models', 'models', false, 300 * 1024 * 1024,
   array['model/gltf-binary', 'model/gltf+json', 'model/obj', 'model/mtl', 'model/stl', 'application/octet-stream',
         'application/json', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/ktx2']),
  ('renders', 'renders', false, 96 * 1024 * 1024, array['image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

do $$
declare b text;
begin
  foreach b in array array['models', 'renders'] loop
    execute format('drop policy if exists "%1$s: owner read" on storage.objects', b);
    execute format('drop policy if exists "%1$s: owner write" on storage.objects', b);
    execute format('drop policy if exists "%1$s: owner update" on storage.objects', b);
    execute format('drop policy if exists "%1$s: owner delete" on storage.objects', b);
    execute format($p$create policy "%1$s: owner read" on storage.objects for select to authenticated
      using (bucket_id = %1$L and (storage.foldername(name))[1] = auth.uid()::text)$p$, b);
    execute format($p$create policy "%1$s: owner write" on storage.objects for insert to authenticated
      with check (bucket_id = %1$L and (storage.foldername(name))[1] = auth.uid()::text)$p$, b);
    execute format($p$create policy "%1$s: owner update" on storage.objects for update to authenticated
      using (bucket_id = %1$L and (storage.foldername(name))[1] = auth.uid()::text)$p$, b);
    execute format($p$create policy "%1$s: owner delete" on storage.objects for delete to authenticated
      using (bucket_id = %1$L and (storage.foldername(name))[1] = auth.uid()::text)$p$, b);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RPC: register a model and all of its files in one transaction
--   select public.register_model(
--     p_project_id   => '...',
--     p_name         => 'arc.gltf', p_format => 'gltf', p_total_bytes => 1234567,
--     p_mesh_count   => 12, p_triangle_count => 52000, p_dimensions => array[0.2, 0.18, 0.09],
--     p_files        => '[{"role":"main","name":"arc.gltf","relative_path":"","storage_path":"<uid>/<project>/<model>/arc.gltf","mime_type":"model/gltf+json","size_bytes":4096},
--                         {"role":"bin","name":"arc.bin","relative_path":"","storage_path":"<uid>/<project>/<model>/arc.bin","size_bytes":1230471}]'
--   );
-- Returns the new model id. Upload the files to Storage first (the paths must
-- already be under <auth.uid()>/<project_id>/<model_id>/ — pass p_model_id to pin it).
-- ---------------------------------------------------------------------------
create or replace function public.register_model(
  p_project_id uuid,
  p_name text,
  p_format text,
  p_total_bytes bigint,
  p_files jsonb,
  p_model_id uuid default gen_random_uuid(),
  p_mesh_count integer default null,
  p_triangle_count integer default null,
  p_dimensions double precision[] default null,
  p_has_instancing boolean default false,
  p_thumbnail_path text default null
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  f jsonb;
  prefix text := auth.uid()::text || '/' || p_project_id::text || '/' || p_model_id::text || '/';
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then raise exception 'p_files must be a non-empty array'; end if;
  if (select count(*) from jsonb_array_elements(p_files) e where e ->> 'role' = 'main') <> 1 then raise exception 'exactly one file must have role "main"'; end if;

  insert into public.models (id, project_id, name, format, total_bytes, mesh_count, triangle_count, dimensions, has_instancing, thumbnail_path)
  values (p_model_id, p_project_id, p_name, p_format, p_total_bytes, p_mesh_count, p_triangle_count, p_dimensions, coalesce(p_has_instancing, false), p_thumbnail_path);

  for f in select * from jsonb_array_elements(p_files) loop
    if position(prefix in (f ->> 'storage_path')) <> 1 then
      raise exception 'storage_path % must start with %', f ->> 'storage_path', prefix;
    end if;
    insert into public.model_files (model_id, role, name, relative_path, storage_path, mime_type, size_bytes, sha256)
    values (p_model_id, f ->> 'role', f ->> 'name', coalesce(f ->> 'relative_path', ''), f ->> 'storage_path', f ->> 'mime_type', (f ->> 'size_bytes')::bigint, f ->> 'sha256');
  end loop;

  update public.projects set updated_at = now() where id = p_project_id;
  return p_model_id;
end $$;
grant execute on function public.register_model(uuid, text, text, bigint, jsonb, uuid, integer, integer, double precision[], boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: everything needed to reload a model into the studio
--   select * from public.model_with_files('<model id>');
-- ---------------------------------------------------------------------------
create or replace function public.model_with_files(p_model_id uuid)
returns table (model jsonb, files jsonb)
language sql stable security invoker set search_path = public as $$
  select to_jsonb(m) as model,
         coalesce((select jsonb_agg(to_jsonb(f) order by f.role = 'main' desc, f.name) from public.model_files f where f.model_id = m.id), '[]'::jsonb) as files
  from public.models m
  where m.id = p_model_id;
$$;
grant execute on function public.model_with_files(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: storage paths to delete before removing a project (Storage objects are not
-- removed by SQL cascades; call storage.remove() with these paths from the client
-- or an Edge Function, then delete the project row).
-- ---------------------------------------------------------------------------
create or replace function public.project_storage_paths(p_project_id uuid)
returns table (bucket text, path text)
language sql stable security invoker set search_path = public as $$
  select 'models'::text, mf.storage_path from public.model_files mf join public.models m on m.id = mf.model_id where m.project_id = p_project_id
  union all
  select 'renders'::text, m.thumbnail_path from public.models m where m.project_id = p_project_id and m.thumbnail_path is not null
  union all
  select 'renders'::text, r.storage_path from public.renders r where r.project_id = p_project_id;
$$;
grant execute on function public.project_storage_paths(uuid) to authenticated;
