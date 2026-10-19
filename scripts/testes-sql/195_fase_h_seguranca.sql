-- Teste da migration 195 (Fase H). Cópia local com o esquema público de produção (fb_base), NUNCA em produção:
--   docker exec ntb-teste-sql psql -U postgres -c "create database fh template fb_base"
--   docker cp supabase/migrations/195_fase_h_seguranca.sql ntb-teste-sql:/tmp/195.sql
--   docker exec -i ntb-teste-sql psql -U postgres -d fh -v ON_ERROR_STOP=1 < scripts/testes-sql/195_fase_h_seguranca.sql
-- Parte 1 prova o problema (antes da 195); parte 2 aplica a 195; parte 3 prova a correção.
\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- parte 1: antes
-- A cópia local (fb_base) não traz os grants. Reproduz o estado de produção (privilégios padrão do Supabase:
-- tudo para anon e authenticated em toda tabela, sequência e função do public).
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;
create table public.bkp_teste_fase_h (id int, loja_id bigint);
insert into public.bkp_teste_fase_h values (1, 4);
grant all on public.bkp_teste_fase_h to anon, authenticated; -- como o padrão do Supabase faz

do $$
begin
  -- usuário comum (authenticated) e anon executam a função financeira de QUALQUER loja
  set local role authenticated;
  perform * from public.financeiro_resumo_cr(3);
  perform * from public.compras_precos_produtos(3, null);
  perform count(*) from public.bkp_teste_fase_h;
  reset role;
  set local role anon;
  perform * from public.financeiro_fluxo_caixa(3);
  reset role;
  raise notice 'ANTES: authenticated/anon executam financeiro_*/compras_* de outra loja e leem bkp_*';
end $$;

-- ---------------------------------------------------------------- parte 2: aplica
\i /tmp/195.sql

-- ---------------------------------------------------------------- parte 3: depois
create or replace function pg_temp.negado(p_role text, p_sql text) returns boolean language plpgsql as $$
begin
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
  exception when insufficient_privilege then
    reset role;
    return true;
  end;
  reset role;
  return false;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'select * from public.financeiro_resumo_cr(3)',
    'select * from public.financeiro_fluxo_caixa(3)',
    'select * from public.compras_precos_produtos(3, null)',
    'select * from public.compras_ranking_fornecedores(3, null)',
    'select * from public.crm_fornecedor_nf(3, 1)',
    'select * from public.crm_resumo_contas(3, 1, ''fornecedor'')',
    'select public.upsert_movimentos_ajuste(''[]''::jsonb)',
    'select public.baixar_saldo_local(3, 1, 0)'
  ] loop
    if not pg_temp.negado('authenticated', f) then raise exception 'FALHOU: authenticated ainda executa: %', f; end if;
    if not pg_temp.negado('anon', f) then raise exception 'FALHOU: anon ainda executa: %', f; end if;
  end loop;

  -- o servidor (service_role) continua podendo
  set local role service_role;
  perform * from public.financeiro_resumo_cr(3);
  perform public.upsert_movimentos_ajuste('[]'::jsonb);
  reset role;

  -- backup fechado
  if not pg_temp.negado('authenticated', 'select * from public.bkp_teste_fase_h') then raise exception 'FALHOU: bkp legível por authenticated'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.bkp_teste_fase_h'::regclass) then raise exception 'FALHOU: bkp sem RLS'; end if;

  -- anon fora do public
  if not pg_temp.negado('anon', 'select 1 from public.lojas limit 1') then raise exception 'FALHOU: anon lê lojas'; end if;
  if not pg_temp.negado('anon', 'select 1 from public.movimentos limit 1') then raise exception 'FALHOU: anon lê movimentos'; end if;

  -- usuário logado continua lendo pela RLS (grant de SELECT mantido), só perdeu TRUNCATE
  if pg_temp.negado('authenticated', 'select 1 from public.movimentos limit 1') then raise exception 'FALHOU: authenticated perdeu SELECT'; end if;
  if pg_temp.negado('authenticated', 'select public.usuario_e_admin()') then raise exception 'FALHOU: authenticated perdeu as funções da RLS'; end if;
  if has_table_privilege('authenticated', 'public.movimentos', 'TRUNCATE') then raise exception 'FALHOU: authenticated ainda tem TRUNCATE'; end if;
  raise notice 'DEPOIS: funções e backups fechados; leitura normal por RLS mantida';
end $$;

-- tabela nova de backup já nasce fechada (gatilho de eventos); tabela nova comum segue o padrão (sem anon)
create table public.bkp_nova_fase_h as select 1 as id, 4::bigint as loja_id;
create table public.tabela_nova_fase_h (id int);
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.bkp_nova_fase_h'::regclass) then raise exception 'FALHOU: bkp novo sem RLS'; end if;
  if has_table_privilege('authenticated', 'public.bkp_nova_fase_h', 'SELECT') then raise exception 'FALHOU: bkp novo com grant'; end if;
  if has_table_privilege('anon', 'public.tabela_nova_fase_h', 'SELECT') then raise exception 'FALHOU: tabela nova com grant para anon'; end if;
  raise notice 'DEPOIS: backup novo nasce com RLS e sem grant; tabela nova não dá nada ao anon';
end $$;
drop table public.bkp_teste_fase_h, public.bkp_nova_fase_h, public.tabela_nova_fase_h;
select 'OK 195' as resultado;
