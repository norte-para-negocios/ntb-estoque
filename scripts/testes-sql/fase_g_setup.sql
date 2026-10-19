-- Preparação dos testes da Fase G (220–223) no banco LOCAL g1 (create database g1 template fb + 187, 188, 190–195, 200, 201).
-- Nunca em produção. Idempotente. Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d g1 < scripts/testes-sql/fase_g_setup.sql
-- 1. auth.uid() como em produção (lê o sub do JWT).
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
-- 2. GRANTs de leitura que produção tem para authenticated (a RLS continua valendo).
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function auth.uid() to authenticated, service_role;
grant execute on function public.usuario_lojas(), public.usuario_e_admin() to authenticated;
-- 3. Stub mínimo do schema storage do Supabase (o fb não tem): buckets, objects com RLS e foldername.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false, file_size_limit bigint, allowed_mime_types text[], owner_id text);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, version text, owner_id text, user_metadata jsonb);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
grant usage on schema storage to authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
grant execute on function storage.foldername(text) to authenticated;
-- 4. Lojas e usuários de teste (ids altos para não colidir com o fb).
insert into lojas (id, nome, cnpj, modo_estoque) values (9001, 'G PROPRIA', '90010000000001', 'proprio') on conflict (id) do nothing;
insert into lojas (id, nome, cnpj, modo_estoque) values (9002, 'G OMIE', '90020000000001', 'omie') on conflict (id) do nothing;
insert into profiles (id, name, perfil, status) values
  ('00000000-0000-4000-8000-000000009001', 'Ana Própria', 'Usuario', 'aprovado'),
  ('00000000-0000-4000-8000-000000009002', 'Bruno Omie', 'Usuario', 'aprovado')
on conflict (id) do nothing;
insert into loja_user (loja_id, user_id) select 9001, '00000000-0000-4000-8000-000000009001'
  where not exists (select 1 from loja_user where loja_id = 9001 and user_id = '00000000-0000-4000-8000-000000009001');
insert into loja_user (loja_id, user_id) select 9002, '00000000-0000-4000-8000-000000009002'
  where not exists (select 1 from loja_user where loja_id = 9002 and user_id = '00000000-0000-4000-8000-000000009002');
