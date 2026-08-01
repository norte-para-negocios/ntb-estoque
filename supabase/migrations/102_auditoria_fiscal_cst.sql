-- Bloco 3 da auditoria FAT/NFS_ENT (achado 2026-08-01): a tela de Auditoria
-- Fiscal mostrava CFOP doc -> CFOP entrada e os booleans credita_icms/
-- move_estoque, mas nunca o CST DE ENTRADA em si nem o cruzamento
-- CST doc x CST entrada x CFOP -- que e exatamente o que a consultoria do
-- cliente caca na mao (planilha NFS_ENT_SVVM_26_R0.xlsx, 11 abas dedicadas a
-- isso: "ICMS 00 ou 20", "ICMS 60", "ICMS 90 - CFOP...", "ICMS DIF DE 90 E 60",
-- "ICMS INDEVIDO", "ERRO CFOP 1407").
--
-- Esta RPC e DIAGNOSTICA, nao normativa: devolve as combinacoes reais com
-- contagem e valor, sem afirmar que qualquer uma esta certa ou errada -- isso e
-- avaliacao do contador (ver docs/achado-icms-credito-2026-08-01.md).
--
-- Formato: uma linha por (CST doc, CST entrada, CFOP entrada), com as colunas
-- de credito PIVOTADAS (com_credito / sem_credito lado a lado). Escolha
-- deliberada: a primeira versao devolvia um boolean `inconsistente` ("esse par
-- tem tratamento divergente em algum lugar"), mas medido contra dado real ele
-- marcava 61% das linhas / 94% do valor -- verdadeiro demais pra priorizar
-- nada. Com o pivot, a divergencia aparece sozinha (as duas colunas
-- preenchidas na mesma linha) E na proporcao (593 sem x 20 com conta uma
-- historia diferente de 19 sem x 34 com), que e o que o contador precisa pra
-- decidir onde olhar.
--
-- Campos vem do full_object que a Omie devolve por item (ver
-- lib/omie/nota-fiscal.ts): itensICMS.cSitTrib (CST do documento),
-- itensAjustes.cCFOPEntrada, itensAjustes.itensSitTribEnt.cSitTribICMSE
-- (CST de entrada) e .cNaoCredICMSE (S = nao aproveita credito de ICMS).

drop function if exists relatorio_auditoria_fiscal_cst(bigint, date, date);

create or replace function relatorio_auditoria_fiscal_cst(
  p_loja_id bigint,
  p_ini     date,
  p_fim     date
)
returns table (
  cst_doc            text,
  cst_entrada        text,
  cfop_entrada       text,
  itens_com_credito  bigint,
  valor_com_credito  numeric,
  itens_sem_credito  bigint,
  valor_sem_credito  numeric,
  itens              bigint,
  valor              numeric
)
language sql
stable
security invoker
as $$
  with base as (
    select
      coalesce(nullif(i.full_object->'itensICMS'->>'cSitTrib', ''), '—')                                as cst_doc,
      coalesce(nullif(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cSitTribICMSE', ''), '—')     as cst_entrada,
      coalesce(nullif(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '—')                         as cfop_entrada,
      i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE'                                as nao_credita,
      coalesce((i.full_object->'itensCabec'->>'vTotalItem')::numeric, 0)                                as v
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id
    where i.loja_id = p_loja_id
      and nf.loja_id = p_loja_id
      and nf.deleted_at is null
      and nf.d_emissao_nfe >= p_ini
      and nf.d_emissao_nfe <= p_fim
      -- so itens que realmente trazem o bloco fiscal de entrada; sem isso,
      -- nota sem detalhamento viraria uma linha "—/—/—" gigante e inutil.
      and i.full_object->'itensAjustes'->'itensSitTribEnt' is not null
  )
  select
    cst_doc,
    cst_entrada,
    cfop_entrada,
    count(*) filter (where nao_credita = 'N')::bigint            as itens_com_credito,
    round(coalesce(sum(v) filter (where nao_credita = 'N'), 0), 2) as valor_com_credito,
    count(*) filter (where nao_credita = 'S')::bigint            as itens_sem_credito,
    round(coalesce(sum(v) filter (where nao_credita = 'S'), 0), 2) as valor_sem_credito,
    count(*)::bigint                                             as itens,
    round(sum(v), 2)                                             as valor
  from base
  group by 1, 2, 3
  order by round(sum(v), 2) desc nulls last
$$;
