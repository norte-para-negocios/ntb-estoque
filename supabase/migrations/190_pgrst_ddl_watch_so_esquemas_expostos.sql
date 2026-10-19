-- 190: o aviso de "recarregue o esquema" do PostgREST (gatilhos de evento do Supabase
-- pgrst_ddl_watch / pgrst_drop_watch) passa a ignorar DDL em esquemas que o PostgREST não expõe.
--
-- Por quê (Fase I, medido em 19/10/2026): o serviço de tempo real cria uma partição nova de
-- realtime.messages por dia em cada banco (postgres e ntb_vendas) e o Supabase apaga as velhas;
-- cada uma dessas mudanças faz as duas instâncias do PostgREST (supabase-rest e rest-vendas)
-- recarregarem o esquema inteiro (2 consultas de catálogo, 40–80 ms cada, e um instante em que as
-- requisições esperam o cache novo). Esquemas expostos em produção (docker inspect, 19/10):
--   supabase-rest  PGRST_DB_SCHEMAS=public,graphql_public
--   rest-vendas    PGRST_DB_SCHEMAS=public
-- Se PGRST_DB_SCHEMAS mudar no docker-compose, atualizar a lista em pgrst_deve_recarregar().
--
-- Ganho real é pequeno (o gasto grande do spec de 18/10 era o ping OpenAPI do Vendas, ver
-- docs/superpowers/specs/2026-10-18-fase-i-velocidade-achados.md, "Resultados 19/10"); esta
-- migration só tira as recargas inúteis. DDL em public continua recarregando como sempre.
--
-- Aplicar (uma vez em cada banco que tiver as funções; no Estoque é o postgres; no Vendas,
-- ntb_vendas, só com o OK de quem cuida do Vendas):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 190_pgrst_ddl_watch_so_esquemas_expostos.sql
--
-- REVERTER: rodar o bloco abaixo (definição ORIGINAL de produção, lida em 19/10/2026 com
-- pg_get_functiondef) e depois `drop function if exists extensions.pgrst_deve_recarregar(text);`
-- Os gatilhos de evento (pgrst_ddl_watch, pgrst_drop_watch) não são tocados por esta migration.
/*
CREATE OR REPLACE FUNCTION extensions.pgrst_ddl_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;

CREATE OR REPLACE FUNCTION extensions.pgrst_drop_watch()
 RETURNS event_trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $function$;
*/

begin;

-- Regra única: o DDL num esquema só interessa ao PostgREST se o esquema é exposto (ou se o
-- objeto não tem esquema, ex. CREATE SCHEMA, que pode virar exposto).
create or replace function extensions.pgrst_deve_recarregar(p_schema text)
returns boolean
language sql
immutable
as $$
  select p_schema is null or p_schema in ('public', 'graphql_public')
$$;

create or replace function extensions.pgrst_ddl_watch()
 returns event_trigger
 language plpgsql
as $function$
declare
  cmd record;
begin
  for cmd in select * from pg_event_trigger_ddl_commands()
  loop
    if cmd.command_tag in (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- pg_temp e esquemas que o PostgREST não expõe (realtime, storage, auth, ...) não recarregam
    and (cmd.command_tag in ('CREATE SCHEMA', 'ALTER SCHEMA') or extensions.pgrst_deve_recarregar(cmd.schema_name))
    then
      notify pgrst, 'reload schema';
      return; -- um aviso por comando basta (o PostgREST recarrega tudo de uma vez)
    end if;
  end loop;
end; $function$;

create or replace function extensions.pgrst_drop_watch()
 returns event_trigger
 language plpgsql
as $function$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_dropped_objects()
  loop
    if obj.object_type in (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    and obj.is_temporary is false -- no pg_temp objects
    and (obj.object_type = 'schema' or extensions.pgrst_deve_recarregar(obj.schema_name))
    then
      notify pgrst, 'reload schema';
      return;
    end if;
  end loop;
end; $function$;

commit;

notify pgrst, 'reload schema';
