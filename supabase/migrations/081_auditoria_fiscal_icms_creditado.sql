-- 081_auditoria_fiscal_icms_creditado.sql
-- Achado do audit de 2026-07-18 na tela Auditoria Fiscal: o export
-- (app/(app)/auditoria-fiscal/export/route.ts) calculava "ICMS creditado (R$)"
-- com uma query solta e separada da RPC principal, com 4 bugs simultaneos:
--   1) sem paginacao (.range()) -- as 6 lojas ativas TEM MAIS DE 1000 itens
--      na janela quente (confirmado via SQL: loja 5=3481, 3=2574, 6=2540,
--      2=1523, 4=1419), entao o corte silencioso de 1000 linhas do
--      PostgREST/supabase-js SEMPRE truncava o somatorio de ICMS;
--   2) nao filtrava NF cancelada (a RPC principal filtra, essa query nao);
--   3) ignorava os filtros de produto/familia/fornecedor/local que o resto
--      do relatorio respeita -- com filtro ativo, a coluna de ICMS somava
--      TODOS os itens do par CFOP, nao so os filtrados;
--   4) somava itensICMS.nValor de TODOS os itens do par CFOP, inclusive os
--      que NAO creditam ICMS (cNaoCredICMSE='S') -- confirmado com SQL na
--      loja 3: par 5.102->1.102 tinha R$7.130,65 de ICMS em itens que NAO
--      creditam contra so R$294,67 nos que creditam, ou seja a coluna
--      "creditado" estava ~25x inflada nesse par.
-- Correcao: mover o calculo pra dentro da propria RPC (mesma agregacao SQL,
-- sem risco de corte de 1000 linhas, already respeita todos os filtros e o
-- "nao cancelada"), filtrado por credita_icms, e espelhar em
-- lib/relatorio-frio-nf.ts (agregarAuditoriaCfop) pro pedaço frio.

drop function if exists relatorio_auditoria_fiscal_cfop(bigint, date, date, text, text, text, bigint);

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produto text default null, p_familia text default null,
  p_fornecedor text default null, p_local bigint default null
) returns table(
  cfop_doc text, cfop_entrada text, itens bigint, valor numeric,
  credita_icms bigint, move_estoque bigint, icms_creditado numeric
)
language sql stable as $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
    )::bigint as credita_icms,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S'
    )::bigint as move_estoque,
    sum(
      case when coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
        then coalesce((i.full_object->'itensICMS'->>'nValor')::numeric, 0)
        else 0
      end
    )::numeric as icms_creditado
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familia is null
         or (p_familia = '__sem__' and p.descricao_familia is null)
         or p.descricao_familia = p_familia)
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;
