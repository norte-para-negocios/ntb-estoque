-- B.3.4: RPC para resumo mensal de contas a receber por loja
create or replace function financeiro_resumo_cr(p_loja_id bigint)
returns table(mes text, total numeric, n bigint, atrasado bigint)
language sql stable security definer
as $$
  select
    to_char(data_vencimento, 'YYYY-MM') as mes,
    sum(valor_documento) as total,
    count(*) as n,
    count(*) filter (where status_titulo = 'ATRASADO') as atrasado
  from contas_receber
  where loja_id = p_loja_id
    and data_vencimento is not null
  group by to_char(data_vencimento, 'YYYY-MM')
  order by mes;
$$;

grant execute on function financeiro_resumo_cr(bigint) to authenticated, anon;
