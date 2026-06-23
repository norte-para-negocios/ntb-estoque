-- Módulo A v2: valoriza a movimentação pelo ÚLTIMO PREÇO DE NF de compra (confiável),
-- NÃO pelo CMC (que está podre p/ produto acabado). Como produto acabado não tem NF
-- de compra, ele fica sem valor (correto: o que interessa é o consumo de INSUMOS
-- comprados — matéria-prima, consumo, revenda). qtde continua exata.

create or replace function relatorio_movimentacao_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text
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
  group by 1, 2
  having sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) <> 0
  order by 1, 2;
$$;

create or replace function relatorio_movimentacao_total(
  p_loja_id bigint, p_ini date, p_fim date, p_sentido text
) returns table(qtde numeric, valor numeric)
language sql stable as $$
  with preco as (
    select distinct on (i.n_id_produto) i.n_id_produto, i.n_preco_unit
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    where i.loja_id = p_loja_id and nf.deleted_at is null and i.n_preco_unit > 0 and i.n_id_produto is not null
    order by i.n_id_produto, nf.d_emissao_nfe desc
  )
  select
    coalesce(sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end), 0)::numeric,
    coalesce(sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(pr.n_preco_unit, 0)), 0)::numeric
  from movimentos_historico m
  left join preco pr on pr.n_id_produto = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim;
$$;
