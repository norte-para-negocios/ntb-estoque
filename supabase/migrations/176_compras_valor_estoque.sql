-- 176: Compras com o valor de estoque do Omie e sem itens que não movimentam estoque (Fase A, Task 5; itens 5 e 6 do
-- plano docs/superpowers/plans/2026-10-18-fase-a-correcoes-provadas.md). Corpo = 097 (conferido igual a produção em
-- 18/10/2026 por pg_get_functiondef) com 3 mudanças: (1) coluna nova valor_estoque = custo_estoque_item_omie (175),
-- o valor que o Omie põe no estoque (regra N3 corrigida); (2) itens "não movimenta estoque" ou "ignorar item" saem
-- (item_movimenta_estoque, 175) — no Omie eles não entram no estoque; (3) valor continua quantidade × preço (valor da
-- nota), para nenhum consumidor mudar sem querer. Mudou a lista de colunas de saída: drop + create.
-- Espelho em lib/relatorio-frio-nf.ts (mesmo commit). Depende da 175.

drop function if exists relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text);
drop function if exists relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text);

create function relatorio_compras_total(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null,
  p_status text default 'CONCLUIDA'
) returns table(valor numeric, n_notas bigint, valor_estoque numeric)
language sql stable as $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint,
    coalesce(sum(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)), 0)::numeric
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;

create function relatorio_compras_dim(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null,
  p_status text default 'CONCLUIDA'
) returns table(rotulo text, valor numeric, itens bigint, valor_estoque numeric)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*)::bigint as itens,
    coalesce(sum(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)), 0)::numeric as valor_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;

create function relatorio_compras_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null,
  p_status text default 'CONCLUIDA'
) returns table(rotulo text, mes text, valor numeric, valor_estoque numeric)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    coalesce(sum(custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit)), 0)::numeric as valor_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;

create function relatorio_compras_detalhe(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null,
  p_status text default 'CONCLUIDA'
) returns table(
  data date, mes text, nota text, fornecedor text, tipo text, familia text,
  produto text, codigo text, ncm text, cfop text, unidade text,
  qtde numeric, preco_unit numeric, total numeric, valor_estoque numeric
)
language sql stable as $$
  select
    nf.d_emissao_nfe as data,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    p.tipo_item as tipo,
    p.descricao_familia as familia,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    i.c_ncm as ncm,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total,
    custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as valor_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and item_movimenta_estoque(i.full_object)
    and nf_bate_status(nf.c_etapa, nf.full_object, p_status)
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_tipos is null
         or ('__sem__' = any(p_tipos) and p.tipo_item is null)
         or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null
         or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  order by nf.d_emissao_nfe desc, total desc, i.id;
$$;




grant execute on function relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text) to authenticated, service_role;
grant execute on function relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text) to authenticated, service_role;
grant execute on function relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text) to authenticated, service_role;
grant execute on function relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text) to authenticated, service_role;

notify pgrst, 'reload schema';
