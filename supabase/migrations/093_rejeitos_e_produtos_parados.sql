-- Item #16 da reuniao 2026-07-27 (Andrey/Ramon): dashboard gerencial. Duas RPCs
-- novas -- as demais secoes (top faturados/comprados) reaproveitam RPCs ja
-- existentes (relatorio_faturamento_matriz, relatorio_compras_total).
--
-- Achado da pesquisa: rejeito/perda ja existe no sistema como
-- movimentos.motivo = 'TPQ' (gravado direto na linha em
-- lib/actions/transferencia.ts, addMovimento) -- nao precisa join com
-- transferencias. movimentos.valor e CUSTO UNITARIO (CMC), nao valor de
-- linha -- todo total precisa de valor*quan.

create or replace function relatorio_rejeitos_por_tipo(
  p_loja_id  bigint,
  p_data_ini date,
  p_data_fim date
)
returns table (
  categoria      text,
  valor_total    numeric,
  qtd_movimentos bigint
)
language sql
stable
security invoker
as $$
  select
    case
      when p.tipo_item = '01' then 'Matéria-prima'
      when p.tipo_item = '00' then 'Revenda'
      when p.tipo_item in ('03', '06') then 'Produto em processo'
      else 'Outros'
    end as categoria,
    sum(coalesce(m.valor, 0) * coalesce(m.quan, 0)) as valor_total,
    count(*) as qtd_movimentos
  from movimentos m
  join produtos p on p.codigo_produto = m.id_prod and p.loja_id = m.loja_id
  where m.loja_id = p_loja_id
    and m.motivo = 'TPQ'
    and m.status = 'Concluido'
    and m.data >= p_data_ini
    and m.data < (p_data_fim + 1)
  group by categoria
  order by valor_total desc nulls last
$$;

create or replace function relatorio_produtos_parados(
  p_loja_id bigint,
  p_dias    int default 30
)
returns table (
  codigo_produto        bigint,
  codigo                text,
  descricao             text,
  n_saldo               numeric,
  dias_sem_movimento    int,
  data_ultimo_movimento date
)
language sql
stable
security invoker
as $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  saldo as (
    select pe.n_cod_prod, sum(pe.n_saldo) as n_saldo
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
    group by pe.n_cod_prod
  ),
  ultimos as (
    select id_prod, max(data)::date as data_ultimo_movimento
    from movimentos
    where loja_id = p_loja_id
    group by id_prod
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    s.n_saldo,
    coalesce((current_date - u.data_ultimo_movimento), 9999) as dias_sem_movimento,
    u.data_ultimo_movimento
  from saldo s
  join produtos p on p.codigo_produto = s.n_cod_prod and p.loja_id = p_loja_id
  left join ultimos u on u.id_prod = s.n_cod_prod
  where s.n_saldo > 0
    and (u.data_ultimo_movimento is null or u.data_ultimo_movimento < current_date - p_dias)
  order by dias_sem_movimento desc, s.n_saldo desc
  limit 50
$$;

revoke execute on function relatorio_rejeitos_por_tipo(bigint, date, date) from public, anon;
grant  execute on function relatorio_rejeitos_por_tipo(bigint, date, date) to authenticated, service_role;

revoke execute on function relatorio_produtos_parados(bigint, int) from public, anon;
grant  execute on function relatorio_produtos_parados(bigint, int) to authenticated, service_role;
