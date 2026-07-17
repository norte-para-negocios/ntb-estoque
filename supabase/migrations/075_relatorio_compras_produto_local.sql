-- 075_relatorio_compras_produto_local.sql
-- Adiciona p_produto (busca por nome/codigo) e p_local (codigo_local_estoque,
-- extraido de full_object->itensAjustes->>codigo_local_estoque, confirmado
-- populado no Supabase) as relatorio_compras_total/_dim/_matriz. O join com
-- produtos ja existe nas 3 (usado pelo dim='produto'); so falta o parametro.

drop function if exists relatorio_compras_total(bigint, date, date, text[], text[], text, text[]);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[]);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[]);

create or replace function relatorio_compras_total(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(valor numeric, n_notas bigint)
language sql stable as $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;

create or replace function relatorio_compras_dim(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(rotulo text, valor numeric, itens bigint)
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
    count(*)::bigint as itens
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;

create or replace function relatorio_compras_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(rotulo text, mes text, valor numeric)
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
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;
