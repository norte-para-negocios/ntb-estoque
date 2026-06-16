-- Bloco 2.3: produtos a repor (modo Compras). Retorna os codigo_produto que
-- precisam de compra na ultima foto de posicao da loja: minimo efetivo > 0 e
-- (minimo + previsao de venda - saldo) > 0. Minimo efetivo = override manual
-- (produtos.estoque_minimo) ou, na falta, o do Omie (soma por local). Mesma
-- logica do calculo "Comprar" da tela; usada para filtrar so o que repor.
create or replace function produtos_repor(p_loja_id bigint)
returns setof bigint
language sql
stable
as $$
  with ultima as (
    select max(data_posicao) as d from posicao_estoques where loja_id = p_loja_id
  ),
  pos as (
    select n_cod_prod, sum(n_saldo) as saldo, sum(estoque_minimo) as min_omie
    from posicao_estoques, ultima
    where loja_id = p_loja_id and data_posicao = ultima.d
    group by n_cod_prod
  )
  select p.codigo_produto
  from produtos p
  join pos on pos.n_cod_prod = p.codigo_produto
  left join previsao_venda pv on pv.loja_id = p.loja_id and pv.n_cod_prod = p.codigo_produto
  where p.loja_id = p_loja_id
    and coalesce(p.estoque_minimo, pos.min_omie) > 0
    and greatest(0, coalesce(p.estoque_minimo, pos.min_omie) + coalesce(pv.qtde, 0) - pos.saldo) > 0;
$$;

grant execute on function produtos_repor(bigint) to anon, authenticated, service_role;
