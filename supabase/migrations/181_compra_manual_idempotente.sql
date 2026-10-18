-- 181: compra manual sem duplicar (Fase A, Task 13; matriz A5). O formulário manda um UUID por compra
-- (chave_idempotencia); a mesma chave de novo (duplo clique, reenvio da fila do desktop) devolve a compra já gravada com
-- duplicado = true e não lança nada. Chamadas concorrentes com a mesma chave: o índice único barra a segunda.
-- lancar_compra = corpo da 180 + o guarda acima (mesma assinatura). Depende da 180.
-- Tudo numa transação: se algo falhar, nada fica pela metade (os drop/create de função não se aplicam sozinhos).

begin;

alter table compras_proprio add column if not exists chave_idempotencia text;
create unique index if not exists compras_proprio_chave_idempotencia_uq
  on compras_proprio (loja_id, chave_idempotencia) where chave_idempotencia is not null;

create or replace function public.lancar_compra(p_compra jsonb, p_local bigint, p_user text DEFAULT NULL::text)
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
    v_qtd_base := it.quantidade * it.fator;
    if it.codigo_produto is null or v_qtd_base <= 0
       or not exists (select 1 from produtos where loja_id = v_loja and codigo_produto = it.codigo_produto) then
      v_pend := v_pend + 1;
      v_saida := v_saida || jsonb_build_object('linha', it.linha, 'ok', false,
          'motivo', case when it.codigo_produto is null then 'sem_produto' when v_qtd_base <= 0 then 'quantidade_zero' else 'produto_inexistente' end);
      continue;
    end if;
    v_share := case when v_total_liq > 0 then (it.valor_total - it.desconto) / v_total_liq else 1.0 / greatest(v_n, 1) end;
    v_custo_total := (it.valor_total - it.desconto) + v_comp.valor_frete * v_share - v_comp.valor_desconto * v_share
                     - case when v_comp.icms_recuperavel then it.icms_valor else 0 end;
    v_custo_unit := round(v_custo_total / v_qtd_base, 6);
    r := registrar_movimento(v_loja, p_local, it.codigo_produto, 'ENT', 'COMPRA', v_ref, v_qtd_base,
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
  v_status := case when v_nitens = 0 or (v_lanc + v_ja) = 0 then 'pendente' when (v_lanc + v_ja) < v_nitens then 'parcial' else 'lancada' end;
  update compras_proprio set status = v_status, codigo_local_estoque = p_local, updated_at = now(),
         lancada_em = case when v_status = 'lancada' then coalesce(lancada_em, now()) else lancada_em end
   where id = v_comp.id;

  return jsonb_build_object('ok', true, 'compra_id', v_comp.id, 'status', v_status, 'lancados', v_lanc, 'ja_lancados', v_ja,
                            'pendentes', v_pend, 'duplicado', (v_lanc = 0 and v_ja > 0 and v_pend = 0), 'itens', v_saida);
end $function$;

commit;

notify pgrst, 'reload schema';
