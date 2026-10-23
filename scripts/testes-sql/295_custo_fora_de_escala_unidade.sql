-- Teste da migration 295 (custo fora da escala da unidade em posicao_valorizada). Banco local com as fotos REAIS da loja 5
-- e as migrations 280–284 aplicadas (ex.: `create database p29 template d6` + scripts/testes-sql/280…284), da raiz do
-- repo: psql -d p29 -f scripts/testes-sql/295_custo_fora_de_escala_unidade.sql (rerodável).
-- (1) linhas que não são g/ml/kg/l nem fora da escala: valor igual ao da 282 (nada muda nelas);
-- (2) sintéticos: café em g (custo do quilo), Monin 700 ml com nota sem conversão, manteiga com outro local bom, cabo em
--     ML tipo 99 (metro linear, fica), molho em L > 2.000 sem referência (vale 0), whisky 3,38/ml (fica).
set client_min_messages = notice;
\set ON_ERROR_STOP 1

-- guarda a saída da 282 (função de antes)
drop table if exists _pv282;
create temp table _pv282 as select * from posicao_valorizada(5);

\i supabase/migrations/295_custo_fora_de_escala_unidade.sql

do $$
declare d int; dv numeric; r record;
begin
  -- (1) produtos com unidade fora de g/ml/kg/l: linha a linha igual à 282
  select count(*), coalesce(sum(abs(n.valor - o.valor)), 0) into d, dv
  from posicao_valorizada(5) n
  join _pv282 o using (n_cod_prod, codigo_local_estoque)
  left join produtos p on p.loja_id = 5 and p.codigo_produto = n.n_cod_prod
  where upper(btrim(coalesce(p.unidade, ''))) not in ('G', 'GR', 'GRS', 'GRAMA', 'GRAMAS', 'ML', 'KG', 'KGS', 'L', 'LT', 'LTS', 'LITRO')
    and (n.valor is distinct from o.valor or n.suspeito is distinct from o.suspeito);
  raise notice '295: linhas de outras unidades que mudaram: % (Σ |dif| %)', d, dv;
  if d <> 0 then raise exception '295: mudou linha que não é de g/ml/kg/l'; end if;
  -- e as de g/ml/kg/l com custo dentro da escala também não mudam
  select count(*) into d
  from posicao_valorizada(5) n join _pv282 o using (n_cod_prod, codigo_local_estoque)
  where not n.suspeito and not o.suspeito and n.valor <> o.valor;
  if d <> 0 then raise exception '295: % linhas não suspeitas mudaram de valor', d; end if;
end $$;

begin;
set local session_replication_role = replica;
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, valor_unitario) values
  (5, -929501, 'T01', 'TESTE CAFE SOLUVEL (MP)', 'G', '01', 0),
  (5, -929502, 'T02', 'TESTE MONIN MARACUJA 700ML (MP)', 'ML', '01', 0),
  (5, -929503, 'T03', 'TESTE MANTEIGA C/ SAL', 'G', '01', 26.90),
  (5, -929504, 'T04', 'TESTE CABO 10,0MM', 'ML', '99', 0),
  (5, -929505, 'T05', 'TESTE MOLHO DE LEGUMES (PI)', 'L', '03', 0),
  (5, -929506, 'T06', 'TESTE WHISKY (MP)', 'ML', '01', 0),
  (5, -929507, 'T07', 'TESTE SUCO 1,5L', 'ML', '01', 0);
insert into notas_fiscais (id, loja_id, n_id_receb, c_etapa, c_numero_nfe, d_emissao_nfe, full_object)
values (-929501, 5, 'r-929501', '60', '1', '2026-06-16', '{}');
-- Monin: entrou 2 GF a 49,75 "por ml" (sem conversão) — a referência da nota também está fora da escala e não serve
insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_produto, n_qtde_nfe, n_preco_unit, full_object)
values (5, -929501, 'r-929501', 1, -929502, 2, 49.75, '{"itensCabec": {"vTotalItem": 99.5}, "itensCustoEstoque": {"cICMSCusto": "N"}, "itensAjustes": {"nQtdeRecebida": 2, "cUnidade": "GF"}}');
insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, n_cmc)
select 5, l, p, (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0), s, c
from (values
  (1, -929501, 1000.0, 99.716),          -- café: 1 quilo a 99,716 "por grama" → ÷ 1000 = 99,72
  (1, -929502, 550.0, 49.75),            -- Monin 700 ml → ÷ 700 = 39,09
  (1, -929503, 1.0, 26.90),              -- manteiga: 1 g a 26,90 num local, 2.000 g a 0,0265 no outro → referência 0,0265
  (2, -929503, 2000.0, 0.0265),
  (1, -929504, 20.0, 16.318),            -- cabo em metro linear: fica
  (1, -929505, 1.0, 6241.308867),        -- molho em L > 2.000 sem referência: vale 0
  (1, -929506, 760.0, 3.379347),         -- whisky 3,38/ml: dentro da escala, fica
  (1, -929507, 100.0, 9.0)               -- "1,5L" na descrição de produto em ml → ÷ 1500
) v(l, p, s, c);
do $$
declare r record;
begin
  select * into r from posicao_valorizada(5) where n_cod_prod = -929501;
  if not r.suspeito or r.fonte_referencia <> 'unidade' or r.cmc_usado <> 0.099716 or r.valor <> 99.72 or r.valor_omie <> 99716 then raise exception '295: café %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929502;
  if not r.suspeito or r.fonte_referencia <> 'unidade' or r.referencia <> 0.071071 or r.valor <> 39.09 then raise exception '295: Monin %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929503 and codigo_local_estoque = 1;
  if not r.suspeito or r.fonte_referencia <> 'locais' or r.referencia <> 0.0265 or r.valor <> 0.03 then raise exception '295: manteiga local ruim %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929503 and codigo_local_estoque = 2;
  if r.suspeito or r.valor <> 53 then raise exception '295: manteiga local bom %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929504;
  if r.suspeito or r.valor <> 326.36 then raise exception '295: cabo em metro linear virou suspeito %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929505;
  if not r.suspeito or r.valor <> 0 or r.fonte_referencia is not null then raise exception '295: molho em L %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929506;
  if r.suspeito or r.valor <> 2568.30 then raise exception '295: whisky %', row_to_json(r); end if;
  select * into r from posicao_valorizada(5) where n_cod_prod = -929507;
  if not r.suspeito or r.cmc_usado <> 0.006 or r.valor <> 0.60 then raise exception '295: 1,5L %', row_to_json(r); end if;
  raise notice '295: sintéticos OK';
end $$;
rollback;

-- as RPCs do Estoque Valorizado (283) continuam fechando com posicao_valorizada
do $$
declare tv numeric; tp numeric; tl numeric;
begin
  select sum(valor) into tv from posicao_valorizada(5);
  select sum(valor_total) into tp from relatorio_estoque_valorizado(5);
  select sum(valor_total) into tl from relatorio_estoque_valorizado_local(5);
  raise notice '295: valorizada 282 % → 295 % (por produto %, por local %)', (select sum(valor) from _pv282), tv, tp, tl;
  if tp <> tv or tl <> tv then raise exception '295: totais diferentes'; end if;
end $$;
\echo 295 OK
