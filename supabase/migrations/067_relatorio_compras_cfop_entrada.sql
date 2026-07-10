-- Corrige achado da reuniao 09/07: o relatorio de Compras (migration 065, hoje de
-- manha) usava i.c_cfop -- o CFOP DO FORNECEDOR/documento -- pra filtro, agrupamento
-- e exclusao de bonificacao/comodato. Ramon: "o CFOP aqui, eu preciso que voce traga
-- o CFOP de ENTRADA, nao do fornecedor... esses CFOPs aqui tem que ser o CFOP de
-- entrada. Esse aqui esta puxando o CFOP do fornecedor."
--
-- O CFOP de entrada correto ja existe e ja e usado assim na Auditoria Fiscal
-- (migrations 040/047): i.full_object->'itensAjustes'->>'cCFOPEntrada'. lib/cfop.ts
-- (descreverCFOP) classifica com base NESSE campo ("Entrada de bonificacao...",
-- "Entrada de bem por comodato...") -- ou seja, a logica de bonificacao/comodato
-- do relatorio de compras estava checando o campo errado desde esta manha; troca
-- pro mesmo campo que a Auditoria Fiscal ja usa, sem coalesce pro c_cfop (mesma
-- semantica de "sem classificacao" quando o Omie nao trouxe itensAjustes).

drop function if exists relatorio_compras_total(bigint, date, date, text[], text[], text, text[]);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[]);
drop function if exists relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[]);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[]);

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
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;

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
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;

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
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop,
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
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  order by nf.d_emissao_nfe desc, total desc, i.id;
$$;

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
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;
