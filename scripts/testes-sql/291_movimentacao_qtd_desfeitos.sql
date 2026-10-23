-- Teste da migration 291 (Movimentação em quantidade: unidade e lançamentos desfeitos). Banco local (ex.: p29), da raiz
-- do repo: psql -d p29 -f scripts/testes-sql/291_movimentacao_qtd_desfeitos.sql (rerodável; dados sintéticos desfeitos).
set client_min_messages = notice;
\set ON_ERROR_STOP 1
\i supabase/migrations/291_movimentacao_qtd_desfeitos.sql

begin;
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, valor_unitario)
values (5, -991001, 'T291A', 'Teste linguiça', 'KG', '00', 0), (5, -991002, 'T291B', 'Teste farinha', 'KG', '01', 0),
       (5, -991003, 'T291C', 'Teste leite', 'ML', '01', 0);
-- linguiça: 30 dias normais (~10 kg) + contagem errada 2.720.000 em 30/05 desfeita em 31/05
insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
select 5, -991001, 'T291A', 'Teste linguiça', date '2026-04-01' + g, case when g % 7 = 0 then 10 else 0 end, case when g % 7 = 3 then 9 else 0 end
from generate_series(0, 50) g;
insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
values (5, -991001, 'T291A', 'Teste linguiça', '2026-05-30', 2719998, 0), (5, -991001, 'T291A', 'Teste linguiça', '2026-05-31', 0, 2720000);
-- farinha: compra grande legítima de 500 kg SEM saída igual depois (não é par)
insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
select 5, -991002, 'T291B', 'Teste farinha', date '2026-04-01' + g, case when g = 20 then 500 else 0 end, 2 from generate_series(0, 50) g;
-- leite em ml: volume alto todo dia (não é erro)
insert into movimentos_historico (loja_id, cod_prod, codigo, descricao, data, entradas, saidas)
select 5, -991003, 'T291C', 'Teste leite', date '2026-04-01' + g, case when g % 5 = 0 then 120000 else 0 end, 25000 from generate_series(0, 60) g;
do $$
declare j jsonb; n int;
begin
  j := relatorio_movimentacao_qtd_extras(5, '2026-04-01', '2026-06-30');
  select count(*) into n from jsonb_array_elements(j->'desfeitos') e where (e->>'cod_prod')::bigint in (-991001, -991002, -991003);
  if n <> 1 then raise exception '291: esperado 1 par (linguiça), veio %: %', n, j->'desfeitos'; end if;
  select count(*) into n from jsonb_array_elements(j->'desfeitos') e
   where (e->>'cod_prod')::bigint = -991001 and e->>'data_entrada' = '2026-05-30' and e->>'data_saida' = '2026-05-31'
     and (e->>'quantidade_saida')::numeric = 2720000 and e->>'unidade' = 'KG';
  if n <> 1 then raise exception '291: par da linguiça errado: %', j->'desfeitos'; end if;
  select count(*) into n from jsonb_array_elements(j->'unidades') e where e->>'descricao' = 'Teste leite' and e->>'unidade' = 'ML';
  if n <> 1 then raise exception '291: unidade do leite não veio'; end if;
  -- período que só pega a saída do par: o par aparece (a tela tira só o lado dentro do período)
  j := relatorio_movimentacao_qtd_extras(5, '2026-05-31', '2026-06-30');
  select count(*) into n from jsonb_array_elements(j->'desfeitos') e where (e->>'cod_prod')::bigint = -991001;
  if n <> 1 then raise exception '291: par com só a saída no período não veio'; end if;
  raise notice '291: ok';
end $$;
rollback;
\echo '291: OK'
