-- Teste da migration 190 (pgrst_ddl_watch só para esquemas expostos). Só no banco local de teste.
--
-- Rodar (o psql mostra "Asynchronous notification" quando a própria sessão recebe o NOTIFY):
--   docker exec -i ntb-teste-sql psql -U postgres -d fi -v ON_ERROR_STOP=1 -f - < scripts/testes-sql/190_pgrst_ddl_watch.sql 2>&1 \
--     | awk '/^CASO /{if(c)print c" -> "n" aviso(s), esperado "e; c=$2; e=$3; n=0} /Asynchronous notification "pgrst"/{n++} END{print c" -> "n" aviso(s), esperado "e}'
-- Passou = em toda linha o número de avisos é igual ao esperado.
--
-- Pré: simula o que existe em produção (esquema extensions, funções ORIGINAIS e gatilhos de evento)
-- e depois aplica a 190 por cima com \i.

create schema if not exists extensions;
create schema if not exists realtime;
create schema if not exists storage;
drop event trigger if exists pgrst_ddl_watch;
drop event trigger if exists pgrst_drop_watch;

-- funções originais (cópia do bloco REVERTER da 190)
CREATE OR REPLACE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger LANGUAGE plpgsql AS $function$
DECLARE cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands() LOOP
    IF cmd.command_tag IN ('CREATE SCHEMA', 'ALTER SCHEMA', 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE',
      'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE', 'CREATE VIEW', 'ALTER VIEW', 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW',
      'CREATE FUNCTION', 'ALTER FUNCTION', 'CREATE TRIGGER', 'CREATE TYPE', 'ALTER TYPE', 'CREATE RULE', 'COMMENT')
      AND cmd.schema_name is distinct from 'pg_temp' THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;
CREATE OR REPLACE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger LANGUAGE plpgsql AS $function$
DECLARE obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF obj.object_type IN ('schema', 'table', 'foreign table', 'view', 'materialized view', 'function', 'trigger', 'type', 'rule')
      AND obj.is_temporary IS false THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;
create event trigger pgrst_ddl_watch on ddl_command_end execute procedure extensions.pgrst_ddl_watch();
create event trigger pgrst_drop_watch on sql_drop execute procedure extensions.pgrst_drop_watch();

drop table if exists realtime.messages cascade;
drop table if exists public.t190;
drop function if exists public.f190();
create table realtime.messages (id bigint, inserted_at date not null) partition by range (inserted_at);

listen pgrst;

-- ANTES da 190: partição do realtime avisa (é o que acontece hoje em produção)
\echo CASO antes_realtime_particao 1
create table realtime.messages_2026_10_19 partition of realtime.messages for values from ('2026-10-19') to ('2026-10-20');
-- o realtime repete o CREATE ~40x por partição; quando ela já existe não há aviso nem antes da 190
\echo CASO antes_realtime_particao_existente 0
create table if not exists realtime.messages_2026_10_19 partition of realtime.messages for values from ('2026-10-19') to ('2026-10-20');
\echo CASO antes_realtime_drop_particao 1
drop table realtime.messages_2026_10_19;

\echo CASO aplica_190 1
\i supabase/migrations/190_pgrst_ddl_watch_so_esquemas_expostos.sql

-- a 190 não deixa função auxiliar (o gatilho não pode depender de USAGE em extensions)
\echo CASO sem_funcao_auxiliar 0
do $$ begin
  assert to_regprocedure('extensions.pgrst_deve_recarregar(text)') is null, 'sobrou pgrst_deve_recarregar';
end $$;

-- papel NÃO superusuário e SEM USAGE em extensions (como supabase_auth_admin/supabase_storage_admin)
-- fazendo DDL no próprio esquema: tem que passar (C1 da revisão de 19/10)
\echo CASO preparo_papel_create_schema 1
drop schema if exists fi190_auth cascade;
drop schema if exists fi190_novo cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fi190_admin') then
    create role fi190_admin nologin nosuperuser;
  end if;
end $$;
revoke all on schema extensions from public, fi190_admin;
select format('grant create on database %I to fi190_admin', current_database()) \gexec
create schema fi190_auth authorization fi190_admin;
do $$ begin
  assert not (select rolsuper from pg_roles where rolname = 'fi190_admin'), 'papel é superusuário';
  assert not has_schema_privilege('fi190_admin', 'extensions', 'USAGE'), 'papel tem USAGE em extensions';
end $$;
set role fi190_admin;
\echo CASO papel_sem_extensions_create_table 0
create table fi190_auth.users (id int);
\echo CASO papel_sem_extensions_alter_table 0
alter table fi190_auth.users add column email text;
\echo CASO papel_sem_extensions_function 0
create function fi190_auth.uid() returns int language sql as 'select 1';
\echo CASO papel_sem_extensions_drop 0
drop table fi190_auth.users;
\echo CASO papel_sem_extensions_create_schema_avisa 1
create schema fi190_novo;
\echo CASO papel_sem_extensions_drop_schema_avisa 1
drop schema fi190_novo;
reset role;
\echo CASO limpeza_drop_schema 1
drop schema fi190_auth cascade;
select format('revoke create on database %I from fi190_admin', current_database()) \gexec
drop role fi190_admin;

-- DEPOIS da 190
\echo CASO realtime_particao_nao_avisa 0
create table if not exists realtime.messages_2026_10_20 partition of realtime.messages for values from ('2026-10-20') to ('2026-10-21');
\echo CASO realtime_particao_existente_nao_avisa 0
create table if not exists realtime.messages_2026_10_20 partition of realtime.messages for values from ('2026-10-20') to ('2026-10-21');
\echo CASO realtime_drop_nao_avisa 0
drop table realtime.messages_2026_10_20;
\echo CASO storage_alter_nao_avisa 0
create table storage.t190 (id int);
\echo CASO temp_nao_avisa 0
create temp table t190_temp (id int);
\echo CASO public_create_table_avisa 1
create table public.t190 (id int);
\echo CASO public_alter_table_avisa 1
alter table public.t190 add column nome text;
\echo CASO public_comment_avisa 1
comment on table public.t190 is 'teste 190';
\echo CASO public_function_avisa 1
create function public.f190() returns int language sql as 'select 1';
\echo CASO public_drop_function_avisa 1
drop function public.f190();
\echo CASO public_drop_table_avisa 1
drop table public.t190;
\echo CASO create_schema_avisa 1
create schema t190_esq;
\echo CASO drop_schema_avisa 1
drop schema t190_esq;
\echo CASO reaplica_190_idempotente 1
\i supabase/migrations/190_pgrst_ddl_watch_so_esquemas_expostos.sql
\echo CASO fim 0
drop table storage.t190;
