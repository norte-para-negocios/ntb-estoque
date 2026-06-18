-- CMC (custo medio de compra) mais recente NAO-ZERO por produto, por loja.
-- Usada na tela /movimentacoes para estimar VALOR (R$) das entradas/saidas
-- (que no historico so existem em QUANTIDADE): valor = quantidade x CMC recente.
-- E uma ESTIMATIVA com o custo ATUAL do produto, nao o custo de cada movimento
-- historico (o Omie nao guarda o CMC por movimento); a tela deixa isso claro.
--
-- Mesma logica que a tela /produto usa em memoria (bug A-1): a foto do dia
-- corrente costuma vir sem CMC, entao pega a foto mais recente com CMC > 0.
-- DISTINCT ON no Postgres evita trazer toda a posicao para a aplicacao.
-- SECURITY INVOKER + filtro por p_loja_id: mesmo padrao de familias_da_loja.

create index if not exists idx_posicao_cmc_recente
  on posicao_estoques (loja_id, n_cod_prod, data_posicao desc);

create or replace function cmc_recente_da_loja(p_loja_id bigint)
returns table (n_cod_prod bigint, cmc numeric)
language sql
security invoker
stable
as $$
  select distinct on (pe.n_cod_prod)
         pe.n_cod_prod,
         pe.n_cmc as cmc
    from posicao_estoques pe
   where pe.loja_id = p_loja_id
     and pe.n_cmc is not null
     and pe.n_cmc > 0
   order by pe.n_cod_prod, pe.data_posicao desc
$$;

revoke execute on function cmc_recente_da_loja(bigint) from public;
revoke execute on function cmc_recente_da_loja(bigint) from anon;
grant execute on function cmc_recente_da_loja(bigint) to authenticated;
