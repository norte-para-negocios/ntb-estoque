-- Reunião 06/07: fundador comparou /relatorio-movimentacao (vitrine oficial, dentro
-- do hub /relatorios) com a tela antiga /movimentacoes e pediu paridade de filtros
-- ("quanto mais filtros possível... tipo, se é entrada/saída, origem da movimentação").
-- Este modulo cobre o modo "Em quantidade": adiciona tipo/familia/busca de produto
-- (mesmo padrão de /movimentacoes) e local de estoque (mesmo padrão do modo
-- "operação" desta tela / relatorio_estoque_valorizado).
--
-- movimentos_historico não guarda local por movimento (ListarMovimentos do Omie não
-- traz essa informação) — por isso o filtro de local funciona por PRODUTO: restringe
-- aos produtos que têm posição de estoque no(s) local(is) escolhido(s), via
-- posicao_estoques. O conjunto de cod_prod já filtrado (tipo + familia + local) é
-- resolvido em memória (mesmo padrão de "codigosFiltro" usado em /movimentacoes,
-- /ordem-producao etc.) e passado pronto pra função via p_cod_prods.
drop function if exists relatorio_movimentacao_matriz(bigint, date, date, text, text);

create or replace function relatorio_movimentacao_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text,
  p_cod_prods bigint[] default null, p_produto text default null
) returns table(rotulo text, mes text, qtde numeric, valor numeric)
language sql stable as $$
  with preco as (
    select distinct on (i.n_id_produto) i.n_id_produto, i.n_preco_unit
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    where i.loja_id = p_loja_id and nf.deleted_at is null and i.n_preco_unit > 0 and i.n_id_produto is not null
    order by i.n_id_produto, nf.d_emissao_nfe desc
  )
  select
    coalesce(nullif(
      case p_dim
        when 'tipo'    then p.tipo_item
        when 'familia' then p.descricao_familia
        when 'produto' then m.descricao
      end, ''), 'Sem classificação') as rotulo,
    to_char(m.data, 'YYYY-MM') as mes,
    sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end)::numeric as qtde,
    sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(pr.n_preco_unit, 0))::numeric as valor
  from movimentos_historico m
  left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.cod_prod
  left join preco pr on pr.n_id_produto = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim
    and (p_cod_prods is null or m.cod_prod = any(p_cod_prods))
    and (p_produto is null or p_produto = ''
         or m.descricao ilike '%' || p_produto || '%'
         or m.codigo    ilike '%' || p_produto || '%')
  group by 1, 2
  having sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) <> 0
  order by 1, 2;
$$;

revoke execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) from public;
revoke execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) from anon;
grant  execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) to authenticated, service_role;
