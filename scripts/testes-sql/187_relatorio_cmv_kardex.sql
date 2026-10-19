-- Teste de relatorio_cmv_kardex (migration 187, depende da 173). Rodar numa cópia local, nunca em produção:
--   docker exec -i ntb-teste-sql psql -U postgres -d fd -v ON_ERROR_STOP=1 < scripts/testes-sql/187_relatorio_cmv_kardex.sql
-- Período 01–03/10/2026, loja 7.
begin;
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, quantidade, valor_unit, saldo_apos, cmc_apos, cancelado) values
 -- produto 100: compra antes do período, venda, compra, venda, ajuste depois do fim, venda cancelada
 (7, 1, 100, 1, '2026-09-30', 'COM', 10, 5, 10, 5, false),
 (7, 2, 100, 1, '2026-10-01', 'PDV', -2, 5, 8, 5, false),
 (7, 3, 100, 1, '2026-10-02', 'COM', 2, 8, 10, 5.6, false),
 (7, 4, 100, 1, '2026-10-03', 'PDV', -5, 5.6, 5, 5.6, false),
 (7, 5, 100, 1, '2026-10-04', 'AJU', -1, 5.6, 4, 5.6, false),
 (7, 6, 100, 1, '2026-10-02', 'PDV', -100, 5, -90, 5, true),
 -- produto 200 (local 2): primeiro movimento dentro do período (entrada da OP) e venda
 (7, 7, 200, 2, '2026-10-02', 'OPE', 4, 3, 4, 3, false),
 (7, 8, 200, 2, '2026-10-03', 'PDV', -1, 3, 3, 3, false),
 -- produto 300: consumo da OP (CPV)
 (7, 9, 300, 1, '2026-09-29', 'COM', 5, 4, 5, 4, false),
 (7, 10, 300, 1, '2026-10-02', 'OPS', -2, 4, 3, 4, false),
 -- produto 400: parado desde antes do período
 (7, 11, 400, 1, '2026-09-15', 'COM', 3, 2, 3, 2, false),
 -- produto 500: ajuste de entrada sem custo
 (7, 12, 500, 1, '2026-10-01', 'AJU', 1, null, 1, null, false),
 -- produto 600: devolução de venda (entrada) reduz o CMV
 (7, 13, 600, 1, '2026-09-20', 'COM', 10, 2, 10, 2, false),
 (7, 14, 600, 1, '2026-10-01', 'VEN', -4, 2, 6, 2, false),
 (7, 15, 600, 1, '2026-10-02', 'DVP', 1, 2, 7, 2, false);

do $$
declare r record; n int;
begin
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 100;
  if r.ei <> 50 or r.compras <> 16 or r.vendas <> 38 or r.qtd_vendida <> 7 or r.ef <> 28 or r.outras_saidas <> 0 then
    raise exception 'produto 100: %', row_to_json(r); end if;
  if r.ei + r.compras + r.producao - r.ef <> r.vendas + r.consumo_op + r.outras_saidas - r.outras_entradas then
    raise exception 'produto 100: EI + C + P - EF diferente das saídas: %', row_to_json(r); end if;
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 200;
  if r.ei <> 0 or r.producao <> 12 or r.vendas <> 3 or r.ef <> 9 then raise exception 'produto 200: %', row_to_json(r); end if;
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 300;
  if r.ei <> 20 or r.consumo_op <> 8 or r.ef <> 12 or r.vendas <> 0 then raise exception 'produto 300: %', row_to_json(r); end if;
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 400;
  if r.ei <> 6 or r.ef <> 6 or r.vendas <> 0 then raise exception 'produto 400: %', row_to_json(r); end if;
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 500;
  if r.sem_custo <> 1 or r.outras_entradas <> 0 then raise exception 'produto 500: %', row_to_json(r); end if;
  select * into r from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03') where n_cod_prod = 600;
  if r.vendas <> 6 or r.qtd_vendida <> 3 or r.ei <> 20 or r.ef <> 14 then raise exception 'produto 600: %', row_to_json(r); end if;
  -- outra loja não aparece; ordem total por produto
  select count(*) into n from relatorio_cmv_kardex(8, '2026-10-01', '2026-10-03');
  if n <> 0 then raise exception 'loja 8 devia vir vazia, veio %', n; end if;
  select count(*) into n from relatorio_cmv_kardex(7, '2026-10-01', '2026-10-03');
  if n <> 6 then raise exception 'esperava 6 produtos, veio %', n; end if;
  raise notice 'relatorio_cmv_kardex OK';
end $$;
rollback;
