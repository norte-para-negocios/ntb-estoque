-- Módulo A — Relatório de Movimentação/Consumo (espelha o MOV_DRV do Ramon).
-- Fonte: movimentos_historico (qtde entradas/saídas por produto/dia, do ListarMovimentos).
-- Valor = quantidade × CMC (custo médio mais recente do produto na posição). É
-- APROXIMADO: o ListarMovimentos não traz o custo por movimento; usamos o CMC atual.
-- p_sentido: 'saidas' (baixas/consumo/vendas) ou 'entradas'. p_dim: tipo/familia/produto.

create or replace function relatorio_movimentacao_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text
) returns table(rotulo text, mes text, qtde numeric, valor numeric)
language sql stable as $$
  with cmc as (
    select distinct on (n_cod_prod) n_cod_prod, n_cmc
    from posicao_estoques
    where loja_id = p_loja_id and n_cmc is not null and n_cmc > 0
    order by n_cod_prod, data_posicao desc
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
    sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(c.n_cmc, 0))::numeric as valor
  from movimentos_historico m
  left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.cod_prod
  left join cmc c on c.n_cod_prod = m.cod_prod
  where m.loja_id = p_loja_id
    and m.data >= p_ini and m.data <= p_fim
  group by 1, 2
  having sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) <> 0
  order by 1, 2;
$$;

-- Total do período (qtde e valor) para o cabeçalho.
create or replace function relatorio_movimentacao_total(
  p_loja_id bigint, p_ini date, p_fim date, p_sentido text
) returns table(qtde numeric, valor numeric)
language sql stable as $$
  with cmc as (
    select distinct on (n_cod_prod) n_cod_prod, n_cmc
    from posicao_estoques
    where loja_id = p_loja_id and n_cmc is not null and n_cmc > 0
    order by n_cod_prod, data_posicao desc
  )
  select
    coalesce(sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end), 0)::numeric,
    coalesce(sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(c.n_cmc, 0)), 0)::numeric
  from movimentos_historico m
  left join cmc c on c.n_cod_prod = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim;
$$;
