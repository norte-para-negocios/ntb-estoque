-- Relatório de Compras: pedido do Ramon na reunião de 06/07.
-- 1) Família e Tipo passam de filtro único (text) para multi-seleção (text[]).
-- 2) Novo filtro de CFOP (multi-seleção), sobre i.c_cfop.
-- 3) Bonificação (CFOP sufixo 910, ex. 5910) e comodato (sufixo 908, ex. 5908/6908)
--    NÃO são compra/gasto real para o Ramon ("não é um gasto para mim... teria que
--    sair daqui") — saem do relatório de Compras (total, abertura por dimensão,
--    matriz mensal e detalhe), sempre, independente dos filtros aplicados.
-- Assinatura muda (p_familia/p_tipo text -> p_familias/p_tipos text[]; +p_cfops
-- text[]): precisa dropar as versões antigas antes de recriar.

drop function if exists relatorio_compras_total(bigint, date, date, text, text, text);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text, text, text);
drop function if exists relatorio_compras_detalhe(bigint, date, date, text, text, text);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text, text, text);

-- Total geral do período (com filtros opcionais, multi-seleção em família/tipo/CFOP).
create or replace function relatorio_compras_total(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null
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
    and (p_cfops is null or i.c_cfop = any(p_cfops))
    and right(regexp_replace(coalesce(i.c_cfop, ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;

-- Abertura por dimensão (com filtros opcionais).
create or replace function relatorio_compras_dim(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null
) returns table(rotulo text, valor numeric, itens bigint)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.c_cfop
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
    and (p_cfops is null or i.c_cfop = any(p_cfops))
    and right(regexp_replace(coalesce(i.c_cfop, ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;

-- Detalhe: uma linha por item de NF de entrada (com filtros opcionais).
create or replace function relatorio_compras_detalhe(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null
) returns table(
  data date, mes text, nota text, fornecedor text, tipo text, familia text,
  produto text, codigo text, ncm text, cfop text, unidade text,
  qtde numeric, preco_unit numeric, total numeric
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
    i.c_cfop as cfop,
    i.c_unidade_nfe as unidade,
    coalesce(i.n_qtde_nfe, 0)::numeric as qtde,
    coalesce(i.n_preco_unit, 0)::numeric as preco_unit,
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as total
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or i.c_cfop = any(p_cfops))
    and right(regexp_replace(coalesce(i.c_cfop, ''), '\D', '', 'g'), 3) not in ('910', '908')
  order by nf.d_emissao_nfe desc, total desc, i.id;
$$;

-- Matriz mensal (linha = dimensão, coluna = mês), com filtros opcionais.
create or replace function relatorio_compras_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null
) returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.c_cfop
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
    and (p_cfops is null or i.c_cfop = any(p_cfops))
    and right(regexp_replace(coalesce(i.c_cfop, ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;
