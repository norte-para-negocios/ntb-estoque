-- 185 — Fase B (paridade com o Omie): entrada da nota por item no estoque próprio e projeção no formato do Omie.
-- Depende da 184 (colunas novas) e da Fase A (175 custo_estoque_item_omie, 180/181 lancar_compra, 182 gravar_nota_sefaz).
-- Funções existentes mantêm a assinatura e o resultado para as entradas antigas (corpos de produção por
-- pg_get_functiondef em 18/10/2026 + só o que está marcado "185"):
--   custo_estoque_item_omie: ramo novo só quando o item tem o bloco `sefaz` (nota própria): frete e seguro com as
--     próprias marcações, outras despesas = o resto (HIPÓTESE N3b), CT-e só com Frete = S (HIPÓTESE N8). Item do Omie
--     não tem o bloco: resultado igual ao da 175 (teste scripts/testes-sql/185_omie_intacto.sql).
--   lancar_compra: por item local (R5), quantidade recebida (R4), custo N3 pela projeção ÷ quantidade recebida (R3),
--     "não movimenta estoque" conta como resolvido (R7), manifestação negativa registrada = não entra (R12), eventos.
--     Item sem valor_total_item (compra antiga, compra manual) segue a fórmula da 181 sem mudança.
--   registrar_compra_sefaz, vincular_item_compra, estornar_compra, sincronizar_situacao_nota: + campos novos, eventos,
--     projeção, situações 'conferida' e 'recusada'.
-- Novas: item_compra_full_object, projetar_itens_compra_na_nota, memoria_itens_compra, configurar_item_compra,
--   marcar_compra_conferida (só service_role).
-- Tudo numa transação. Sem a 185 o código novo não consegue configurar/conferir item; o código antigo funciona com ela.

begin;

-- ---------------------------------------------------------------- custo (175 + ramo `sefaz`)
create or replace function public.custo_estoque_item_omie(p_fo jsonb, p_qtde numeric, p_preco numeric)
 returns numeric
 language sql
 immutable parallel safe
as $function$
  with v as (
    select coalesce(p_qtde, 0) * coalesce(p_preco, 0) as fiscal,
           nullif(p_fo->'itensCabec'->>'vTotalItem', '')::numeric as t,
           coalesce(nullif(p_fo->'itensCabec'->>'vDesconto', '')::numeric, 0) as descnt,
           coalesce(nullif(p_fo->'itensIPI'->>'nValIPI', '')::numeric, 0) as ipi,
           coalesce(nullif(p_fo->'itensICMSST'->>'nValorST', '')::numeric, 0) as st,
           coalesce(nullif(p_fo->'itensICMS'->>'nValor', '')::numeric, 0) as icms,
           p_fo->'itensCustoEstoque' as f,
           case when jsonb_typeof(p_fo->'sefaz') = 'object' then p_fo->'sefaz' end as s
  ), d as (
    select v.*, greatest(0, round(t - (fiscal - descnt) - ipi - st, 2)) as despesas,
           coalesce(nullif(s->>'vFrete', '')::numeric, 0) as vfrete,
           coalesce(nullif(s->>'vSeg', '')::numeric, 0) as vseg,
           coalesce(nullif(s->>'freteCte', '')::numeric, 0) as cte
      from v
  ), b as (
    select d.*, t
      - case when coalesce(f->>'cIPICusto', 'N') = 'N' then ipi else 0 end
      - case when coalesce(f->>'cICMSSTCusto', 'N') = 'N' then st else 0 end
      - case when coalesce(f->>'cICMSCusto', 'N') = 'N' then icms else 0 end
      - case when coalesce(f->>'cPISCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredPISCusto', '')::numeric, 0) / 100 else 0 end
      - case when coalesce(f->>'cCOFINSCusto', 'N') = 'N' then t * coalesce(nullif(f->>'nAliqCredCOFINSCusto', '')::numeric, 0) / 100 else 0 end as base
      from d
  )
  select case when f is null or jsonb_typeof(f) <> 'object' or t is null then round(fiscal, 2)
    when s is null then round(base - case when coalesce(f->>'cOutrosDespCusto', 'N') = 'N' then despesas else 0 end, 2)
    else round(base
      - case when coalesce(f->>'cFreteCusto', 'N') = 'N' then vfrete else 0 end
      - case when coalesce(f->>'cSeguroCusto', 'N') = 'N' then vseg else 0 end
      - case when coalesce(f->>'cOutrosDespCusto', 'N') = 'N' then greatest(0, round(despesas - vfrete - vseg, 2)) else 0 end
      + case when coalesce(f->>'cFreteCusto', 'N') = 'N' then 0 else cte end, 2)
  end from b
$function$;

-- ---------------------------------------------------------------- projeção no formato do Omie
create or replace function public.item_compra_full_object(i compras_proprio_itens, p_local_compra bigint)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select case when i.valor_total_item is null then null else jsonb_strip_nulls(jsonb_build_object(
    'itensCabec', jsonb_build_object('vTotalItem', i.valor_total_item, 'vDesconto', i.desconto),
    'itensICMS', jsonb_build_object('cSitTrib', i.fiscal->>'cst', 'cOrigem', i.fiscal->>'origem',
        'nBC', coalesce(nullif(i.fiscal->>'bcIcms', '')::numeric, 0), 'nAliq', coalesce(nullif(i.fiscal->>'aliqIcms', '')::numeric, 0),
        -- HIPÓTESE: no Simples (CSOSN 101/201) o "ICMS" do custo é o crédito do Simples (sem caso real em D1)
        'nValor', case when coalesce(i.icms_valor, 0) = 0 and i.fiscal->>'csosn' in ('101', '201')
                       then coalesce(nullif(i.fiscal->>'credIcmsSn', '')::numeric, 0) else coalesce(i.icms_valor, 0) end),
    'itensICMSSN', case when nullif(i.fiscal->>'csosn', '') is not null then jsonb_build_object('cSitTribSN', i.fiscal->>'csosn') end,
    -- HIPÓTESE: FCP-ST junto da ST (o Omie mostra um só valor de ST no custo)
    'itensICMSST', jsonb_build_object('nBCST', coalesce(nullif(i.fiscal->>'bcSt', '')::numeric, 0), 'nValorST', i.st_valor + i.fcp_st_valor),
    'itensIPI', jsonb_build_object('cSitTribIPI', i.fiscal->>'cstIpi', 'nValIPI', i.ipi_valor),
    'itensPIS', jsonb_build_object('cSitTribPIS', i.fiscal->>'cstPis', 'nValPIS', coalesce(nullif(i.fiscal->>'pis', '')::numeric, 0)),
    'itensCOFINS', jsonb_build_object('cSitTribCOFINS', i.fiscal->>'cstCofins', 'nValCOFINS', coalesce(nullif(i.fiscal->>'cofins', '')::numeric, 0)),
    'itensAjustes', jsonb_build_object(
        'nQtdeRecebida', coalesce(i.quantidade_recebida, i.quantidade * i.fator),
        'cUnidade', i.unidade_estoque,
        'cCFOPEntrada', case when i.cfop_entrada is not null then substr(i.cfop_entrada, 1, 1) || '.' || substr(i.cfop_entrada, 2) end,
        'codigo_local_estoque', coalesce(i.codigo_local_estoque, p_local_compra),
        'cNaoGerarFinanceiro', case when i.gera_conta_pagar then 'N' else 'S' end,
        'cNaoGerarMovEstoque', case when i.movimenta_estoque then 'N' else 'S' end),
    'itensCustoEstoque', case when i.custo_icms is not null then jsonb_build_object(
        'cICMSCusto', case when i.custo_icms then 'S' else 'N' end, 'cICMSSTCusto', case when i.custo_icms_st then 'S' else 'N' end,
        'cIPICusto', case when i.custo_ipi then 'S' else 'N' end, 'cSeguroCusto', case when i.custo_seguro then 'S' else 'N' end,
        'cPISCusto', case when i.custo_pis then 'S' else 'N' end, 'cCOFINSCusto', case when i.custo_cofins then 'S' else 'N' end,
        'cFreteCusto', case when i.custo_frete then 'S' else 'N' end, 'cOutrosDespCusto', case when i.custo_outras then 'S' else 'N' end,
        'nAliqCredPISCusto', i.aliq_cred_pis, 'nAliqCredCOFINSCusto', i.aliq_cred_cofins) end,
    'sefaz', jsonb_build_object('icms', i.icms_valor, 'vFrete', i.frete_valor, 'vSeg', i.seguro_valor, 'vOutro', i.outras_valor,
        'freteCte', i.frete_cte, 'origemFlags', i.origem_flags)
  )) end
$function$;

create or replace function public.projetar_itens_compra_na_nota(p_compra bigint)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c compras_proprio%rowtype; it compras_proprio_itens%rowtype; v_novo jsonb; v_n int := 0; v_k int;
begin
  select * into c from compras_proprio where id = p_compra;
  if not found or c.nota_fiscal_id is null then return 0; end if;
  for it in select * from compras_proprio_itens where compra_id = c.id and valor_total_item is not null order by linha loop
    v_novo := item_compra_full_object(it, c.codigo_local_estoque);
    update nota_fiscal_items nfi
       set full_object = (coalesce(nfi.full_object, '{}'::jsonb) || (v_novo - 'itensCabec'))
                         || jsonb_build_object('itensCabec', coalesce(nfi.full_object->'itensCabec', '{}'::jsonb) || coalesce(v_novo->'itensCabec', '{}'::jsonb)),
           updated_at = now()
     where nfi.loja_id = c.loja_id and nfi.nota_fiscal_id = c.nota_fiscal_id and nfi.n_sequencia = it.linha;
    get diagnostics v_k = row_count;
    v_n := v_n + v_k;
  end loop;
  return v_n;
end $function$;

-- ---------------------------------------------------------------- memória (R1/R5/R6)
create or replace function public.memoria_itens_compra(p_loja bigint, p_cnpj text, p_produtos bigint[], p_cprods text[])
 returns table(tipo text, chave text, flags text, cfop_entrada text, codigo_local_estoque bigint)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with base as (
    select i.*, c.fornecedor_cnpj, coalesce(i.codigo_local_estoque, c.codigo_local_estoque) as local_usado,
           case when i.custo_icms then 'S' else 'N' end || case when i.custo_icms_st then 'S' else 'N' end
           || case when i.custo_ipi then 'S' else 'N' end || case when i.custo_seguro then 'S' else 'N' end
           || case when i.custo_pis then 'S' else 'N' end || case when i.custo_cofins then 'S' else 'N' end
           || case when i.custo_frete then 'S' else 'N' end || case when i.custo_outras then 'S' else 'N' end as txt
      from compras_proprio_itens i join compras_proprio c on c.id = i.compra_id
     where i.loja_id = p_loja and i.lancado and i.custo_icms is not null
  )
  select * from (
    select distinct on (b.codigo_produto) 'produto'::text, b.codigo_produto::text, b.txt, b.cfop_entrada, b.local_usado
      from base b where b.codigo_produto = any (coalesce(p_produtos, '{}'))
     order by b.codigo_produto, b.id desc
  ) p
  union all
  select * from (
    select distinct on (b.c_prod) 'fornecedor'::text, b.c_prod, b.txt, b.cfop_entrada, b.local_usado
      from base b
     where p_cnpj is not null and b.fornecedor_cnpj = regexp_replace(p_cnpj, '\D', '', 'g') and b.c_prod = any (coalesce(p_cprods, '{}'))
     order by b.c_prod, b.id desc
  ) f
$function$;

-- ---------------------------------------------------------------- registrar_compra_sefaz (produção + 185)
create or replace function public.registrar_compra_sefaz(p_compra jsonb, p_local bigint DEFAULT NULL::bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_loja bigint := (p_compra->>'loja_id')::bigint; v_modo text; v_chave text := nullif(btrim(coalesce(p_compra->>'chave_acesso', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_compra->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_comp compras_proprio%rowtype; d record; v_criada boolean := false; v_n int := 0; v_fl text;
begin
  select modo_estoque into v_modo from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', v_loja using errcode = '22023'; end if;
  if v_chave is null then raise exception 'A compra vinda da SEFAZ precisa da chave de acesso' using errcode = '22023'; end if;

  select * into v_comp from compras_proprio where loja_id = v_loja and chave_acesso = v_chave for update;
  if not found then
    insert into compras_proprio (loja_id, origem, chave_acesso, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
        valor_produtos, valor_frete, valor_desconto, valor_total, icms_recuperavel, codigo_local_estoque, nota_fiscal_id, status)
    values (v_loja, 'sefaz', v_chave, p_compra->>'numero', p_compra->>'serie', v_cnpj, p_compra->>'fornecedor_nome', nullif(p_compra->>'emissao', '')::date,
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0),
        coalesce((p_compra->>'valor_frete')::numeric, 0), coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0)
          + coalesce((p_compra->>'valor_frete')::numeric, 0) - coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((p_compra->>'icms_recuperavel')::boolean, false), p_local, nullif(p_compra->>'nota_fiscal_id', '')::bigint, 'pendente')
    returning * into v_comp;
    v_criada := true;
    -- 185: histórico
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
    values (v_loja, v_comp.id, 'criada', jsonb_build_object('origem', 'sefaz', 'itens', jsonb_array_length(coalesce(p_compra->'itens', '[]'::jsonb))), nullif(p_compra->>'user_id', ''));
  else
    update compras_proprio set nota_fiscal_id = coalesce(nota_fiscal_id, nullif(p_compra->>'nota_fiscal_id', '')::bigint),
           codigo_local_estoque = coalesce(codigo_local_estoque, p_local), updated_at = now()
     where id = v_comp.id returning * into v_comp;
  end if;

  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    -- 185: marcações em texto (R1, ordem do Omie); inválidas = sem marcações
    v_fl := upper(coalesce(d.item->>'custo_flags', ''));
    if v_fl !~ '^[SN]{8}$' then v_fl := null; end if;
    insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, ean, descricao, ncm, cfop, unidade_compra, quantidade, valor_unitario,
        valor_total, desconto, icms_valor, fator, codigo_produto, match_origem, match_score, sugestao_codigo_produto,
        valor_total_item, ipi_valor, st_valor, fcp_st_valor, frete_valor, seguro_valor, outras_valor, fiscal, codigo_local_estoque,
        cfop_entrada, origem_cfop, quantidade_recebida, unidade_estoque, custo_icms, custo_icms_st, custo_ipi, custo_seguro, custo_pis,
        custo_cofins, custo_frete, custo_outras, aliq_cred_pis, aliq_cred_cofins, origem_flags, movimenta_estoque, gera_conta_pagar)
    values (v_comp.id, v_loja, coalesce((d.item->>'linha')::int, d.ord), d.item->>'c_prod', d.item->>'ean', d.item->>'descricao', d.item->>'ncm',
        d.item->>'cfop', d.item->>'unidade_compra', coalesce((d.item->>'quantidade')::numeric, 0), coalesce((d.item->>'valor_unitario')::numeric, 0),
        coalesce((d.item->>'valor_total')::numeric, 0), coalesce((d.item->>'desconto')::numeric, 0), coalesce((d.item->>'icms_valor')::numeric, 0),
        coalesce(nullif((d.item->>'fator')::numeric, 0), 1), nullif(d.item->>'codigo_produto', '')::bigint, nullif(d.item->>'match_origem', ''),
        nullif(d.item->>'match_score', '')::numeric, nullif(d.item->>'sugestao_codigo_produto', '')::bigint,
        nullif(d.item->>'valor_total_item', '')::numeric, coalesce(nullif(d.item->>'ipi_valor', '')::numeric, 0),
        coalesce(nullif(d.item->>'st_valor', '')::numeric, 0), coalesce(nullif(d.item->>'fcp_st_valor', '')::numeric, 0),
        coalesce(nullif(d.item->>'frete_valor', '')::numeric, 0), coalesce(nullif(d.item->>'seguro_valor', '')::numeric, 0),
        coalesce(nullif(d.item->>'outras_valor', '')::numeric, 0), case when jsonb_typeof(d.item->'fiscal') = 'object' then d.item->'fiscal' end,
        nullif(d.item->>'codigo_local_estoque', '')::bigint, nullif(regexp_replace(coalesce(d.item->>'cfop_entrada', ''), '\D', '', 'g'), ''),
        nullif(d.item->>'origem_cfop', ''), nullif(d.item->>'quantidade_recebida', '')::numeric, nullif(d.item->>'unidade_estoque', ''),
        substr(v_fl, 1, 1) = 'S', substr(v_fl, 2, 1) = 'S', substr(v_fl, 3, 1) = 'S', substr(v_fl, 4, 1) = 'S',
        substr(v_fl, 5, 1) = 'S', substr(v_fl, 6, 1) = 'S', substr(v_fl, 7, 1) = 'S', substr(v_fl, 8, 1) = 'S',
        coalesce(nullif(d.item->>'aliq_cred_pis', '')::numeric, 0), coalesce(nullif(d.item->>'aliq_cred_cofins', '')::numeric, 0),
        case when v_fl is not null then coalesce(nullif(d.item->>'origem_flags', ''), 'padrao') end,
        coalesce((d.item->>'movimenta_estoque')::boolean, true), coalesce((d.item->>'gera_conta_pagar')::boolean, true))
    on conflict (compra_id, linha) do update set
        match_origem = coalesce(compras_proprio_itens.match_origem, excluded.match_origem),
        match_score = coalesce(compras_proprio_itens.match_score, excluded.match_score),
        sugestao_codigo_produto = coalesce(compras_proprio_itens.sugestao_codigo_produto, excluded.sugestao_codigo_produto),
        codigo_produto = coalesce(compras_proprio_itens.codigo_produto, excluded.codigo_produto),
        fator = case when compras_proprio_itens.codigo_produto is null and excluded.codigo_produto is not null then excluded.fator else compras_proprio_itens.fator end,
        -- 185: valores fiscais vêm da nota nova; a configuração que já existe fica (nada volta para a sugestão)
        valor_total_item = excluded.valor_total_item, ipi_valor = excluded.ipi_valor, st_valor = excluded.st_valor,
        fcp_st_valor = excluded.fcp_st_valor, frete_valor = excluded.frete_valor, seguro_valor = excluded.seguro_valor,
        outras_valor = excluded.outras_valor, fiscal = coalesce(excluded.fiscal, compras_proprio_itens.fiscal),
        codigo_local_estoque = coalesce(compras_proprio_itens.codigo_local_estoque, excluded.codigo_local_estoque),
        cfop_entrada = coalesce(compras_proprio_itens.cfop_entrada, excluded.cfop_entrada),
        origem_cfop = case when compras_proprio_itens.cfop_entrada is not null then compras_proprio_itens.origem_cfop else excluded.origem_cfop end,
        quantidade_recebida = coalesce(compras_proprio_itens.quantidade_recebida, excluded.quantidade_recebida),
        unidade_estoque = coalesce(compras_proprio_itens.unidade_estoque, excluded.unidade_estoque),
        custo_icms = case when compras_proprio_itens.custo_icms is null then excluded.custo_icms else compras_proprio_itens.custo_icms end,
        custo_icms_st = case when compras_proprio_itens.custo_icms is null then excluded.custo_icms_st else compras_proprio_itens.custo_icms_st end,
        custo_ipi = case when compras_proprio_itens.custo_icms is null then excluded.custo_ipi else compras_proprio_itens.custo_ipi end,
        custo_seguro = case when compras_proprio_itens.custo_icms is null then excluded.custo_seguro else compras_proprio_itens.custo_seguro end,
        custo_pis = case when compras_proprio_itens.custo_icms is null then excluded.custo_pis else compras_proprio_itens.custo_pis end,
        custo_cofins = case when compras_proprio_itens.custo_icms is null then excluded.custo_cofins else compras_proprio_itens.custo_cofins end,
        custo_frete = case when compras_proprio_itens.custo_icms is null then excluded.custo_frete else compras_proprio_itens.custo_frete end,
        custo_outras = case when compras_proprio_itens.custo_icms is null then excluded.custo_outras else compras_proprio_itens.custo_outras end,
        origem_flags = case when compras_proprio_itens.custo_icms is null then excluded.origem_flags else compras_proprio_itens.origem_flags end,
        -- colunas com padrão (não nulas): ficam as atuais só quando o item já foi configurado na Fase B (origem_flags)
        aliq_cred_pis = case when compras_proprio_itens.origem_flags is null then excluded.aliq_cred_pis else compras_proprio_itens.aliq_cred_pis end,
        aliq_cred_cofins = case when compras_proprio_itens.origem_flags is null then excluded.aliq_cred_cofins else compras_proprio_itens.aliq_cred_cofins end,
        movimenta_estoque = case when compras_proprio_itens.origem_flags is null then excluded.movimenta_estoque else compras_proprio_itens.movimenta_estoque end,
        gera_conta_pagar = case when compras_proprio_itens.origem_flags is null then excluded.gera_conta_pagar else compras_proprio_itens.gera_conta_pagar end
      where not compras_proprio_itens.lancado;
    v_n := v_n + 1;
  end loop;

  perform projetar_itens_compra_na_nota(v_comp.id); -- 185
  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'criada', v_criada, 'status', v_comp.status, 'itens', v_n);
end $function$;

-- ---------------------------------------------------------------- configurar / conferir (novas)
create or replace function public.configurar_item_compra(p_loja bigint, p_item bigint, p_cfg jsonb, p_user text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i compras_proprio_itens%rowtype; c compras_proprio%rowtype; v_de jsonb := '{}'::jsonb; v_para jsonb := '{}'::jsonb;
  v_local bigint; v_cfop text; v_qtd numeric; v_fl text; v_aliq numeric; v_txt_atual text; k text;
begin
  select * into i from compras_proprio_itens where id = p_item and loja_id = p_loja for update;
  if not found then raise exception 'Item não encontrado' using errcode = '22023'; end if;
  if i.lancado then raise exception 'Item já lançado no estoque: desfaça a entrada para mudar' using errcode = '22023'; end if;
  select * into c from compras_proprio where id = i.compra_id for update;

  if p_cfg ? 'codigo_local_estoque' then
    v_local := nullif(p_cfg->>'codigo_local_estoque', '')::bigint;
    if v_local is not null and not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = v_local
                                            and deleted_at is null and coalesce(inativo, 'N') <> 'S') then
      raise exception 'Local de estoque % inválido ou inativo', v_local using errcode = '22023';
    end if;
    v_de := v_de || jsonb_build_object('codigo_local_estoque', i.codigo_local_estoque); v_para := v_para || jsonb_build_object('codigo_local_estoque', v_local);
    i.codigo_local_estoque := v_local;
  end if;
  if p_cfg ? 'cfop_entrada' then
    v_cfop := nullif(regexp_replace(coalesce(p_cfg->>'cfop_entrada', ''), '\D', '', 'g'), '');
    if v_cfop is not null and v_cfop !~ '^[123][0-9]{3}$' then raise exception 'CFOP de entrada inválido: %', v_cfop using errcode = '22023'; end if;
    v_de := v_de || jsonb_build_object('cfop_entrada', i.cfop_entrada); v_para := v_para || jsonb_build_object('cfop_entrada', v_cfop);
    i.cfop_entrada := v_cfop; i.origem_cfop := case when v_cfop is null then null else 'manual' end;
  end if;
  if p_cfg ? 'quantidade_recebida' then
    v_qtd := nullif(p_cfg->>'quantidade_recebida', '')::numeric;
    if v_qtd is not null and v_qtd <= 0 then raise exception 'A quantidade recebida precisa ser maior que zero' using errcode = '22023'; end if;
    v_de := v_de || jsonb_build_object('quantidade_recebida', i.quantidade_recebida); v_para := v_para || jsonb_build_object('quantidade_recebida', v_qtd);
    i.quantidade_recebida := v_qtd;
  end if;
  if p_cfg ? 'unidade_estoque' then
    v_de := v_de || jsonb_build_object('unidade_estoque', i.unidade_estoque); v_para := v_para || jsonb_build_object('unidade_estoque', nullif(btrim(p_cfg->>'unidade_estoque'), ''));
    i.unidade_estoque := nullif(btrim(p_cfg->>'unidade_estoque'), '');
  end if;
  if p_cfg ? 'custo_flags' then
    v_fl := upper(coalesce(p_cfg->>'custo_flags', ''));
    if v_fl !~ '^[SN]{8}$' then raise exception 'Marcações de custo inválidas' using errcode = '22023'; end if;
    v_txt_atual := case when i.custo_icms is null then null else
      case when i.custo_icms then 'S' else 'N' end || case when i.custo_icms_st then 'S' else 'N' end || case when i.custo_ipi then 'S' else 'N' end
      || case when i.custo_seguro then 'S' else 'N' end || case when i.custo_pis then 'S' else 'N' end || case when i.custo_cofins then 'S' else 'N' end
      || case when i.custo_frete then 'S' else 'N' end || case when i.custo_outras then 'S' else 'N' end end;
    v_de := v_de || jsonb_build_object('custo_flags', v_txt_atual); v_para := v_para || jsonb_build_object('custo_flags', v_fl);
    i.custo_icms := substr(v_fl, 1, 1) = 'S'; i.custo_icms_st := substr(v_fl, 2, 1) = 'S'; i.custo_ipi := substr(v_fl, 3, 1) = 'S';
    i.custo_seguro := substr(v_fl, 4, 1) = 'S'; i.custo_pis := substr(v_fl, 5, 1) = 'S'; i.custo_cofins := substr(v_fl, 6, 1) = 'S';
    i.custo_frete := substr(v_fl, 7, 1) = 'S'; i.custo_outras := substr(v_fl, 8, 1) = 'S'; i.origem_flags := 'manual';
  end if;
  foreach k in array array['aliq_cred_pis', 'aliq_cred_cofins'] loop
    if p_cfg ? k then
      v_aliq := coalesce(nullif(p_cfg->>k, '')::numeric, 0);
      if v_aliq < 0 or v_aliq > 100 then raise exception 'Alíquota de crédito fora de 0 a 100 %%' using errcode = '22023'; end if;
      if k = 'aliq_cred_pis' then v_de := v_de || jsonb_build_object(k, i.aliq_cred_pis); i.aliq_cred_pis := v_aliq;
      else v_de := v_de || jsonb_build_object(k, i.aliq_cred_cofins); i.aliq_cred_cofins := v_aliq; end if;
      v_para := v_para || jsonb_build_object(k, v_aliq);
    end if;
  end loop;
  if p_cfg ? 'movimenta_estoque' then
    v_de := v_de || jsonb_build_object('movimenta_estoque', i.movimenta_estoque); v_para := v_para || jsonb_build_object('movimenta_estoque', (p_cfg->>'movimenta_estoque')::boolean);
    i.movimenta_estoque := coalesce((p_cfg->>'movimenta_estoque')::boolean, true);
  end if;
  if p_cfg ? 'gera_conta_pagar' then
    v_de := v_de || jsonb_build_object('gera_conta_pagar', i.gera_conta_pagar); v_para := v_para || jsonb_build_object('gera_conta_pagar', (p_cfg->>'gera_conta_pagar')::boolean);
    i.gera_conta_pagar := coalesce((p_cfg->>'gera_conta_pagar')::boolean, true);
  end if;

  update compras_proprio_itens set codigo_local_estoque = i.codigo_local_estoque, cfop_entrada = i.cfop_entrada, origem_cfop = i.origem_cfop,
         quantidade_recebida = i.quantidade_recebida, unidade_estoque = i.unidade_estoque, custo_icms = i.custo_icms, custo_icms_st = i.custo_icms_st,
         custo_ipi = i.custo_ipi, custo_seguro = i.custo_seguro, custo_pis = i.custo_pis, custo_cofins = i.custo_cofins, custo_frete = i.custo_frete,
         custo_outras = i.custo_outras, origem_flags = i.origem_flags, aliq_cred_pis = i.aliq_cred_pis, aliq_cred_cofins = i.aliq_cred_cofins,
         movimenta_estoque = i.movimenta_estoque, gera_conta_pagar = i.gera_conta_pagar
   where id = i.id;
  -- mudar qualquer item depois de conferida volta para "a conferir" (R9)
  update compras_proprio set conferida_em = null, conferida_por = null, updated_at = now() where id = c.id;
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, linha, detalhe, user_id)
  values (p_loja, c.id, 'item_configurado', i.linha, jsonb_build_object('de', v_de, 'para', v_para), p_user);
  perform projetar_itens_compra_na_nota(c.id);
  return jsonb_build_object('ok', true, 'compra_id', c.id, 'nota_id', c.nota_fiscal_id);
end $function$;

create or replace function public.marcar_compra_conferida(p_loja bigint, p_compra bigint, p_user text default null, p_detalhe jsonb default '{}'::jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c compras_proprio%rowtype; v_pend jsonb;
begin
  select * into c from compras_proprio where id = p_compra and loja_id = p_loja for update;
  if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  if c.status not in ('pendente', 'parcial') then raise exception 'Só nota pendente de entrada pode ser marcada como conferida' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('linha', x.linha, 'motivo', x.motivo) order by x.linha), '[]'::jsonb) into v_pend from (
    select i.linha,
           case when i.codigo_produto is null or not exists (select 1 from produtos p where p.loja_id = p_loja and p.codigo_produto = i.codigo_produto) then 'sem_produto'
                when not exists (select 1 from local_estoques l where l.loja_id = p_loja and l.codigo_local_estoque = coalesce(i.codigo_local_estoque, c.codigo_local_estoque)
                                   and l.deleted_at is null and coalesce(l.inativo, 'N') <> 'S') then 'local_invalido'
                when coalesce(i.quantidade_recebida, i.quantidade * i.fator) <= 0 then 'quantidade_zero' end as motivo
      from compras_proprio_itens i
     where i.compra_id = c.id and not i.lancado and i.movimenta_estoque
  ) x where x.motivo is not null;
  if jsonb_array_length(v_pend) > 0 then return jsonb_build_object('ok', false, 'pendencias', v_pend); end if;
  update compras_proprio set conferida_em = now(), conferida_por = p_user, updated_at = now() where id = c.id;
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id) values (p_loja, c.id, 'conferida', coalesce(p_detalhe, '{}'::jsonb), p_user);
  if c.nota_fiscal_id is not null then perform sincronizar_situacao_nota(p_loja, c.nota_fiscal_id); end if;
  return jsonb_build_object('ok', true, 'compra_id', c.id, 'nota_id', c.nota_fiscal_id);
end $function$;

-- ---------------------------------------------------------------- vincular_item_compra (produção + 185)
create or replace function public.vincular_item_compra(p_loja bigint, p_compra_item bigint, p_produto bigint, p_fator numeric DEFAULT 1, p_user text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare i compras_proprio_itens%rowtype; c compras_proprio%rowtype;
begin
  select * into i from compras_proprio_itens where id = p_compra_item and loja_id = p_loja for update;
  if not found then raise exception 'Item não encontrado' using errcode = '22023'; end if;
  if i.lancado then raise exception 'Item já lançado no estoque' using errcode = '22023'; end if;
  if not exists (select 1 from produtos where loja_id = p_loja and codigo_produto = p_produto) then raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023'; end if;
  if p_fator is null or p_fator <= 0 then raise exception 'Fator de conversão inválido' using errcode = '22023'; end if;
  select * into c from compras_proprio where id = i.compra_id;
  update compras_proprio_itens set codigo_produto = p_produto, fator = p_fator, match_origem = 'manual', match_score = 1,
         unidade_estoque = coalesce(unidade_estoque, (select p.unidade from produtos p where p.loja_id = p_loja and p.codigo_produto = p_produto limit 1)) -- 185
   where id = i.id;
  if c.fornecedor_cnpj is not null and i.c_prod is not null then
    insert into fornecedor_produto_depara (loja_id, fornecedor_cnpj, c_prod, codigo_produto, fator, unidade_compra)
    values (p_loja, c.fornecedor_cnpj, i.c_prod, p_produto, p_fator, i.unidade_compra)
    on conflict (loja_id, fornecedor_cnpj, c_prod) do update set codigo_produto = excluded.codigo_produto, fator = excluded.fator,
         unidade_compra = excluded.unidade_compra, updated_at = now();
  end if;
  -- espelha no item da nota (relatórios e tela de detalhe)
  update nota_fiscal_items nfi set n_id_produto = p_produto, produto_codigo = p_produto::text, updated_at = now()
   where nfi.loja_id = p_loja and nfi.nota_fiscal_id = c.nota_fiscal_id and nfi.n_sequencia = i.linha;
  -- 185: mexer no item tira a conferência; histórico; projeção
  update compras_proprio set conferida_em = null, conferida_por = null, updated_at = now() where id = c.id;
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, linha, detalhe, user_id)
  values (p_loja, c.id, 'item_vinculado', i.linha, jsonb_build_object('codigo_produto', p_produto, 'fator', p_fator, 'antes', i.codigo_produto), p_user);
  perform projetar_itens_compra_na_nota(c.id);
  return jsonb_build_object('ok', true, 'compra_id', c.id, 'nota_id', c.nota_fiscal_id);
end $function$;

-- ---------------------------------------------------------------- lancar_compra (181 + 185)
create or replace function public.lancar_compra(p_compra jsonb, p_local bigint, p_user text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_loja bigint := (p_compra->>'loja_id')::bigint;
  v_modo text; v_chave text := nullif(btrim(coalesce(p_compra->>'chave_acesso', '')), '');
  v_cnpj text := nullif(regexp_replace(coalesce(p_compra->>'fornecedor_cnpj', ''), '\D', '', 'g'), '');
  v_comp compras_proprio%rowtype; d record; it compras_proprio_itens%rowtype;
  v_total_liq numeric; v_n int; v_share numeric; v_custo_total numeric; v_qtd_base numeric; v_custo_unit numeric;
  v_ref text; r jsonb; v_lanc int := 0; v_pend int := 0; v_ja int := 0; v_saida jsonb := '[]'::jsonb; v_status text;
  v_nitens int; v_tinha_pendente boolean;
  v_idem text := lower(nullif(btrim(coalesce(p_compra->>'chave_idempotencia', '')), ''));
  v_ign int := 0; v_local bigint; -- 185
begin
  select modo_estoque into v_modo from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', v_loja using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = v_loja and codigo_local_estoque = p_local) then
    raise exception 'Local de estoque % inexistente', p_local using errcode = '22023';
  end if;

  -- 180: nota cancelada na SEFAZ (evento já recebido ou nota marcada) nunca entra; compra já lançada é estornada.
  if v_chave is not null and (exists (select 1 from sefaz_chaves_canceladas where loja_id = v_loja and chave = v_chave)
      or exists (select 1 from notas_fiscais where loja_id = v_loja and c_chave_nfe = v_chave and deleted_at is null
                 and coalesce(full_object->'infoCadastro'->>'cCancelada', 'N') = 'S')) then
    perform sefaz_marcar_cancelada(v_loja, v_chave);
    return jsonb_build_object('ok', false, 'compra_id', (select id from compras_proprio where loja_id = v_loja and chave_acesso = v_chave),
                              'status', 'cancelada', 'lancados', 0, 'pendentes', 0, 'duplicado', false, 'motivo', 'nota cancelada na SEFAZ');
  end if;

  -- 181: mesma chave de idempotência = a mesma compra manual enviada de novo (duplo clique, fila do desktop): não toca em nada.
  if v_idem is not null then
    select * into v_comp from compras_proprio where loja_id = v_loja and chave_idempotencia = v_idem;
    if found then
      return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_comp.status, 'lancados', 0, 'ja_lancados', 0,
                                'pendentes', 0, 'duplicado', true, 'itens', '[]'::jsonb);
    end if;
  end if;

  -- compra existente (por id ou por chave) ou nova
  if nullif(p_compra->>'id', '') is not null then
    select * into v_comp from compras_proprio where id = (p_compra->>'id')::bigint and loja_id = v_loja for update;
    if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  elsif v_chave is not null then
    select * into v_comp from compras_proprio where loja_id = v_loja and chave_acesso = v_chave for update;
  end if;
  if v_comp.id is null then
    insert into compras_proprio (loja_id, origem, chave_acesso, numero, serie, fornecedor_cnpj, fornecedor_nome, emissao,
        valor_produtos, valor_frete, valor_desconto, valor_total, icms_recuperavel, codigo_local_estoque, user_id, obs, chave_idempotencia)
    values (v_loja, coalesce(p_compra->>'origem', case when v_chave is null then 'manual' else 'xml' end), v_chave,
        p_compra->>'numero', p_compra->>'serie', v_cnpj, p_compra->>'fornecedor_nome', nullif(p_compra->>'emissao', '')::date,
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0),
        coalesce((p_compra->>'valor_frete')::numeric, 0), coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((select sum(coalesce((x->>'valor_total')::numeric, 0) - coalesce((x->>'desconto')::numeric, 0)) from jsonb_array_elements(p_compra->'itens') x), 0)
          + coalesce((p_compra->>'valor_frete')::numeric, 0) - coalesce((p_compra->>'valor_desconto')::numeric, 0),
        coalesce((p_compra->>'icms_recuperavel')::boolean, false), p_local, p_user, p_compra->>'obs', v_idem)
    returning * into v_comp;
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id) -- 185
    values (v_loja, v_comp.id, 'criada', jsonb_build_object('origem', v_comp.origem), p_user);
  elsif v_comp.status = 'cancelada' then
    raise exception 'Compra cancelada não pode ser lançada de novo' using errcode = '22023';
  end if;

  -- 180: a mesma checagem para a compra achada pelo id (caminho real da SEFAZ e do "Confirmar entrada", que mandam
  -- só o id, sem a chave no payload).
  if v_comp.chave_acesso is not null and (exists (select 1 from sefaz_chaves_canceladas where loja_id = v_loja and chave = v_comp.chave_acesso)
      or exists (select 1 from notas_fiscais where loja_id = v_loja and c_chave_nfe = v_comp.chave_acesso and deleted_at is null
                 and coalesce(full_object->'infoCadastro'->>'cCancelada', 'N') = 'S')) then
    perform sefaz_marcar_cancelada(v_loja, v_comp.chave_acesso);
    return jsonb_build_object('ok', false, 'compra_id', v_comp.id, 'status', 'cancelada', 'lancados', 0, 'pendentes', 0,
                              'duplicado', false, 'motivo', 'nota cancelada na SEFAZ');
  end if;

  -- 185: manifestação negativa (desconhecimento / operação não realizada) registrada na SEFAZ = não entra (R12)
  if v_comp.chave_acesso is not null and exists (select 1 from sefaz_manifestacoes where loja_id = v_loja and chave = v_comp.chave_acesso
       and tp_evento in ('210220', '210240') and status = 'registrada') then
    return jsonb_build_object('ok', false, 'compra_id', v_comp.id, 'status', 'recusada', 'lancados', 0, 'pendentes', 0, 'ignorados', 0,
                              'duplicado', false, 'motivo', 'operação recusada na SEFAZ');
  end if;

  -- itens: cria os que faltam; nos já existentes só atualiza o mapeamento (e só se ainda não lançados)
  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, ean, descricao, ncm, cfop, unidade_compra,
        quantidade, valor_unitario, valor_total, desconto, icms_valor, fator, codigo_produto)
    values (v_comp.id, v_loja, coalesce((d.item->>'linha')::int, d.ord), d.item->>'c_prod', d.item->>'ean', d.item->>'descricao',
        d.item->>'ncm', d.item->>'cfop', d.item->>'unidade_compra', coalesce((d.item->>'quantidade')::numeric, 0),
        coalesce((d.item->>'valor_unitario')::numeric, 0), coalesce((d.item->>'valor_total')::numeric, 0),
        coalesce((d.item->>'desconto')::numeric, 0), coalesce((d.item->>'icms_valor')::numeric, 0),
        coalesce(nullif((d.item->>'fator')::numeric, 0), 1), nullif(d.item->>'codigo_produto', '')::bigint)
    on conflict (compra_id, linha) do update
      set codigo_produto = coalesce(excluded.codigo_produto, compras_proprio_itens.codigo_produto),
          fator = case when excluded.codigo_produto is not null then excluded.fator else compras_proprio_itens.fator end
      where not compras_proprio_itens.lancado;
  end loop;

  -- completa o mapeamento pelo de-para do fornecedor
  if v_cnpj is null then v_cnpj := v_comp.fornecedor_cnpj; end if;
  if v_cnpj is not null then
    update compras_proprio_itens i set codigo_produto = dp.codigo_produto, fator = dp.fator
      from fornecedor_produto_depara dp
     where i.compra_id = v_comp.id and not i.lancado and i.codigo_produto is null and i.c_prod is not null
       and dp.loja_id = v_loja and dp.fornecedor_cnpj = v_cnpj and dp.c_prod = i.c_prod;
  end if;

  -- rateio estável: base = valor líquido de TODOS os itens (não depende da ordem de mapeamento)
  select coalesce(sum(valor_total - desconto), 0), count(*) into v_total_liq, v_n from compras_proprio_itens where compra_id = v_comp.id;
  v_ref := coalesce(v_comp.chave_acesso, 'compra:' || v_comp.id);

  for it in select * from compras_proprio_itens where compra_id = v_comp.id order by linha loop
    if it.lancado then v_ja := v_ja + 1; continue; end if;
    -- 185: "não movimenta estoque" (NF complementar, valor zero, ignorar item) conta como resolvido (R7)
    if not it.movimenta_estoque then
      v_ign := v_ign + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', true, 'ignorado', true);
      continue;
    end if;
    -- 185: local por item (R5); o local próprio do item precisa existir e estar ativo
    v_local := coalesce(it.codigo_local_estoque, p_local);
    if it.codigo_local_estoque is not null and not exists (select 1 from local_estoques where loja_id = v_loja and codigo_local_estoque = v_local
                                                            and deleted_at is null and coalesce(inativo, 'N') <> 'S') then
      v_pend := v_pend + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', false, 'motivo', 'local_invalido');
      continue;
    end if;
    -- 185: quantidade recebida em unidade de estoque (R4); padrão = quantidade da nota × fator
    v_qtd_base := coalesce(it.quantidade_recebida, it.quantidade * it.fator);
    if it.codigo_produto is null or v_qtd_base <= 0
       or not exists (select 1 from produtos where loja_id = v_loja and codigo_produto = it.codigo_produto) then
      v_pend := v_pend + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', false,
          'motivo', case when it.codigo_produto is null then 'sem_produto' when v_qtd_base <= 0 then 'quantidade_zero' else 'produto_inexistente' end);
      continue;
    end if;
    if it.valor_total_item is null then
      -- caminho antigo (compra antiga, compra manual): fórmula da 181, intacta
      v_share := case when v_total_liq > 0 then (it.valor_total - it.desconto) / v_total_liq else 1.0 / greatest(v_n, 1) end;
      v_custo_total := (it.valor_total - it.desconto) + v_comp.valor_frete * v_share - v_comp.valor_desconto * v_share
                       - case when v_comp.icms_recuperavel then it.icms_valor else 0 end;
    else
      -- 185: regra N3 pela mesma função dos relatórios (R3), sobre a projeção do item
      v_custo_total := custo_estoque_item_omie(item_compra_full_object(it, p_local), it.quantidade, it.valor_unitario);
    end if;
    v_custo_unit := round(v_custo_total / v_qtd_base, 6);
    r := registrar_movimento(v_loja, v_local, it.codigo_produto, 'ENT', 'COMPRA', v_ref, v_qtd_base,
                             case when v_custo_unit > 0 then v_custo_unit else null end, p_user,
                             'Compra ' || coalesce(v_comp.numero, v_comp.id::text), it.linha, null, null, null);
    update compras_proprio_itens set lancado = true, movimento_id = (r->>'id')::bigint, custo_unitario_base = v_custo_unit where id = it.id;
    if v_cnpj is not null and it.c_prod is not null then
      insert into fornecedor_produto_depara (loja_id, fornecedor_cnpj, c_prod, codigo_produto, fator, unidade_compra)
      values (v_loja, v_cnpj, it.c_prod, it.codigo_produto, it.fator, it.unidade_compra)
      on conflict (loja_id, fornecedor_cnpj, c_prod) do update
        set codigo_produto = excluded.codigo_produto, fator = excluded.fator, unidade_compra = excluded.unidade_compra, updated_at = now();
    end if;
    v_lanc := v_lanc + 1;
    v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', true, 'saldo', r->'saldo', 'cmc', r->'cmc',
                                             'custo_unitario_base', v_custo_unit, 'duplicado', r->'duplicado');
  end loop;

  select count(*) into v_nitens from compras_proprio_itens where compra_id = v_comp.id;
  -- 185: resolvidos = lançados + já lançados + "não movimenta"
  v_status := case when v_nitens = 0 or ((v_lanc + v_ja) = 0 and v_ign < v_nitens) then 'pendente'
                   when (v_lanc + v_ja + v_ign) = v_nitens then 'lancada' else 'parcial' end;
  update compras_proprio set status = v_status, codigo_local_estoque = p_local, updated_at = now(),
         lancada_em = case when v_status = 'lancada' then coalesce(lancada_em, now()) else lancada_em end
   where id = v_comp.id;

  if v_lanc > 0 then -- 185
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
    values (v_loja, v_comp.id, 'lancada', jsonb_build_object('lancados', v_lanc, 'ignorados', v_ign, 'pendentes', v_pend), p_user);
  end if;
  perform projetar_itens_compra_na_nota(v_comp.id); -- 185

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_status, 'lancados', v_lanc, 'ja_lancados', v_ja,
                            'pendentes', v_pend, 'ignorados', v_ign, 'duplicado', (v_lanc = 0 and v_ja > 0 and v_pend = 0), 'itens', v_saida);
end $function$;

-- ---------------------------------------------------------------- estornar_compra (produção + 185)
create or replace function public.estornar_compra(p_compra_id bigint, p_user text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare c compras_proprio%rowtype; i record; n int := 0;
begin
  select * into c from compras_proprio where id = p_compra_id for update;
  if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  if c.status = 'cancelada' then return jsonb_build_object('ok', true, 'estornados', 0, 'duplicado', true); end if;
  for i in select * from compras_proprio_itens where compra_id = c.id and lancado and movimento_id is not null order by linha loop
    perform estornar_movimento(i.movimento_id, p_user, 'Estorno da compra ' || coalesce(c.numero, c.id::text));
    update compras_proprio_itens set lancado = false where id = i.id;
    n := n + 1;
  end loop;
  update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id) -- 185
  values (c.loja_id, c.id, 'estornada', jsonb_build_object('estornados', n), p_user);
  perform projetar_itens_compra_na_nota(c.id);
  return jsonb_build_object('ok', true, 'estornados', n, 'duplicado', false);
end $function$;

-- ---------------------------------------------------------------- sincronizar_situacao_nota (produção + 185)
create or replace function public.sincronizar_situacao_nota(p_loja bigint, p_nota bigint)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n notas_fiscais%rowtype; c compras_proprio%rowtype; v_sit text; v_etapa text := '40'; v_itens int; v_ic jsonb; v_alertas int;
  v_recusada boolean; -- 185
begin
  select * into n from notas_fiscais where id = p_nota and loja_id = p_loja;
  if not found then return null; end if;
  select * into c from compras_proprio where loja_id = p_loja and nota_fiscal_id = p_nota limit 1;
  if c.id is null and n.c_chave_nfe is not null then select * into c from compras_proprio where loja_id = p_loja and chave_acesso = n.c_chave_nfe limit 1; end if;
  select count(*) into v_itens from nota_fiscal_items where nota_fiscal_id = n.id;
  v_alertas := coalesce(jsonb_array_length(n.full_object->'sefaz'->'alertas'), 0);
  v_recusada := n.c_chave_nfe is not null and exists (select 1 from sefaz_manifestacoes m where m.loja_id = p_loja and m.chave = n.c_chave_nfe
                  and m.tp_evento in ('210220', '210240') and m.status = 'registrada');

  -- 185: ordem estornada → lançada → parcial → recusada → conferida → divergente → a conferir
  if v_itens = 0 and c.id is null then v_sit := 'resumo';
  elsif c.id is null then v_sit := case when v_recusada then 'recusada' else 'a_conferir' end;
  elsif c.status = 'cancelada' then v_sit := 'estornada';
  elsif c.status = 'lancada' then v_sit := 'lancada'; v_etapa := '60';
  elsif c.status = 'parcial' then v_sit := 'parcial';
  elsif v_recusada then v_sit := 'recusada';
  elsif c.conferida_em is not null then v_sit := 'conferida';
  elsif v_alertas > 0 then v_sit := 'divergente';
  else v_sit := 'a_conferir'; end if;

  v_ic := coalesce(n.full_object->'infoCadastro', '{}'::jsonb);
  if v_etapa = '60' then
    v_ic := v_ic || jsonb_build_object('cRecebido', 'S',
        'dRec', coalesce(v_ic->>'dRec', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')),
        'hRec', coalesce(v_ic->>'hRec', to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI:SS')),
        'cUsuarioRec', coalesce(v_ic->>'cUsuarioRec', 'Norte Estoque'));
  else
    v_ic := (v_ic - 'dRec' - 'hRec' - 'cUsuarioRec') || jsonb_build_object('cRecebido', 'N');
  end if;

  update notas_fiscais set c_etapa = v_etapa, updated_at = now(),
         full_object = jsonb_set(jsonb_set(coalesce(full_object, '{}'::jsonb), '{infoCadastro}', v_ic, true), '{sefaz,situacao}', to_jsonb(v_sit), true)
   where id = n.id;
  return v_sit;
end $function$;

-- ---------------------------------------------------------------- permissões das funções novas
revoke all on function public.item_compra_full_object(compras_proprio_itens, bigint) from public, anon, authenticated;
revoke all on function public.projetar_itens_compra_na_nota(bigint) from public, anon, authenticated;
revoke all on function public.memoria_itens_compra(bigint, text, bigint[], text[]) from public, anon, authenticated;
revoke all on function public.configurar_item_compra(bigint, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.marcar_compra_conferida(bigint, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.item_compra_full_object(compras_proprio_itens, bigint) to service_role;
grant execute on function public.projetar_itens_compra_na_nota(bigint) to service_role;
grant execute on function public.memoria_itens_compra(bigint, text, bigint[], text[]) to service_role;
grant execute on function public.configurar_item_compra(bigint, bigint, jsonb, text) to service_role;
grant execute on function public.marcar_compra_conferida(bigint, bigint, text, jsonb) to service_role;
-- custo_estoque_item_omie mantém o grant da 175 (create or replace não muda os privilégios)

commit;

notify pgrst, 'reload schema';
