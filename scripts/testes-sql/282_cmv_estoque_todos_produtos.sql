-- Teste da migration 282 (CMV: EI/EF de todos os produtos). Banco local com o kardex e as fotos REAIS da loja 5
-- (ex.: `create database p28 template d6`), da raiz do repo: psql -d p28 -f scripts/testes-sql/282_cmv_estoque_todos_produtos.sql
-- (1) CMV por produto (EI + C + P − EF, vendas, consumo, quebra) igual à 187 para todo produto que a 187 devolvia;
-- (2) produto sem kardex entra com EI = EF = foto de posicao_estoques (locais reais) e fórmula 0;
-- (3) produto × local com o 1º movimento depois da data: saldo e CMC de antes do movimento (entrada e saída, sintético).
set client_min_messages = notice;
\set ON_ERROR_STOP 1

set client_min_messages = warning;
\i supabase/migrations/187_relatorio_cmv_kardex.sql
set client_min_messages = notice;
drop table if exists t282_antes;
create table t282_antes as
select '17/10'::text as caso, * from relatorio_cmv_kardex(5, '2026-10-17', '2026-10-17')
union all select 'set', * from relatorio_cmv_kardex(5, '2026-09-01', '2026-09-30')
union all select '01-16/10', * from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16');

\i supabase/migrations/282_cmv_estoque_todos_produtos.sql

drop table if exists t282_depois;
create table t282_depois as
select '17/10'::text as caso, * from relatorio_cmv_kardex(5, '2026-10-17', '2026-10-17')
union all select 'set', * from relatorio_cmv_kardex(5, '2026-09-01', '2026-09-30')
union all select '01-16/10', * from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-16');

do $$
declare d int; novos int; r record; v numeric;
begin
  -- (1) quem já saía: fluxo e quebra iguais; EI e EF só ganham o mesmo valor (outro local do produto sem kardex ou
  --     com o 1º movimento depois), então a fórmula EI + C + P − EF não muda (até 0,01 do arredondamento por produto)
  select count(*) into d from t282_antes a join t282_depois n using (caso, n_cod_prod)
   where (a.compras, a.producao, a.outras_entradas, a.vendas, a.qtd_vendida, a.consumo_op, a.outras_saidas, a.sem_custo, a.quebra)
         is distinct from (n.compras, n.producao, n.outras_entradas, n.vendas, n.qtd_vendida, n.consumo_op, n.outras_saidas, n.sem_custo, n.quebra)
      or abs((n.ei + n.compras + n.producao - n.ef) - (a.ei + a.compras + a.producao - a.ef)) > 0.01;
  if d <> 0 then raise exception '282: % linhas que a 187 já devolvia mudaram de CMV/fluxo', d; end if;
  select count(*) into d from t282_antes a join t282_depois n using (caso, n_cod_prod) where (a.ei, a.ef) is distinct from (n.ei, n.ef);
  raise notice '282: % linhas antigas ganharam EI/EF de outro local (fórmula igual)', d;
  select count(*) into d from t282_antes a left join t282_depois n using (caso, n_cod_prod) where n.n_cod_prod is null;
  if d <> 0 then raise exception '282: % produtos sumiram', d; end if;
  -- (2) os novos: sem fluxo no período, EI = EF, fórmula 0
  select count(*) into novos from t282_depois n left join t282_antes a using (caso, n_cod_prod) where a.n_cod_prod is null;
  select count(*) into d from t282_depois n left join t282_antes a using (caso, n_cod_prod)
   where a.n_cod_prod is null and (n.ei <> n.ef or n.compras <> 0 or n.producao <> 0 or n.vendas <> 0 or n.consumo_op <> 0 or n.quebra <> 0);
  if d <> 0 then raise exception '282: % produtos novos com movimento/EI <> EF', d; end if;
  if novos = 0 then raise exception '282: nenhum produto novo (banco sem posicao_estoques da loja 5?)'; end if;
  raise notice '282: % linhas novas (produto × caso) com EI = EF e fórmula 0', novos;
  for r in select caso, sum(ei) ei, sum(ef) ef from t282_depois group by 1 order by 1 loop
    raise notice '282: % EI % EF %', r.caso, r.ei, r.ef;
  end loop;
  -- o EI de 17/10 dos produtos sem kardex = foto mais recente (locais reais, CMC válido)
  select count(*) into d from (
    select pe.n_cod_prod, round(sum(pe.n_saldo * case when pe.n_cmc > 0 and pe.n_cmc < 1e7 then pe.n_cmc else 0 end), 2) as v
    from posicao_estoques pe
    where pe.loja_id = 5 and pe.codigo_local_estoque <> 0
      and pe.data_posicao = (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0)
      and not exists (select 1 from kardex_omie k where k.loja_id = 5 and k.n_cod_prod = pe.n_cod_prod)
    group by 1 having round(sum(pe.n_saldo * case when pe.n_cmc > 0 and pe.n_cmc < 1e7 then pe.n_cmc else 0 end), 2) <> 0
  ) f left join t282_depois n on n.caso = '17/10' and n.n_cod_prod = f.n_cod_prod
  where n.ei is distinct from f.v;
  if d <> 0 then raise exception '282: % produtos sem kardex com EI diferente da foto', d; end if;
end $$;

-- (3) sintético: 1º movimento depois da data (desfeito no fim)
begin;
insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, quantidade, valor_unit, cmc_apos, saldo_apos, cancelado)
values (5, -9001, -900001, 1, '2026-10-10', 'COM', 10, 7, 6, 20, false),   -- entrada: antes 10 × 5 (= (20·6 − 10·7) ÷ 10)
       (5, -9002, -900001, 1, '2026-10-12', 'PDV', -4, 6, 6, 16, false),
       (5, -9003, -900002, 1, '2026-10-10', 'PDV', -3, 4, 4, 7, false),    -- saída: antes 10 × 4
       (5, -9004, -900003, 1, '2026-10-10', 'PDV', -1, 2, 2, 4, false),    -- cadeia do dia fora de ordem de id: começa no -9005
       (5, -9005, -900003, 1, '2026-10-10', 'PDV', -1, 2, 2, 5, false);
do $$
declare r record;
begin
  select * into r from saldo_em_data_completo(5, '2026-10-05') where n_cod_prod = -900001;
  if r.fonte <> 'antes_do_kardex' or r.saldo <> 10 or r.cmc <> 5 then raise exception '282: entrada antes do kardex deu % × % (%)', r.saldo, r.cmc, r.fonte; end if;
  select * into r from saldo_em_data_completo(5, '2026-10-05') where n_cod_prod = -900002;
  if r.saldo <> 10 or r.cmc <> 4 then raise exception '282: saída antes do kardex deu % × %', r.saldo, r.cmc; end if;
  select * into r from saldo_em_data_completo(5, '2026-10-05') where n_cod_prod = -900003;
  if r.saldo <> 6 then raise exception '282: começo da cadeia do dia deu % (esperado 6)', r.saldo; end if;
  select * into r from saldo_em_data_completo(5, '2026-10-11') where n_cod_prod = -900001;
  if r.fonte <> 'kardex' or r.saldo <> 20 then raise exception '282: depois do movimento deveria ser o kardex (% %)', r.fonte, r.saldo; end if;
  -- CMV de 01–05/10: EI = EF = 50, fórmula 0; CMV de 01–12/10: EI = 50 (kardex até a véspera não existe → EF − fluxo, igual à 187)
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-05') where n_cod_prod = -900001;
  if r.ei <> 50 or r.ef <> 50 then raise exception '282: CMV sem movimento deu EI % EF %', r.ei, r.ef; end if;
  select * into r from relatorio_cmv_kardex(5, '2026-10-01', '2026-10-12') where n_cod_prod = -900001;
  if r.ei <> 50 or r.ef <> 96 or r.compras <> 70 or r.vendas <> 24 then raise exception '282: CMV com movimento deu EI % EF % C % V %', r.ei, r.ef, r.compras, r.vendas; end if;
  raise notice '282: sintéticos OK';
end $$;
rollback;

drop table t282_antes, t282_depois;
\echo 282 OK
