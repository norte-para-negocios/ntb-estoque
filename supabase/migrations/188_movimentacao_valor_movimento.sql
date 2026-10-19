-- 188: Movimentação "Por operação (R$)" pelo valor do próprio movimento (Fase D, matriz N13). Só leitura.
--
-- O relatório "Movimentos de Estoque — Resumido por Produto" do Omie (COM_EST_MOV_PRODUTO) valoriza cada movimento
-- pelo seu valor (saída = CMC da hora, compra = custo da nota). O modo automático de hoje (lib/movimentacao-operacao-
-- auto.ts) usa o valor da NF, o preço de VENDA do cupom nas saídas do PDV e movimentos.valor nos ajustes; essa função
-- é a opção nova "valor do movimento" (o padrão da tela não muda):
--   loja Omie   = kardex_omie (espelho do kardex), valor = |quantidade| × valor_unit, origem = descrição do Omie;
--   loja própria = estoque_movimentos (ledger), valor = |quantidade| × custo_unitario.
-- Uma linha por origem × sentido × local × produto × mês (a tela agrega por família/produto/local/tipo).
-- inventario: Omie = origem INV ou ajuste cujo motivo em movimentos é INV; própria = origem INVENTARIO.
-- security invoker: vale a RLS de quem chama. Teste: scripts/testes-sql/188_movimentacao_valor_movimento.sql.

create or replace function public.relatorio_movimentacao_valor_mov(p_loja_id bigint, p_ini date, p_fim date)
returns table (origem text, sentido text, codigo_local_estoque bigint, n_cod_prod bigint, mes text, inventario boolean, qtde numeric, valor numeric, sem_custo integer)
language sql stable security invoker set search_path = public as $$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  base as (
    select coalesce(nullif(k.des_origem, ''), nullif(k.cod_origem, ''), 'Sem origem') as origem,
           case when k.quantidade > 0 then 'E' else 'S' end as sentido,
           k.codigo_local_estoque, k.n_cod_prod, to_char(k.data_mov, 'YYYY-MM') as mes,
           (k.cod_origem = 'INV' or coalesce(mv.motivo = 'INV', false)) as inventario,
           abs(k.quantidade) as q, abs(k.quantidade) * coalesce(k.valor_unit, 0) as v, k.valor_unit is null as sem
    from kardex_omie k
    left join movimentos mv on mv.loja_id = k.loja_id and mv.id_ajuste = k.id_ajuste and k.id_ajuste is not null
    where (select m from modo) <> 'proprio'
      and k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado and k.quantidade <> 0
    union all
    select case e.origem
             when 'COMPRA' then 'Compra de Produto'
             when 'VENDA' then 'Venda'
             when 'PRODUCAO' then case when e.quantidade < 0 then 'Consumo da Ordem de Produção' else 'Entrada da Ordem de Produção' end
             when 'INVENTARIO' then 'Inventário'
             when 'PERDA' then 'Perda'
             when 'TRANSFERENCIA' then 'Transferência'
             when 'ESTORNO' then 'Estorno'
             else initcap(replace(lower(e.origem), '_', ' ')) end,
           case when e.quantidade > 0 then 'E' else 'S' end,
           e.codigo_local_estoque, e.codigo_produto, to_char(e.data_ref, 'YYYY-MM'),
           e.origem = 'INVENTARIO',
           abs(e.quantidade), abs(e.quantidade) * coalesce(e.custo_unitario, 0), e.custo_unitario is null
    from estoque_movimentos e
    where (select m from modo) = 'proprio'
      and e.loja_id = p_loja_id and e.data_ref between p_ini and p_fim
  )
  select origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario,
         round(sum(q), 6), round(sum(v), 2), count(*) filter (where sem)::int
  from base
  group by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
  order by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
$$;
revoke all on function public.relatorio_movimentacao_valor_mov(bigint, date, date) from public, anon;
grant execute on function public.relatorio_movimentacao_valor_mov(bigint, date, date) to authenticated, service_role;
