-- Teste da migration 290 (custo fora do normal no CMV e na Movimentação "valor do movimento"). Banco local com o kardex
-- e as fotos REAIS da loja 5 e as migrations 280–284 aplicadas (ex.: `create database p29 template d6` + 280–284), da
-- raiz do repo: psql -d p29 -f scripts/testes-sql/290_cmv_custo_fora_do_normal.sql (rerodável).
-- (1) produto sem nenhum movimento trocado: CMV por produto idêntico à 282 (todas as colunas antigas);
-- (2) as colunas _omie de TODO produto = o valor da 282 (o cru continua disponível);
-- (3) sintético: saída a R$ 100 milhões vira quantidade × mediana; prato vendido acima de 2× o preço sem referência
--     confiável vira 0 e conta em sem_referencia; ml a R$ 49,75 vira 0; compra nunca é trocada;
-- (4) Movimentação: valor_omie = valor da 188 e valor = valor_omie onde ajustados = 0.
set client_min_messages = notice;
\set ON_ERROR_STOP 1

set client_min_messages = warning;
-- volta ao estado de antes da 290 (rerodável): 282 e 188 recriam as funções com as colunas antigas
drop function if exists relatorio_cmv_kardex_json(bigint, date, date);
drop function if exists relatorio_cmv_kardex(bigint, date, date);
drop function if exists relatorio_movimentacao_valor_mov_json(bigint, date, date);
drop function if exists relatorio_movimentacao_valor_mov(bigint, date, date);
\i supabase/migrations/282_cmv_estoque_todos_produtos.sql
\i supabase/migrations/188_movimentacao_valor_movimento.sql
set client_min_messages = notice;
drop table if exists t290_antes, t290_mov_antes;
create table t290_antes as
select 'set'::text as caso, * from relatorio_cmv_kardex(5, '2026-09-01', '2026-09-30')
union all select '01-16/10', * from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16');
create table t290_mov_antes as select * from relatorio_movimentacao_valor_mov(5, '2026-09-12', '2026-10-16');

\i supabase/migrations/290_cmv_custo_fora_do_normal.sql

drop table if exists t290_depois, t290_mov_depois;
create table t290_depois as
select 'set'::text as caso, * from relatorio_cmv_kardex(5, '2026-09-01', '2026-09-30')
union all select '01-16/10', * from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16');
create table t290_mov_depois as select * from relatorio_movimentacao_valor_mov(5, '2026-09-12', '2026-10-16');

do $$
declare d int; r record;
begin
  select count(*) into d from t290_antes a full join t290_depois n using (caso, n_cod_prod) where a.n_cod_prod is null or n.n_cod_prod is null;
  if d <> 0 then raise exception '290: % produtos entraram/saíram', d; end if;
  -- (1) sem troca = igual
  select count(*) into d from t290_antes a join t290_depois n using (caso, n_cod_prod)
   where n.ajustados = 0 and n.ajustados_estoque = 0 and (a.ei, a.compras, a.producao, a.outras_entradas, a.vendas, a.qtd_vendida, a.consumo_op, a.outras_saidas, a.ef, a.sem_custo, a.quebra)
         is distinct from (n.ei, n.compras, n.producao, n.outras_entradas, n.vendas, n.qtd_vendida, n.consumo_op, n.outras_saidas, n.ef, n.sem_custo, n.quebra);
  if d <> 0 then raise exception '290: % produtos sem troca mudaram', d; end if;
  -- (2) colunas _omie = 282
  select count(*) into d from t290_antes a join t290_depois n using (caso, n_cod_prod)
   where (a.vendas, a.consumo_op, a.producao, a.ef) is distinct from (n.vendas_omie, n.consumo_op_omie, n.producao_omie, n.ef_omie)
      or abs(a.ei - n.ei_omie) > 0.01;
  if d <> 0 then raise exception '290: % produtos com valor cru do Omie diferente da 282', d; end if;
  -- saldo que vem da foto (produto sem kardex) já está valorizado pela regra da Posição: nunca trocado de novo
  select count(*) into d from t290_depois n
   where n.ajustados_estoque > 0 and not exists (select 1 from kardex_omie k where k.loja_id = 5 and k.n_cod_prod = n.n_cod_prod);
  if d <> 0 then raise exception '290: % produtos só com foto tiveram o estoque trocado de novo', d; end if;
  -- compras e quantidades nunca mudam
  select count(*) into d from t290_antes a join t290_depois n using (caso, n_cod_prod) where (a.compras, a.qtd_vendida, a.quebra) is distinct from (n.compras, n.qtd_vendida, n.quebra);
  if d <> 0 then raise exception '290: % produtos com compras/quantidade/quebra mudadas', d; end if;
  for r in select caso, count(*) filter (where ajustados > 0) prods, sum(ajustados) movs, sum(vendas_omie) vo, sum(vendas) v, sum(consumo_op_omie) co, sum(consumo_op) c
           from t290_depois group by 1 order by 1 loop
    raise notice '290: % — % produtos / % movimentos trocados; vendas % → %; consumo % → %', r.caso, r.prods, r.movs, r.vo, r.v, r.co, r.c;
  end loop;
  -- (4) movimentação
  select count(*) into d from t290_mov_antes a full join t290_mov_depois n using (origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario)
   where a.origem is null or n.origem is null or a.qtde <> n.qtde or a.valor <> n.valor_omie or a.sem_custo <> n.sem_custo
      or (n.ajustados = 0 and n.valor <> n.valor_omie);
  if d <> 0 then raise exception '290: % linhas da movimentação diferentes da 188', d; end if;
  select count(*) into d from t290_mov_depois where ajustados > 0 and origem ilike '%compra%';
  if d <> 0 then raise exception '290: compra trocada na movimentação (% linhas)', d; end if;
end $$;

-- (3) sintético (desfeito no fim)
begin;
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, valor_unitario)
values (5, -990001, 'T290A', 'Teste suco', 'UN', '04', 28.90),
       (5, -990002, 'T290B', 'Teste soda', 'UN', '04', 14.90),
       (5, -990003, 'T290C', 'Teste xarope', 'ML', '01', 0),
       (5, -990004, 'T290D', 'Teste cortesia', 'UN', '04', 0.01),   -- preço simbólico: o teto do preço não vale
       (5, -990005, 'T290E', 'Teste cabo', 'ML', '99', 0),          -- ML de tipo 99 = metro: sem teto de unidade
       (5, -990006, 'T290F', 'Teste whisky', 'ML', '01', 0);        -- R$ 3,38/ml: dentro da escala (≤ R$ 5/ml)
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, quantidade, valor_unit, cmc_apos, saldo_apos, cancelado)
select 5, -99000 - g, -990001, 1, date '2026-10-01' + (g % 10), 'OPE', 1, 8.2, 8.2, 1, false from generate_series(1, 20) g;
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, quantidade, valor_unit, cmc_apos, saldo_apos, cancelado)
values (5, -99101, -990001, 1, '2026-10-12', 'PDV', -1, 8.2, 8.2, 0, false),
       (5, -99102, -990001, 1, '2026-10-13', 'PDV', -2, 100000000, 100000000, -2, false),  -- 100 milhões → mediana 8,2
       (5, -99201, -990002, 1, '2026-10-10', 'OPE', 1, 2488, 2488, 1, false),
       (5, -99202, -990002, 1, '2026-10-10', 'PDV', -1, 2488, 2488, 0, false),             -- > 2 × 14,90 e mediana também: 0
       (5, -99301, -990003, 1, '2026-10-05', 'COM', 700, 49.75, 49.75, 700, false),        -- compra: nunca trocada
       (5, -99302, -990003, 1, '2026-10-06', 'OPS', -50, 49.75, 49.75, 650, false),        -- ml a 49,75 > R$ 5/ml: 0
       (5, -99401, -990004, 1, '2026-10-06', 'OPE', 1, 12, 12, 1, false),
       (5, -99402, -990004, 1, '2026-10-07', 'PDV', -1, 12, 12, 0, false),                 -- cortesia: custo 12 fica
       (5, -99501, -990005, 1, '2026-10-06', 'OPS', -10, 16, 16, 90, false),               -- cabo R$ 16/m fica
       (5, -99601, -990006, 1, '2026-10-06', 'OPS', -50, 3.38, 3.38, 700, false);          -- whisky 3,38/ml fica
do $$
declare r record;
begin
  select * into r from custo_referencia_produto(5, '2026-10-16') where n_cod_prod = -990001;
  if r.referencia <> 8.2 or r.limite <> 57.8 then raise exception '290: referência do suco % limite %', r.referencia, r.limite; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990001;
  if r.vendas <> 24.6 or r.vendas_omie <> 200000008.2 or r.ajustados < 1 or r.sem_referencia <> 0 then
    raise exception '290: suco vendas % (omie %), ajustados %, sem ref %', r.vendas, r.vendas_omie, r.ajustados, r.sem_referencia; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990002;
  if r.vendas <> 0 or r.producao <> 0 or r.vendas_omie <> 2488 or r.sem_referencia < 2 then
    raise exception '290: soda vendas % produção % (omie %), sem ref %', r.vendas, r.producao, r.vendas_omie, r.sem_referencia; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990003;
  if r.compras <> 34825 or r.consumo_op <> 0 or r.consumo_op_omie <> 2487.5 then
    raise exception '290: xarope compras % consumo % (omie %)', r.compras, r.consumo_op, r.consumo_op_omie; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990004;
  if r.vendas <> 12 or r.ajustados <> 0 then raise exception '290: cortesia zerada (vendas % ajustados %)', r.vendas, r.ajustados; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990005;
  if r.consumo_op <> 160 or r.ajustados <> 0 then raise exception '290: cabo em metro trocado (%)', r.consumo_op; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990006;
  if r.consumo_op <> 169 or r.ajustados <> 0 then raise exception '290: whisky trocado (%)', r.consumo_op; end if;
  if teto_custo_unidade('ml', '01') <> 5 or teto_custo_unidade('ML', '08') is not null or teto_custo_unidade('KGS', null) <> 2000
     or teto_custo_unidade('UN', '04') is not null then raise exception '290: teto_custo_unidade errado'; end if;
  -- a versão em uma chamada (jsonb) devolve o mesmo que a função em tabela
  if (select count(*) from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16')) <> jsonb_array_length(relatorio_cmv_kardex_json(5, '2026-10-01', '2026-10-16'))
     or (select count(*) from relatorio_movimentacao_valor_mov(5, '2026-10-01', '2026-10-16')) <> jsonb_array_length(relatorio_movimentacao_valor_mov_json(5, '2026-10-01', '2026-10-16'))
  then raise exception '290: versão json com contagem diferente'; end if;
  -- filtro por produto da referência = o mesmo da lista inteira
  if (select count(*) from custo_referencia_produto(5, '2026-10-16', array[-990001, -990002]::bigint[])) <> 2
     or (select limite from custo_referencia_produto(5, '2026-10-16', array[-990001]::bigint[])) <> (select limite from custo_referencia_produto(5, '2026-10-16') where n_cod_prod = -990001)
  then raise exception '290: filtro de produtos da referência'; end if;
  select sum(valor) v, sum(valor_omie) vo, sum(ajustados) a into r from relatorio_movimentacao_valor_mov(5, '2026-10-01', '2026-10-16') where n_cod_prod = -990001 and sentido = 'S';
  if r.v <> 24.6 or r.vo <> 200000008.2 or r.a <> 1 then raise exception '290: movimentação do suco % / % / %', r.v, r.vo, r.a; end if;
  raise notice '290: sintético ok';
end $$;
rollback;

drop table if exists t290_antes, t290_depois, t290_mov_antes, t290_mov_depois;
\echo '290: OK'
