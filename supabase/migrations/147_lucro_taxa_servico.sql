-- 147 — Lucro do estoque próprio: a taxa de serviço (enviada pelo Vendas como item sem código) não é "item sem baixa".
-- Antes cada venda com taxa acendia o aviso "itens vendidos não baixaram o estoque" no relatório de Lucro.
create or replace function public.lucro_proprio(p_loja bigint, p_ini date, p_fim date, p_dim text default 'produto')
returns table (rotulo text, quantidade numeric, faturamento numeric, cmv numeric, lucro numeric, margem numeric, itens_sem_baixa int, itens_sem_custo int)
language sql stable security definer set search_path = public as $$
  with fat as (
    select v.id as venda_id, v.data, i.codigo_produto, max(coalesce(nullif(i.nome, ''), i.codigo)) as nome,
           sum(i.quantidade) as qtde, sum(i.valor) as valor
      from vendas_proprio v join vendas_proprio_itens i on i.venda_id = v.id
     where v.loja_id = p_loja and v.data between p_ini and p_fim and not v.cancelado and not v.devolvido
     -- Itens sem código (taxa de serviço, avulsos) não se misturam: cada nome é uma linha.
     group by v.id, v.data, i.codigo_produto, case when i.codigo_produto is null then coalesce(nullif(i.nome, ''), i.codigo) end
  ), base as (
    select f.*, p.descricao, p.descricao_familia, p.tipo_item, c.cmv, c.movimentos_sem_custo,
           -- Taxa de serviço não baixa estoque por natureza: não conta como "item sem baixa" (custo zero, margem 100%).
           (c.venda_id is null and coalesce(f.nome, '') !~* '^taxa de servi') as sem_baixa
      from fat f
      left join produtos p on p.loja_id = p_loja and p.codigo_produto = f.codigo_produto
      left join vendas_proprio_cmv c on c.venda_id = f.venda_id and c.codigo_produto = f.codigo_produto
  )
  select case p_dim
           when 'familia' then coalesce(nullif(descricao_familia, ''), 'Sem família')
           when 'tipo' then rotulo_tipo_item(tipo_item)
           when 'dia' then to_char(data, 'YYYY-MM-DD')
           when 'mes' then to_char(data, 'YYYY-MM')
           else coalesce(nullif(descricao, ''), nullif(nome, ''), 'Produto não identificado') end as rotulo,
         sum(qtde) as quantidade,
         round(sum(valor), 2) as faturamento,
         round(sum(coalesce(cmv, 0)), 2) as cmv,
         round(sum(valor) - sum(coalesce(cmv, 0)), 2) as lucro,
         case when sum(valor) > 0 then round((sum(valor) - sum(coalesce(cmv, 0))) / sum(valor) * 100, 1) end as margem,
         count(*) filter (where sem_baixa)::int as itens_sem_baixa,
         count(*) filter (where not sem_baixa and coalesce(movimentos_sem_custo, 0) > 0)::int as itens_sem_custo
    from base
   group by 1
   order by 4 desc nulls last
$$;

notify pgrst, 'reload schema';
