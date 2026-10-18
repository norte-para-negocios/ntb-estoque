-- 173: saldo_em_data / primeiro_mov_apos na ordem do Omie.
--
-- O Omie não ordena o kardex de um dia por id_mov: a ordem real é a cadeia de saldo (saldo antes do movimento =
-- saldo_apos − quantidade = saldo_apos do movimento anterior). As versões da 160/161 pegavam o maior/menor id_mov do dia
-- e erravam o saldo do fim do dia em 465 de 4.639 produto×local×dia com 2+ movimentos e cadeia definida (loja 5,
-- 13/08–16/10/2026; ex. 31/08, produto 2453421862: 2.504,5 em vez de 5.500). Evidência e script: omie-rea/regras
-- (E13) e lib/estoque/kardex-cadeia-puro.ts (mesma regra em TS, testada com as linhas reais).
--
-- Regra (por produto+local, no dia escolhido):
--   fim do dia  = o "saldo depois" que sobra quando cada saldo depois é casado com um "saldo antes" (multiconjunto);
--   início      = o "saldo antes" que sobra no casamento inverso.
--   Dia em ciclo (volta ao saldo de abertura) não tem sobra: cai no maior id_mov (fim) / menor id_mov (início), como antes.
-- Saldos comparados com 6 casas (precisão do Omie). Assinatura e permissões iguais às da 160/161.
-- Teste: scripts/testes-sql/173_saldo_em_data_cadeia.sql (cópia local, nunca em produção).

create or replace function public.saldo_em_data(p_loja_id bigint, p_data date)
returns table (n_cod_prod bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric, data_mov date, id_mov bigint)
language sql stable set search_path = public as $$
  with ult as (
    select k.n_cod_prod, k.codigo_local_estoque, max(k.data_mov) as d
    from kardex_omie k
    where k.loja_id = p_loja_id and k.data_mov <= p_data and not k.cancelado
    group by k.n_cod_prod, k.codigo_local_estoque
  ), dia as (
    select k.n_cod_prod, k.codigo_local_estoque, k.saldo_apos, k.cmc_apos, k.data_mov, k.id_mov, k.quantidade
    from kardex_omie k
    join ult u on u.n_cod_prod = k.n_cod_prod and u.codigo_local_estoque = k.codigo_local_estoque and u.d = k.data_mov
    where k.loja_id = p_loja_id and not k.cancelado
  ), depois as (
    select n_cod_prod, codigo_local_estoque, round(saldo_apos, 6) as v, count(*) as c from dia group by 1, 2, 3
  ), antes as (
    select n_cod_prod, codigo_local_estoque, round(saldo_apos - quantidade, 6) as v, count(*) as c from dia group by 1, 2, 3
  ), fim as (
    select d.n_cod_prod, d.codigo_local_estoque, min(d.v) as v
    from depois d
    left join antes a on a.n_cod_prod = d.n_cod_prod and a.codigo_local_estoque = d.codigo_local_estoque and a.v = d.v
    where d.c - coalesce(a.c, 0) = 1
    group by d.n_cod_prod, d.codigo_local_estoque
    having count(*) = 1
  )
  select distinct on (x.n_cod_prod, x.codigo_local_estoque)
         x.n_cod_prod, x.codigo_local_estoque, x.saldo_apos, x.cmc_apos, x.data_mov, x.id_mov
  from dia x
  left join fim f on f.n_cod_prod = x.n_cod_prod and f.codigo_local_estoque = x.codigo_local_estoque
  where f.v is null or round(x.saldo_apos, 6) = f.v
  order by x.n_cod_prod, x.codigo_local_estoque, x.id_mov desc
$$;
revoke all on function public.saldo_em_data(bigint, date) from public, anon;
grant execute on function public.saldo_em_data(bigint, date) to authenticated;

create or replace function public.primeiro_mov_apos(p_loja_id bigint, p_data date)
returns table (n_cod_prod bigint, codigo_local_estoque bigint, quantidade numeric, saldo_apos numeric, cmc_apos numeric, data_mov date)
language sql stable set search_path = public as $$
  with prim as (
    select k.n_cod_prod, k.codigo_local_estoque, min(k.data_mov) as d
    from kardex_omie k
    where k.loja_id = p_loja_id and k.data_mov > p_data and not k.cancelado
    group by k.n_cod_prod, k.codigo_local_estoque
  ), dia as (
    select k.n_cod_prod, k.codigo_local_estoque, k.quantidade, k.saldo_apos, k.cmc_apos, k.data_mov, k.id_mov
    from kardex_omie k
    join prim p on p.n_cod_prod = k.n_cod_prod and p.codigo_local_estoque = k.codigo_local_estoque and p.d = k.data_mov
    where k.loja_id = p_loja_id and not k.cancelado
  ), antes as (
    select n_cod_prod, codigo_local_estoque, round(saldo_apos - quantidade, 6) as v, count(*) as c from dia group by 1, 2, 3
  ), depois as (
    select n_cod_prod, codigo_local_estoque, round(saldo_apos, 6) as v, count(*) as c from dia group by 1, 2, 3
  ), ini as (
    select a.n_cod_prod, a.codigo_local_estoque, min(a.v) as v
    from antes a
    left join depois d on d.n_cod_prod = a.n_cod_prod and d.codigo_local_estoque = a.codigo_local_estoque and d.v = a.v
    where a.c - coalesce(d.c, 0) = 1
    group by a.n_cod_prod, a.codigo_local_estoque
    having count(*) = 1
  )
  select distinct on (x.n_cod_prod, x.codigo_local_estoque)
         x.n_cod_prod, x.codigo_local_estoque, x.quantidade, x.saldo_apos, x.cmc_apos, x.data_mov
  from dia x
  left join ini i on i.n_cod_prod = x.n_cod_prod and i.codigo_local_estoque = x.codigo_local_estoque
  where i.v is null or round(x.saldo_apos - x.quantidade, 6) = i.v
  order by x.n_cod_prod, x.codigo_local_estoque, x.id_mov
$$;
revoke all on function public.primeiro_mov_apos(bigint, date) from public, anon;
grant execute on function public.primeiro_mov_apos(bigint, date) to authenticated;
