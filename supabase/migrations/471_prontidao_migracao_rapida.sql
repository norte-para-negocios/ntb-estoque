-- 471: mesma prontidao_migracao da 470, mas a comparação posição × kardex busca o último movimento de cada produto x local
-- pelo índice (lateral, 1 linha por par) em vez de varrer o kardex da loja inteira: loja 6 de ~19 s para ~0,5 s.
-- Parte da posição do Omie (o que o Omie diz que existe); par só no kardex fica de fora.
create or replace function public.prontidao_migracao(p_loja bigint) returns jsonb
language sql stable security invoker set search_path = public as $$
with
foto as (  -- foto mais recente que já tem algum local real (o sync grava a sentinela 0 primeiro)
  select max(data_posicao) d from posicao_estoques where loja_id = p_loja and codigo_local_estoque <> 0
),
pos as (
  select pe.n_cod_prod, pe.codigo_local_estoque, pe.n_saldo::numeric saldo, pe.n_cmc::numeric cmc
  from posicao_estoques pe, foto where pe.loja_id = p_loja and pe.data_posicao = foto.d and pe.codigo_local_estoque <> 0
),
prod as (select codigo_produto, codigo, descricao, unidade, ncm, tipo_item, codigo_familia from produtos where loja_id = p_loja and not coalesce(inativo, false)),
cmp as (  -- cada produto x local da posição contra o último movimento do kardex do Omie (busca pelo índice, 1 linha por par)
  select pos.n_cod_prod, pos.codigo_local_estoque loc, pos.saldo, u.saldo_apos, u.data_mov
  from pos left join lateral (
    select k.saldo_apos::numeric saldo_apos, k.data_mov from kardex_omie k
    where k.loja_id = p_loja and k.n_cod_prod = pos.n_cod_prod and k.codigo_local_estoque = pos.codigo_local_estoque and not k.cancelado
    order by k.data_mov desc, k.id_mov desc limit 1) u on true
  where pos.saldo <> 0 or coalesce(u.saldo_apos, 0) <> 0
),
pares as materialized (  -- pares produto x local do kardex, pulando pelo índice (loose index scan): sem varrer as linhas
  with recursive t(n_cod_prod, codigo_local_estoque) as (
    (select n_cod_prod, codigo_local_estoque from kardex_omie where loja_id = p_loja order by n_cod_prod, codigo_local_estoque limit 1)
    union all
    select x.n_cod_prod, x.codigo_local_estoque from t, lateral (
      select k.n_cod_prod, k.codigo_local_estoque from kardex_omie k
      where k.loja_id = p_loja and (k.n_cod_prod, k.codigo_local_estoque) > (t.n_cod_prod, t.codigo_local_estoque)
      order by k.n_cod_prod, k.codigo_local_estoque limit 1) x
  )
  select * from t
),
so_k as (  -- pares que só o kardex tem (sem linha na posição) e cujo último saldo não é zero: o Omie diz que não há, o kardex diz que há
  select pr.n_cod_prod, pr.codigo_local_estoque loc, u.saldo_apos, u.data_mov
  from pares pr
  join lateral (
    select k.saldo_apos::numeric saldo_apos, k.data_mov from kardex_omie k
    where k.loja_id = p_loja and k.n_cod_prod = pr.n_cod_prod and k.codigo_local_estoque = pr.codigo_local_estoque and not k.cancelado
    order by k.data_mov desc, k.id_mov desc limit 1) u on true
  where u.saldo_apos <> 0 and not exists (select 1 from pos where pos.n_cod_prod = pr.n_cod_prod and pos.codigo_local_estoque = pr.codigo_local_estoque)
),
nome as (select codigo_produto, coalesce(descricao, '') || coalesce(' (' || codigo || ')', '') n from produtos where loja_id = p_loja)
select jsonb_build_object(
  'foto', (select d from foto),
  'cadastro', jsonb_build_object(
    'produtos', (select count(*) from prod),
    'sem_unidade', (select count(*) from prod where coalesce(btrim(unidade), '') = ''),
    'ncm_invalido', (select count(*) from prod where tipo_item in ('00', '04') and coalesce(ncm, '') !~ '^[0-9]{8}$'),
    'sem_familia', (select count(*) from prod where codigo_familia is null),
    'familias', (select count(*) from familias where loja_id = p_loja),
    'locais', (select count(*) from local_estoques where loja_id = p_loja and coalesce(inativo, 'N') <> 'S'),
    'fornecedores', (select count(*) from fornecedores where loja_id = p_loja)
  ),
  'fichas', jsonb_build_object(
    'producao', (select count(*) from prod where tipo_item in ('03', '04')),
    'lidas', (select count(distinct e.codigo_produto) from estrutura_produto_cache e join prod on prod.codigo_produto = e.codigo_produto where e.loja_id = p_loja)
  ),
  'saldo', jsonb_build_object(
    'linhas', (select count(*) from pos where saldo <> 0),
    'negativos', (select count(*) from pos where saldo < 0),
    'custo_zero', (select count(*) from pos where saldo > 0 and coalesce(cmc, 0) <= 0),
    'custo_absurdo', (select count(*) from pos where saldo > 0 and cmc >= 1000),
    'valor', (select round(coalesce(sum(saldo * cmc), 0), 2) from pos where saldo > 0 and cmc > 0 and cmc < 1000)
  ),
  'kardex', jsonb_build_object(
    'desde', (select min(data_mov) from kardex_omie where loja_id = p_loja),
    'linhas', (select count(*) from kardex_omie where loja_id = p_loja),
    'comparados', (select count(*) from cmp),
    'batem', (select count(*) from cmp where saldo_apos is not null and abs(saldo - saldo_apos) <= 0.001),
    'diferem', (select count(*) from cmp where saldo_apos is not null and abs(saldo - saldo_apos) > 0.001),
    'sem_kardex', (select count(*) from cmp where saldo_apos is null),
    'so_kardex', (select count(*) from so_k)
  ),
  'pendencias', jsonb_build_object(
    'ops_abertas', (select count(*) from ordens_producao where loja_id = p_loja and aberta_omie),
    'notas_pendentes', (select count(*) from notas_fiscais where loja_id = p_loja and deleted_at is null and c_etapa = '40'
                          and d_emissao_nfe >= now() - interval '90 days')
  ),
  'piores', jsonb_build_object(
    'negativos', (select coalesce(jsonb_agg(x order by x->>'valor'), '[]') from (
        select jsonb_build_object('produto', coalesce(nome.n, pos.n_cod_prod::text), 'local', pos.codigo_local_estoque, 'saldo', pos.saldo,
                                  'valor', round(pos.saldo * greatest(coalesce(pos.cmc, 0), 0), 2)) x
        from pos left join nome on nome.codigo_produto = pos.n_cod_prod where pos.saldo < 0
        order by pos.saldo * greatest(coalesce(pos.cmc, 0), 0) asc, pos.saldo asc limit 15) t),
    'custo_absurdo', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('produto', coalesce(nome.n, pos.n_cod_prod::text), 'local', pos.codigo_local_estoque, 'saldo', pos.saldo, 'cmc', pos.cmc) x
        from pos left join nome on nome.codigo_produto = pos.n_cod_prod where pos.saldo > 0 and pos.cmc >= 1000
        order by pos.cmc desc limit 15) t),
    'diferem', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('produto', coalesce(nome.n, cmp.n_cod_prod::text), 'local', cmp.loc, 'posicao', cmp.saldo, 'kardex', cmp.saldo_apos, 'ultimo_mov', cmp.data_mov) x
        from cmp left join nome on nome.codigo_produto = cmp.n_cod_prod where cmp.saldo_apos is not null and abs(cmp.saldo - cmp.saldo_apos) > 0.001
        order by abs(cmp.saldo - cmp.saldo_apos) desc limit 15) t)
  )
)
$$;
revoke all on function public.prontidao_migracao(bigint) from public, anon, authenticated;
grant execute on function public.prontidao_migracao(bigint) to service_role;
