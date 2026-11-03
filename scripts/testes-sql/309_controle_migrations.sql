-- Teste da 309 (public.schema_migrations). Rodar numa copia local (Postgres 17 em Docker, nunca em producao):
--   docker run --rm -d --name pg17-309 -e POSTGRES_PASSWORD=x -p 5544:5432 postgres:17
--   psql -h 127.0.0.1 -p 5544 -U postgres -v ON_ERROR_STOP=1 -c "create role anon nologin; create role authenticated nologin;"
--   psql -h 127.0.0.1 -p 5544 -U postgres -v ON_ERROR_STOP=1 -f scripts/testes-sql/309_controle_migrations.sql
\set ON_ERROR_STOP 1
begin;
\ir ../../supabase/migrations/309_controle_migrations.sql
-- idempotente: rodar de novo nao muda nada nem falha
\ir ../../supabase/migrations/309_controle_migrations.sql
do $$
declare n int; p int;
begin
  select count(*) into n from public.schema_migrations;
  if n <> 224 then raise exception 'esperava 224 versoes, veio %', n; end if;
  select count(*) into p from public.schema_migrations where versao = 61;
  if p <> 1 then raise exception '061 deveria ter 1 linha, veio %', p; end if;
  if (select count(*) from public.schema_migrations where por = 'presumida-2026-11-03') <> 223 then raise exception 'presumidas devem ser 223 (001-308)'; end if;
  if (select por from public.schema_migrations where versao = 309) <> 'migration-309' then raise exception '309 deve constar como aplicada de verdade'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass) then raise exception 'RLS desligada'; end if;
  if exists (select 1 from pg_policies where tablename = 'schema_migrations') then raise exception 'nao deveria haver policy'; end if;
end $$;
-- anon/authenticated nao enxergam nada
set local role anon;
do $$ begin
  begin perform 1 from public.schema_migrations limit 1; raise exception 'anon leu schema_migrations';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- o runner recusa versao repetida por esta via: a PK impede duplicata
do $$ begin
  begin insert into public.schema_migrations (versao, arquivo) values (309, 'x'); raise exception 'duplicata aceita';
  exception when unique_violation then null; end;
end $$;
rollback;
select 'ok 309' as resultado;
