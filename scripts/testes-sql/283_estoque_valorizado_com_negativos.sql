-- Teste da migration 283 (Estoque Valorizado soma negativos, um total só com a Posição) e da regra do custo suspeito
-- (posicao_valorizada, 282). Banco local com posicao_estoques REAL da loja 5 (ex.: `create database p28 template d6`)
-- e a 282 aplicada, da raiz do repo: psql -d p28 -f scripts/testes-sql/283_estoque_valorizado_com_negativos.sql
set client_min_messages = notice;
\set ON_ERROR_STOP 1
\i supabase/migrations/283_estoque_valorizado_com_negativos.sql

do $$
declare tp numeric; tl numeric; tv numeric; tomie numeric; aj numeric; neg numeric; d int; r record;
begin
  -- um total só: as duas RPCs = soma de posicao_valorizada (o que a tela de Posição soma); total + ajuste = Omie cru
  select sum(valor), sum(valor_omie), sum(valor_omie - valor) filter (where suspeito), sum(valor) filter (where n_saldo < 0)
    into tv, tomie, aj, neg from posicao_valorizada(5);
  select sum(valor_total) into tp from relatorio_estoque_valorizado(5);
  select sum(valor_total) into tl from relatorio_estoque_valorizado_local(5);
  raise notice '283: valorizada %, por produto %, por local %, Omie cru %, ajuste %, negativos %', tv, tp, tl, tomie, coalesce(aj, 0), neg;
  if tp <> tv or tl <> tv then raise exception '283: totais diferentes de posicao_valorizada'; end if;
  if tv + coalesce(aj, 0) <> tomie then raise exception '283: total + ajuste <> Omie cru'; end if;
  if neg >= 0 then raise exception '283: a foto da loja 5 deveria ter saldo negativo'; end if;
  select count(*) into d from relatorio_estoque_valorizado_local(5) where codigo_local_estoque = 0;
  if d <> 0 then raise exception '283: sentinela 0 apareceu'; end if;
  -- filtro de local: soma do local = soma das linhas desse local
  select codigo_local_estoque into r from posicao_valorizada(5) group by 1 order by count(*) desc limit 1;
  select count(*) into d from (
    select (select sum(valor_total) from relatorio_estoque_valorizado(5, p_local => array[r.codigo_local_estoque])) a,
           (select sum(valor_total) from relatorio_estoque_valorizado_local(5) where codigo_local_estoque = r.codigo_local_estoque) b) z
  where a is distinct from b;
  if d <> 0 then raise exception '283: filtro de local não fecha'; end if;
end $$;

-- sintético (desfeito no fim): as quatro referências da regra
begin;
insert into produtos (loja_id, codigo_produto, codigo, descricao, valor_unitario)
values (5, -900110, 'T110', 'TESTE SEM REFERENCIA', 184.90), (5, -900111, 'T111', 'TESTE NADA', 0);
insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, n_cmc)
select 5, l, p, (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0), s, c
from (values
  (1, -900101, -2.0, 10.0), (2, -900101, 5.0, 10.0),                -- negativo + positivo, custo normal
  (1, -900102, 3.0, 2e9),                                            -- ≥ 1e7: sempre suspeito, sem referência → 0
  (0, -900103, 0, 9.0), (1, -900103, 4.0, 1.5),                      -- sentinela fora, produto sem cadastro
  (1, -900104, 100.0, 3.0), (2, -900104, -10.0, 40.0),               -- 40 > 10 × 3 (locais positivos) → −10 × 3
  (1, -900110, -29.0, 3649182.185099),                               -- sem custo de referência, 10× preço → 0
  (1, -900111, -2.0, 150000.0), (2, -900111, -2.0, 90000.0)          -- sem nada: > 100 mil em linha negativa → 0; 90 mil fica
) v(l, p, s, c);
do $$
declare r record;
begin
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900101;
  if r.n_saldo <> 3 or r.valor_total <> 30 or r.n_cmc <> 10 then raise exception '283: negativo + positivo deu % × % = %', r.n_saldo, r.n_cmc, r.valor_total; end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -900102;
  if not r.suspeito or r.valor <> 0 then raise exception '283: CMC ≥ 1e7 deveria ser suspeito e valer 0 (deu %)', r.valor; end if;
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900103;
  if r.valor_total <> 6 or r.descricao <> 'Produto -900103' then raise exception '283: sem cadastro / sentinela: % %', r.valor_total, r.descricao; end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -900104 and codigo_local_estoque = 2;
  if not r.suspeito or r.referencia <> 3 or r.valor <> -30 or r.valor_omie <> -400 then raise exception '283: referência dos locais positivos: %', row_to_json(r); end if;
  -- CMC do produto só dos locais positivos (como a Margem); o valor soma o negativo ajustado
  select * into r from relatorio_estoque_valorizado(5) where codigo_produto = -900104;
  if r.n_cmc <> 3 or r.valor_total <> 270 then raise exception '283: produto com local suspeito: CMC % valor %', r.n_cmc, r.valor_total; end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -900110;
  if not r.suspeito or r.valor <> 0 then raise exception '283: 10× o preço de venda: %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -900111 and codigo_local_estoque = 1;
  if not r.suspeito or r.valor <> 0 then raise exception '283: sem referência > 100 mil: %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -900111 and codigo_local_estoque = 2;
  if r.suspeito or r.valor <> -180000 then raise exception '283: 90 mil sem referência não é suspeito pela regra: %', row_to_json(r); end if;
  raise notice '283: sintéticos OK';
end $$;
rollback;

-- referência da última entrada (nota concluída): produto sem local positivo, entrada a 12,00 → linha a 147,87 é suspeita
begin;
set local session_replication_role = replica;
insert into notas_fiscais (id, loja_id, n_id_receb, c_etapa, c_numero_nfe, d_emissao_nfe, full_object)
values (-900201, 5, 'r-900201', '60', '1', '2026-10-01', '{}');
insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_produto, n_qtde_nfe, n_preco_unit, full_object)
values (5, -900201, 'r-900201', 1, -900120, 2, 12, '{"itensCabec": {"vTotalItem": 24}, "itensCustoEstoque": {"cICMSCusto": "N"}, "itensAjustes": {"nQtdeRecebida": 2}}');
insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, n_cmc)
values (5, 1, -900120, (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0), -1.152459, 147.866667);
do $$
declare r record;
begin
  select * into r from posicao_valorizada(5) where n_cod_prod = -900120;
  if not r.suspeito or r.fonte_referencia <> 'entrada' or r.referencia <> 12 or r.valor <> -13.83 then raise exception '283: referência da entrada: %', row_to_json(r); end if;
  raise notice '283: referência da última entrada OK (GENGIBRE da loja 3: −1,152459 × 147,87 → × 12,00)';
end $$;
rollback;
\echo 283 OK
