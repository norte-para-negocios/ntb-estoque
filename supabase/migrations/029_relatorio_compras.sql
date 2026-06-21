-- Relatório de Compras (BETA): agregações sobre as NF de ENTRADA (compras).
-- Valor da compra = soma(item.n_qtde_nfe * item.n_preco_unit) — o v_total_item do
-- Omie vem nulo; o total por NF bate com a soma dos itens. Período pela data de
-- emissão da NF. Família/tipo vêm do cadastro de produto (join por codigo_produto).

-- Índices que sustentam o relatório.
create index if not exists idx_nf_loja_emissao on notas_fiscais (loja_id, d_emissao_nfe);
create index if not exists idx_nfi_loja_nf on nota_fiscal_items (loja_id, nota_fiscal_id);

-- Total geral do período (valor e nº de notas distintas).
create or replace function relatorio_compras_total(p_loja_id bigint, p_ini date, p_fim date)
returns table(valor numeric, n_notas bigint)
language sql stable as $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini
    and nf.d_emissao_nfe <= p_fim;
$$;

-- Abertura por dimensão (familia | tipo | produto | fornecedor), ranqueada por valor.
create or replace function relatorio_compras_dim(p_loja_id bigint, p_ini date, p_fim date, p_dim text)
returns table(rotulo text, valor numeric, itens bigint)
language sql stable as $$
  select
    coalesce(
      nullif(
        case p_dim
          when 'familia'    then p.descricao_familia
          when 'tipo'       then p.tipo_item
          when 'produto'    then i.c_descricao_produto
          when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        end, ''),
      'Sem classificação'
    ) as rotulo,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*)::bigint as itens
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini
    and nf.d_emissao_nfe <= p_fim
  group by 1
  order by valor desc;
$$;
