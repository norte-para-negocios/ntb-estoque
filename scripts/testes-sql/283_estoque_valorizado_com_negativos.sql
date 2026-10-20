-- Teste da migration 283 (Estoque Valorizado soma negativos, um total só com a Posição). Banco local com
-- posicao_estoques REAL da loja 5 (ex.: `create database p28 template d6`), da raiz do repo:
--   psql -d p28 -f scripts/testes-sql/283_estoque_valorizado_com_negativos.sql
set client_min_messages = notice;
\set ON_ERROR_STOP 1
\i supabase/migrations/283_estoque_valorizado_com_negativos.sql

do $$
declare tp numeric; tl numeric; tposicao numeric; neg numeric; d int; r record; f date;
begin
  select max(data_posicao) into f from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0;
  -- total da tela de Posição (lib/relatorios/posicao-estoque-puro.ts: por local, CMC fora de (0,1e7) = 0, sentinela fora)
  select sum(round(n_saldo * case when n_cmc > 0 and n_cmc < 1e7 then n_cmc else 0 end, 2)),
         sum(round(n_saldo * case when n_cmc > 0 and n_cmc < 1e7 then n_cmc else 0 end, 2)) filter (where n_saldo < 0)
    into tposicao, neg
  from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0 and data_posicao = f;
  select sum(valor_total) into tp from relatorio_estoque_valorizado(5);
  select sum(valor_total) into tl from relatorio_estoque_valorizado_local(5);
  raise notice '283: foto %, Posição %, valorizado por produto %, por local %, negativos %', f, tposicao, tp, tl, neg;
  if tp <> tposicao or tl <> tposicao then raise exception '283: totais diferentes da Posição'; end if;
  if neg >= 0 then raise exception '283: a foto da loja 5 deveria ter saldo negativo'; end if;
  select count(*) into d from relatorio_estoque_valorizado_local(5) where n_saldo < 0;
  if d = 0 then raise exception '283: nenhuma linha negativa'; end if;
  select count(*) into d from relatorio_estoque_valorizado_local(5) where codigo_local_estoque = 0;
  if d <> 0 then raise exception '283: sentinela 0 apareceu'; end if;
  -- filtro de local: soma do local = soma das linhas desse local
  select codigo_local_estoque into r from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0 and data_posicao = f group by 1 order by count(*) desc limit 1;
  select count(*) into d from (
    select (select sum(valor_total) from relatorio_estoque_valorizado(5, p_local => array[r.codigo_local_estoque])) a,
           (select sum(valor_total) from relatorio_estoque_valorizado_local(5) where codigo_local_estoque = r.codigo_local_estoque) b) z
  where a is distinct from b;
  if d <> 0 then raise exception '283: filtro de local não fecha'; end if;
end $$;

-- sintético: negativo, CMC suspeito e produto sem cadastro (desfeito no fim)
begin;
insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, n_cmc)
select 5, l, p, (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0), s, c
from (values (1, -900101, -2.0, 10.0), (2, -900101, 5.0, 10.0), (1, -900102, 3.0, 2e9), (0, -900103, 0, 9.0), (1, -900103, 4.0, 1.5)) v(l, p, s, c);
do $$
declare r record;
begin
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900101;
  if r.n_saldo <> 3 or r.valor_total <> 30 or r.n_cmc <> 10 then raise exception '283: negativo + positivo deu % × % = %', r.n_saldo, r.n_cmc, r.valor_total; end if;
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900102;
  if r.valor_total <> 0 then raise exception '283: CMC suspeito deveria valer 0 (deu %)', r.valor_total; end if;
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900103;
  if r.valor_total <> 6 or r.descricao <> 'Produto -900103' then raise exception '283: sem cadastro / sentinela: % %', r.valor_total, r.descricao; end if;
  raise notice '283: sintéticos OK';
end $$;
rollback;
\echo 283 OK
