-- Adiciona filtros opcionais de mes (YYYY-MM) à RPC de faturamento.
create or replace function relatorio_faturamento_matriz(
  p_loja_id bigint,
  p_dim text,
  p_mes_ini text default null,
  p_mes_fim text default null
)
returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select rotulo, mes, sum(valor)::numeric
  from faturamento_importado
  where loja_id = p_loja_id
    and dimensao = p_dim
    and (p_mes_ini is null or mes >= p_mes_ini)
    and (p_mes_fim is null or mes <= p_mes_fim)
  group by rotulo, mes
  order by rotulo, mes;
$$;
