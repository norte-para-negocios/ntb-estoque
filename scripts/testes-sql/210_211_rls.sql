-- RLS das funções 210 e 211 (security invoker): usuário comum da loja 5 vê a loja 5 e nada da loja 15.
-- Banco local d6 com dados reais das lojas 5 e 15; antes rode scripts/testes-sql/fi_setup_usuario_loja5.sql nele.
--   docker exec -i ntb-teste-sql psql -U postgres -d d6 -v ON_ERROR_STOP=1 < scripts/testes-sql/210_211_rls.sql
begin;
set local session_replication_role = replica;
insert into ordens_producao (id, loja_id, concluida, dt_conclusao_real, identificacao_n_cod_produto, identificacao_n_qtde) values (995001, 15, true, '2026-10-01', 1, 1);
set local session_replication_role = origin;
create temp table t_admin as
  select (select count(*) from relatorio_produtos_fornecedor(5)) pf5,
         (select count(*) from relatorio_ops_periodo(5, '2026-09-12', '2026-10-13')) ops5,
         (select count(*) from relatorio_ops_periodo(15, '2026-01-01', '2026-12-31')) ops15;
grant select on t_admin to authenticated;
set local role authenticated;
set local search_path = "$user", public;
select set_config('request.jwt.claims', '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
do $$
declare a record; n bigint;
begin
  select * into a from t_admin;
  select count(*) into n from relatorio_produtos_fornecedor(5);
  if n <> a.pf5 or n = 0 then raise exception 'loja 5 produtos por fornecedor: usuário % x admin %', n, a.pf5; end if;
  select count(*) into n from relatorio_ops_periodo(5, '2026-09-12', '2026-10-13');
  if n <> a.ops5 or n = 0 then raise exception 'loja 5 OPs: usuário % x admin %', n, a.ops5; end if;
  if a.ops15 = 0 then raise exception 'a loja 15 precisa de uma OP concluída para o teste valer'; end if;
  select count(*) into n from relatorio_ops_periodo(15, '2026-01-01', '2026-12-31');
  if n <> 0 then raise exception 'usuário da loja 5 viu % linhas da loja 15', n; end if;
  select count(*) into n from relatorio_produtos_fornecedor(15);
  if n <> 0 then raise exception 'usuário da loja 5 viu compras da loja 15'; end if;
  raise notice 'RLS 210/211 OK (loja 5: % pares, % linhas de OP; loja 15 escondida)', a.pf5, a.ops5;
end $$;
rollback;
