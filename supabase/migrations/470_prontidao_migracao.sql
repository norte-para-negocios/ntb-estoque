-- 470 (Fase 10): "Prontidão para sair do Omie" — SÓ LEITURA. Mede, para uma loja Omie, o que o Norte ERP já tem do Omie
-- (espelhos: produtos, famílias, locais, fornecedores, fichas lidas, posição de estoque e kardex) e o que impede a virada:
-- cadastro incompleto, saldo negativo, custo zerado/absurdo e posição que não bate com o fim do kardex do Omie.
-- Não chama o Omie, não grava nada. Chamada pela tela /migracao-omie (só desenvolvedor) com o service role.
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
ult as (  -- último movimento do kardex do Omie por produto x local
  select distinct on (n_cod_prod, codigo_local_estoque) n_cod_prod, codigo_local_estoque, saldo_apos::numeric saldo_apos, data_mov
  from kardex_omie where loja_id = p_loja and not cancelado
  order by n_cod_prod, codigo_local_estoque, data_mov desc, id_mov desc
),
cmp as (
  select coalesce(p.n_cod_prod, u.n_cod_prod) n_cod_prod, coalesce(p.codigo_local_estoque, u.codigo_local_estoque) loc,
         coalesce(p.saldo, 0) saldo, u.saldo_apos, u.data_mov
  from pos p full join ult u on u.n_cod_prod = p.n_cod_prod and u.codigo_local_estoque = p.codigo_local_estoque
  where coalesce(p.saldo, 0) <> 0 or coalesce(u.saldo_apos, 0) <> 0
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
    'sem_kardex', (select count(*) from cmp where saldo_apos is null)
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
