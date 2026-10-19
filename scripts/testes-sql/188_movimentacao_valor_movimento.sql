-- Teste de relatorio_movimentacao_valor_mov (migration 188). Cópia local, nunca em produção:
--   docker exec -i ntb-teste-sql psql -U postgres -d fd -v ON_ERROR_STOP=1 < scripts/testes-sql/188_movimentacao_valor_movimento.sql
-- Loja 11 = Omie (kardex), loja 12 = própria (ledger).
begin;
update lojas set modo_estoque = 'omie' where id = 11;
update lojas set modo_estoque = 'proprio' where id = 12;
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, quantidade, valor_unit, saldo_apos, cmc_apos, id_ajuste, cancelado) values
 (11, 1, 100, 1, '2026-10-01', 'COM', 'Compra de Produto', 10, 5, 10, 5, null, false),
 (11, 2, 100, 1, '2026-10-02', 'PDV', 'Movimento Gerado pelo PDV', -2, 5, 8, 5, null, false),
 (11, 3, 100, 1, '2026-10-03', 'PDV', 'Movimento Gerado pelo PDV', -1, 5, 7, 5, null, false),
 (11, 4, 100, 1, '2026-10-03', 'AJU', 'Movimento Manual de Estoque', -1, 5, 6, 5, 777, false),
 (11, 5, 100, 1, '2026-10-03', 'PDV', 'Movimento Gerado pelo PDV', -50, 5, -44, 5, null, true),
 (11, 6, 100, 1, '2026-11-01', 'PDV', 'Movimento Gerado pelo PDV', -1, 5, 5, 5, null, false),
 (11, 7, 200, 2, '2026-10-05', 'AJU', 'Movimento Manual de Estoque', 3, null, 3, null, null, false);
insert into movimentos (loja_id, codigo_local_estoque, id_prod, data, tipo, quan, valor, motivo, id_ajuste, status)
values (11, 1, 100, '2026-10-03', 'SAI', -1, 5, 'INV', 777, 'Concluido');
-- ledger da loja própria (as travas de imutabilidade só valem para update/delete)
insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, quantidade, custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, data_ref) values
 (12, 1, 300, 'ENT', 'COMPRA', 'nf1', 4, 2.5, 4, 4, 2.5, '2026-10-01'),
 (12, 1, 300, 'PRD', 'PRODUCAO', 'op1', -1, 2.5, 3, 3, 2.5, '2026-10-02'),
 (12, 1, 300, 'SAI', 'VENDA', 'v1', -2, 2.5, 1, 1, 2.5, '2026-10-02');

do $$
declare r record; n int;
begin
  select * into r from relatorio_movimentacao_valor_mov(11, '2026-10-01', '2026-10-31') where origem = 'Movimento Gerado pelo PDV';
  if r.sentido <> 'S' or r.qtde <> 3 or r.valor <> 15 or r.mes <> '2026-10' then raise exception 'PDV: %', row_to_json(r); end if;
  select * into r from relatorio_movimentacao_valor_mov(11, '2026-10-01', '2026-10-31') where origem = 'Compra de Produto';
  if r.sentido <> 'E' or r.valor <> 50 then raise exception 'compra: %', row_to_json(r); end if;
  select * into r from relatorio_movimentacao_valor_mov(11, '2026-10-01', '2026-10-31') where origem = 'Movimento Manual de Estoque' and sentido = 'S';
  if not r.inventario or r.valor <> 5 then raise exception 'ajuste de inventário: %', row_to_json(r); end if;
  select * into r from relatorio_movimentacao_valor_mov(11, '2026-10-01', '2026-10-31') where n_cod_prod = 200;
  if r.sem_custo <> 1 or r.valor <> 0 or r.inventario then raise exception 'sem custo: %', row_to_json(r); end if;
  select count(*) into n from relatorio_movimentacao_valor_mov(11, '2026-10-01', '2026-10-31');
  if n <> 4 then raise exception 'esperava 4 linhas na loja Omie, veio %', n; end if;
  -- loja própria lê o ledger (e não o kardex)
  select * into r from relatorio_movimentacao_valor_mov(12, '2026-10-01', '2026-10-31') where origem = 'Venda';
  if r.qtde <> 2 or r.valor <> 5 or r.sentido <> 'S' then raise exception 'venda própria: %', row_to_json(r); end if;
  select * into r from relatorio_movimentacao_valor_mov(12, '2026-10-01', '2026-10-31') where origem = 'Consumo da Ordem de Produção';
  if r.valor <> 2.5 then raise exception 'consumo próprio: %', row_to_json(r); end if;
  select count(*) into n from relatorio_movimentacao_valor_mov(12, '2026-10-01', '2026-10-31');
  if n <> 3 then raise exception 'esperava 3 linhas na loja própria, veio %', n; end if;
  raise notice 'relatorio_movimentacao_valor_mov OK';
end $$;
rollback;
