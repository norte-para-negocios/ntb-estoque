-- 299 — Cubo "Recebimentos" dos relatórios dinâmicos (estilo Omie): uma linha jsonb por item de nota fiscal de entrada.
-- Plano: docs/superpowers/plans/2026-10-26-relatorios-dinamicos-estilo-omie.md (Task 3).
-- Só leitura, security invoker (vale a RLS do usuário). Manda apenas os pedaços do full_object que o cubo usa (o objeto inteiro pesa demais em período longo).
-- Paginada (p_de/p_ate) com ordem estável; o app lê em blocos de 5000.
create or replace function public.cubo_recebimentos(p_loja bigint, p_ini date, p_fim date, p_de int default 0, p_ate int default 4999)
returns setof jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'nota_id', n.id,
    'c_numero_nfe', n.c_numero_nfe,
    'c_serie_nfe', n.c_serie_nfe,
    'c_chave_nfe', n.c_chave_nfe,
    'c_etapa', n.c_etapa,
    'd_emissao_nfe', n.d_emissao_nfe,
    'c_razao_social', n.c_razao_social,
    'c_nome', n.c_nome,
    'c_cnpj_cpf', n.c_cnpj_cpf,
    'c_inscricao', n.c_inscricao,
    'origem', n.origem,
    'nota_full', jsonb_build_object(
      'infoCadastro', n.full_object -> 'infoCadastro',
      'infoAdicionais', n.full_object -> 'infoAdicionais',
      'transporte', n.full_object -> 'transporte',
      'parcelas', jsonb_build_object('parcelasLista', coalesce(n.full_object -> 'parcelas' -> 'parcelasLista', '[]'::jsonb)),
      'sefaz', jsonb_build_object('situacao', n.full_object -> 'sefaz' ->> 'situacao')
    ),
    'item_id', i.id,
    'n_sequencia', i.n_sequencia,
    'n_id_produto', i.n_id_produto,
    'n_id_pedido', i.n_id_pedido,
    'c_codigo_produto', i.c_codigo_produto,
    'c_descricao_produto', i.c_descricao_produto,
    'c_ncm', i.c_ncm,
    'c_ean', i.c_ean,
    'c_cfop', i.c_cfop,
    'n_qtde_nfe', i.n_qtde_nfe,
    'c_unidade_nfe', i.c_unidade_nfe,
    'n_preco_unit', i.n_preco_unit,
    'v_desconto', i.v_desconto,
    'v_frete', i.v_frete,
    'v_total_item', i.v_total_item,
    'item_full', jsonb_build_object(
      'itensCabec', i.full_object -> 'itensCabec',
      'itensAjustes', i.full_object -> 'itensAjustes',
      'itensCustoEstoque', i.full_object -> 'itensCustoEstoque',
      'itensICMS', i.full_object -> 'itensICMS',
      'itensICMSST', i.full_object -> 'itensICMSST',
      'itensIPI', i.full_object -> 'itensIPI',
      'itensPIS', i.full_object -> 'itensPIS',
      'itensCOFINS', i.full_object -> 'itensCOFINS',
      'sefaz', i.full_object -> 'sefaz'
    ),
    'categoria', c.nome,
    'categoria_codigo', c.codigo,
    'prod_codigo', p.codigo,
    'prod_descricao', p.descricao,
    'prod_cod_familia', p.codigo_familia,
    'prod_familia', p.descricao_familia
  )
  from (
    -- escolhe só os ids da página (barato) e monta o JSON só deles: o custo não cresce com a posição da página
    select i0.id as item_id
    from notas_fiscais n0
    join nota_fiscal_items i0 on i0.nota_fiscal_id = n0.id and i0.loja_id = n0.loja_id
    where n0.loja_id = p_loja and n0.deleted_at is null and n0.d_emissao_nfe >= p_ini and n0.d_emissao_nfe <= p_fim
    order by n0.d_emissao_nfe, n0.id, i0.n_sequencia, i0.id
    offset greatest(p_de, 0)
    limit greatest(p_ate - p_de + 1, 0)
  ) pg
  join nota_fiscal_items i on i.id = pg.item_id
  join notas_fiscais n on n.id = i.nota_fiscal_id and n.loja_id = i.loja_id
  left join categorias_contabeis c on c.id = i.categoria_contabil_id
  left join produtos p on p.loja_id = n.loja_id and p.codigo_produto = i.n_id_produto
  order by n.d_emissao_nfe, n.id, i.n_sequencia, i.id
$$;

grant execute on function public.cubo_recebimentos(bigint, date, date, int, int) to authenticated;
notify pgrst, 'reload schema';
