-- 313 — Entrada da compra na data da nota + reprocessamento do custo (Norte ERP, custo certo, Task 3, 04/11/2026).
-- Depende da 311 e da 312.
--
-- Antes: a entrada da nota valia na data do LANÇAMENTO (ODARA: 525 vendas de outubro sem custo porque as notas de outubro
-- foram lançadas em 02/11). Agora:
--   * _data_entrada_compra: data de saída/entrada da nota (dhSaiEnt/dSaiEnt do XML guardado em sefaz_documentos), senão a
--     emissão da compra, senão hoje; nunca no futuro; nunca antes do 1º movimento do ledger da loja; nunca dentro de mês
--     fechado (vale o 1º dia aberto e a compra ganha o aviso, no retorno e no evento 'lancada'). p_compra.data_entrada,
--     se vier, substitui a data da nota (mesmas travas).
--   * lancar_compra: corpo copiado de pg_get_functiondef em PRODUÇÃO (04/11/2026, versão da 185); mudou só: data da
--     entrada no registrar_movimento, evento com data/aviso, e no fim reprocessar_custo(loja, produtos lançados, data,
--     'compra <chave>') na mesma transação. Retorno ganha data_entrada, avisos, reprocessamento.
--   * estornar_compra: corpo de PRODUÇÃO (versão da 185); depois dos estornos chama reprocessar_custo desde a data efetiva
--     da entrada (o par sai da cadeia). Retorno ganha reprocessamento.
-- Assinaturas iguais: lancar_compra_com_lotes (145) e o TS (nf-sefaz.ts, nota-fiscal-proprio.ts, compras-proprio.ts)
-- não mudam.
--
-- Teste: scripts/testes-sql/313_compra_data_da_nota.sql (cópia local, BEGIN … ROLLBACK). Aplicar com -1 depois de 01:00:
--   node scripts/aplicar-migration.mjs supabase/migrations/313_compra_data_da_nota.sql
-- Conferir: \df lancar_compra e \df estornar_compra (1 overload cada).

create or replace function public._data_entrada_compra(p_loja bigint, p_compra bigint, p_pedida date default null)
returns table (data date, aviso text)
language plpgsql stable security definer set search_path = public as $$
declare c compras_proprio%rowtype; v date; v_xml text; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
        v_ini date; v_fech date; v_aberto date; v_aviso text;
begin
  select * into c from compras_proprio where id = p_compra and loja_id = p_loja;
  v := p_pedida;
  if v is null and c.chave_acesso is not null then
    select d.xml into v_xml from sefaz_documentos d
     where d.loja_id = p_loja and d.chave = c.chave_acesso and d.completo and d.xml is not null
     order by d.id desc limit 1;
    v := coalesce(substring(v_xml from '<dhSaiEnt>(\d{4}-\d{2}-\d{2})'), substring(v_xml from '<dSaiEnt>(\d{4}-\d{2}-\d{2})'))::date;
  end if;
  v := coalesce(v, c.emissao, v_hoje);
  if v > v_hoje then v := v_hoje; end if;
  select min(m.data_ref) into v_ini from estoque_movimentos m where m.loja_id = p_loja;
  if v_ini is not null and v < v_ini then v := v_ini; end if;
  select max(f.mes) into v_fech from estoque_periodo_fechado f where f.loja_id = p_loja;
  v_aberto := case when v_fech is null then null else (v_fech + interval '1 month')::date end;
  if v_aberto is not null and v < v_aberto then
    v_aviso := format('A nota é de %s, mas %s/%s já foi fechado. A entrada ficou em %s.',
                      to_char(v, 'DD/MM/YYYY'),
                      (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'])[extract(month from v_fech)::int],
                      extract(year from v_fech)::int, to_char(least(v_aberto, v_hoje), 'DD/MM/YYYY'));
    v := least(v_aberto, v_hoje);
  end if;
  return query select v, v_aviso;
end $$;
revoke all on function public._data_entrada_compra(bigint, bigint, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lancar_compra(p_compra jsonb, p_local bigint, p_user text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_data date; v_aviso_data text; v_prods bigint[] := '{}'; v_rep jsonb; -- 313
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

  -- 313: a entrada vale na data da nota (dhSaiEnt, senão emissão), nunca no futuro, nunca antes do início do ledger da
  -- loja, nunca em mês fechado (aí o 1º dia aberto, com aviso na compra)
  select de.data, de.aviso into v_data, v_aviso_data
    from _data_entrada_compra(v_loja, v_comp.id, nullif(p_compra->>'data_entrada', '')::date) de;
  -- 313: trava o custo dos produtos a lançar e dos pratos feitos com eles, em ordem de código, antes de gravar (mesma
  -- ordem do reprocessamento e de produzir): nota × OP ao mesmo tempo esperam uma pela outra em vez de travar em cruz
  perform _travar_custo_produtos(v_loja, (select c.produtos from _cascata_custo(v_loja,
    array(select i.codigo_produto from compras_proprio_itens i where i.compra_id = v_comp.id and not i.lancado and i.codigo_produto is not null),
    v_data) c));

  -- rateio estável: base = valor líquido de TODOS os itens (não depende da ordem de mapeamento)
  select coalesce(sum(valor_total - desconto), 0), count(*) into v_total_liq, v_n from compras_proprio_itens where compra_id = v_comp.id;
  v_ref := coalesce(v_comp.chave_acesso, 'compra:' || v_comp.id)
    -- 185: compra reaberta (entrada desfeita) entra com ref nova; a idempotência por item continua (lancado + ref/linha)
    || case when v_comp.estornos > 0 then '#' || (v_comp.estornos + 1) else '' end;

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
                             'Compra ' || coalesce(v_comp.numero, v_comp.id::text), it.linha, null, null, v_data); -- 313: data da nota
    v_prods := v_prods || it.codigo_produto; -- 313
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
    values (v_loja, v_comp.id, 'lancada', jsonb_strip_nulls(jsonb_build_object('lancados', v_lanc, 'ignorados', v_ign, 'pendentes', v_pend,
            'data_entrada', v_data, 'aviso_data', v_aviso_data, -- 313
            -- avisos de custo/fator aceitos no "Confirmar entrada" (nota sem conferência depois da última mudança)
            'avisos_aceitos', case when jsonb_typeof(p_compra->'avisos_aceitos') = 'array' then p_compra->'avisos_aceitos' end)), p_user);
  end if;
  perform projetar_itens_compra_na_nota(v_comp.id); -- 185

  -- 313: refaz o custo dos produtos da nota (e dos pratos feitos com eles) desde a data da entrada, na mesma transação
  if v_lanc > 0 then
    v_rep := reprocessar_custo(v_loja, v_prods, v_data, 'compra ' || coalesce(v_comp.chave_acesso, v_comp.numero, v_comp.id::text));
  end if;

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_status, 'lancados', v_lanc, 'ja_lancados', v_ja,
                            'pendentes', v_pend, 'ignorados', v_ign, 'duplicado', (v_lanc = 0 and v_ja > 0 and v_pend = 0), 'itens', v_saida,
                            'data_entrada', v_data, -- 313
                            'avisos', coalesce(case when v_aviso_data is not null then jsonb_build_array(v_aviso_data) end, '[]'::jsonb)
                                      || coalesce(v_rep->'avisos', '[]'::jsonb),
                            'reprocessamento', v_rep);
end $function$;

CREATE OR REPLACE FUNCTION public.estornar_compra(p_compra_id bigint, p_user text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c compras_proprio%rowtype; i record; n int := 0; v_cancelada boolean;
        v_prods bigint[] := '{}'; v_desde date; v_rep jsonb; -- 313
begin
  select * into c from compras_proprio where id = p_compra_id for update;
  if not found then raise exception 'Compra inexistente' using errcode = '22023'; end if;
  if c.status = 'cancelada' then return jsonb_build_object('ok', true, 'estornados', 0, 'duplicado', true); end if;
  v_cancelada := c.chave_acesso is not null and (exists (select 1 from sefaz_chaves_canceladas where loja_id = c.loja_id and chave = c.chave_acesso)
      or exists (select 1 from notas_fiscais where loja_id = c.loja_id and c_chave_nfe = c.chave_acesso and deleted_at is null
                 and coalesce(full_object->'infoCadastro'->>'cCancelada', 'N') = 'S'));
  for i in select * from compras_proprio_itens where compra_id = c.id and lancado and movimento_id is not null order by linha loop
    -- 313: data efetiva da entrada (antes do estorno), para refazer o custo dali em diante
    select least(v_desde, e.data_ref) into v_desde from estoque_movimentos_efetivo e where e.id = i.movimento_id;
    v_desde := coalesce(v_desde, (select e.data_ref from estoque_movimentos_efetivo e where e.id = i.movimento_id));
    if i.codigo_produto is not null then v_prods := v_prods || i.codigo_produto; end if;
    perform estornar_movimento(i.movimento_id, p_user, 'Estorno da compra ' || coalesce(c.numero, c.id::text));
    update compras_proprio_itens set lancado = false where id = i.id;
    n := n + 1;
  end loop;
  -- já reaberta (nada lançado) e sem cancelamento: nada a desfazer
  if n = 0 and c.status = 'pendente' and not v_cancelada then return jsonb_build_object('ok', true, 'estornados', 0, 'duplicado', true); end if;
  if v_cancelada then
    update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
  else
    update compras_proprio set status = 'pendente', estornos = estornos + 1, lancada_em = null, conferida_em = null, conferida_por = null,
           updated_at = now() where id = c.id;
  end if;
  insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
  values (c.loja_id, c.id, 'estornada', jsonb_build_object('estornados', n, 'reaberta', not v_cancelada), p_user);
  perform projetar_itens_compra_na_nota(c.id);
  -- 313: o par entrada/estorno sai da cadeia de custo: refaz desde a data da entrada
  if n > 0 and v_desde is not null then
    v_rep := reprocessar_custo(c.loja_id, v_prods, v_desde, 'estorno da compra ' || coalesce(c.chave_acesso, c.numero, c.id::text));
  end if;
  return jsonb_build_object('ok', true, 'estornados', n, 'duplicado', false, 'reaberta', not v_cancelada, 'reprocessamento', v_rep);
end $function$;

notify pgrst, 'reload schema';
