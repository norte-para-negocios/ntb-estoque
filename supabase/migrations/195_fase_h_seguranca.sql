-- 195_fase_h_seguranca.sql -- Fase H (auditoria de cibersegurança, 19/10/2026).
-- Depende de nada novo (só objetos que já existem em produção). Numa transação só: `begin ... commit`.
-- Testes: scripts/testes-sql/195_fase_h_seguranca.sql (rodar numa cópia local, nunca em produção).
--
-- Achados que esta migration fecha (prova em docs/superpowers/specs/2026-10-19-fase-h-seguranca-achados.md):
--
-- A) Funções SECURITY DEFINER (dono postgres, sem search_path fixo) que recebem p_loja_id e NÃO conferem se o
--    usuário é da loja: financeiro_fluxo_caixa, financeiro_resumo_cr, compras_precos_produtos,
--    compras_ranking_fornecedores, crm_fornecedor_nf, crm_resumo_contas. Executáveis por anon e authenticated:
--    um usuário comum da loja 5 lia contas a pagar/receber, ranking de fornecedores e preços de compra da loja 3
--    (provado com `set local role authenticated` + claims de um usuário real, e também como anon). Nenhum código
--    do app chama essas 6 funções hoje (grep em app/ lib/ components/: 0). Ficam só para service_role.
-- B) upsert_movimentos_ajuste(jsonb) (SECURITY DEFINER, grava `movimentos` de QUALQUER loja) e
--    baixar_saldo_local(...) (SECURITY DEFINER, mexe no saldo local de qualquer loja) executáveis por anon e
--    authenticated. Só o servidor (service_role) chama as duas (lib/omie/sync-ajustes.ts e
--    app/api/integracao/ordem-producao -> lib/estoque-local/baixa.ts, ambos com createServiceClient).
-- C) Tabela de backup criada à mão em produção (bkp_op_sertao_inativo_20261019) sem RLS e com
--    SELECT/INSERT/UPDATE/DELETE/TRUNCATE para anon e authenticated: OPs da loja 4 legíveis por qualquer usuário
--    de qualquer loja (provado: usuário comum da loja 5 vê as 16 linhas) e apagáveis. Vale para toda tabela
--    `bkp_%` / `backup_%` do schema public (hoje e daqui para frente, pelo gatilho de eventos do item E).
-- D) O papel anon (requisição sem login) não precisa de nada no schema public: o app sempre fala com JWT de
--    usuário (authenticated) ou com a service role. O app desktop já aplica exatamente isto no banco local
--    (desktop/schema/local.sql). Os privilégios padrão do Supabase davam a anon tudo em toda tabela nova.
--    TRUNCATE (que a RLS não barra) também sai de authenticated.
-- E) Gatilho de eventos: tabela nova em public com nome de backup (`bkp_%`, `backup_%`) já nasce com RLS ligada
--    e sem grant para anon/authenticated (cópia de segurança feita à mão nunca mais fica aberta).
--
-- NÃO muda: políticas de RLS existentes, grants de SELECT de authenticated (as telas leem com a sessão), nem as
-- funções usuario_* das políticas. Reverter: ver o bloco "Reverter" no fim do arquivo.

begin;

-- A + B) funções sem checagem de loja: só o servidor
do $$
declare
  f text;
  alvo text[] := array[
    'public.financeiro_fluxo_caixa(bigint)',
    'public.financeiro_resumo_cr(bigint)',
    'public.compras_precos_produtos(bigint, text)',
    'public.compras_ranking_fornecedores(bigint, date)',
    'public.crm_fornecedor_nf(bigint, bigint)',
    'public.crm_resumo_contas(bigint, bigint, text)',
    'public.upsert_movimentos_ajuste(jsonb)',
    'public.baixar_saldo_local(bigint, bigint, numeric)'
  ];
begin
  foreach f in array alvo loop
    if to_regprocedure(f) is null then
      raise notice '195: função % não existe aqui, pulando', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
    -- SECURITY DEFINER sem search_path fixo: quem chama não pode trocar o que "contas_pagar" significa.
    execute format('alter function %s set search_path = public, pg_temp', f);
  end loop;
end $$;

-- C) tabelas de backup abertas
do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as tabela
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and (c.relname like 'bkp\_%' or c.relname like 'backup\_%')
  loop
    execute format('alter table %s enable row level security', t.tabela);
    execute format('revoke all on table %s from anon, authenticated', t.tabela);
  end loop;
end $$;

-- D) anon fora do schema public; TRUNCATE fora de authenticated
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke truncate on all tables in schema public from authenticated;
alter default privileges for role supabase_admin in schema public revoke all on tables from anon;
alter default privileges for role supabase_admin in schema public revoke all on sequences from anon;
alter default privileges for role supabase_admin in schema public revoke execute on functions from anon;
alter default privileges for role supabase_admin in schema public revoke truncate on tables from authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke truncate on tables from authenticated;

-- E) backup novo já nasce fechado
create or replace function public.fase_h_fechar_tabela_backup()
returns event_trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  loop
    if obj.schema_name = 'public' and obj.object_type = 'table'
       and (split_part(obj.object_identity, '.', 2) like 'bkp\_%' or split_part(obj.object_identity, '.', 2) like 'backup\_%') then
      execute format('alter table %s enable row level security', obj.object_identity);
      execute format('revoke all on table %s from anon, authenticated', obj.object_identity);
    end if;
  end loop;
end $$;
revoke execute on function public.fase_h_fechar_tabela_backup() from public, anon, authenticated;

drop event trigger if exists fase_h_fechar_tabela_backup;
create event trigger fase_h_fechar_tabela_backup on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.fase_h_fechar_tabela_backup();

commit;

-- PostgREST: recarregar o cache depois de aplicar (padrão do projeto).
notify pgrst, 'reload schema';

-- Reverter (só se algo quebrar; nada no app depende de anon nem dessas 8 funções via sessão):
--   grant execute on function public.financeiro_fluxo_caixa(bigint) to anon, authenticated;  -- idem para as outras 7
--   grant select, insert, update, delete, truncate, references, trigger on all tables in schema public to anon;
--   grant usage, select, update on all sequences in schema public to anon;
--   grant execute on all functions in schema public to anon;
--   grant truncate on all tables in schema public to authenticated;
--   drop event trigger fase_h_fechar_tabela_backup; drop function public.fase_h_fechar_tabela_backup();
