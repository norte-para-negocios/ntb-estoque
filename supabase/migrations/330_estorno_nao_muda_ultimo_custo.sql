-- 330 — Estorno não sobrescreve o "último custo" (Norte ERP, Fase 3 frente B, 05/11/2026).
--
-- Achado pela tela na loja-laboratório 19: refazer a contagem de um item no inventário estorna o ajuste antigo
-- (EST positivo com o custo do movimento original = custo médio da época). registrar_movimento tratava esse EST como
-- uma entrada com custo e gravava estoque_custos.ultimo_custo = custo médio, apagando o custo da última compra
-- (feijão: último custo R$ 11,00 virou R$ 9,00). O mesmo vale para o estorno de venda, consumo de OP, perda e ajuste.
-- ultimo_custo é usado pela sugestão de compra e pelo custo de consumo de insumo sem custo médio (314).
-- reprocessar_custo (312) já ignora estornos ao refazer o último custo; aqui o lançamento normal passa a fazer o mesmo.
-- Única mudança: "and p_reverses is null" na regra do ultimo_custo. Corpo copiado de pg_get_functiondef em produção
-- (05/11/2026). Não corrige ultimo_custo já gravado (loja 19 é teste; nas demais, o próximo reprocessar_custo refaz).

CREATE OR REPLACE FUNCTION public.registrar_movimento(p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text, p_quantidade numeric, p_custo numeric DEFAULT NULL::numeric, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text, p_linha integer DEFAULT 0, p_reverses bigint DEFAULT NULL::bigint, p_transferencia_ref text DEFAULT NULL::text, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_delta numeric; v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric;
  v_total_novo numeric; v_cmc_novo numeric; v_custo_mov numeric; v_estimado boolean := false;
  v_exist estoque_movimentos%rowtype; v_id bigint; v_cons text; v_chave text;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  if p_tipo not in ('ENT', 'SAI', 'AJU', 'TRF', 'PRD', 'EST') then
    raise exception 'Tipo de movimento inválido: %', p_tipo using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade = 0 then
    raise exception 'Quantidade zero ou ausente' using errcode = '22023';
  end if;
  if p_origem is null or p_ref is null then
    raise exception 'origem e ref são obrigatórios (idempotência)' using errcode = '22023';
  end if;

  v_delta := case p_tipo when 'ENT' then abs(p_quantidade) when 'SAI' then -abs(p_quantidade) else p_quantidade end;
  v_chave := format('%s/%s linha %s (produto %s, local %s)', p_origem, p_ref, p_linha, p_produto, p_local);

  -- 308: a chave já gravada só é "duplicado" se for o MESMO movimento (tipo e quantidade, na escala da coluna);
  -- outra quantidade com a mesma chave é conflito e falha alto (antes respondia ok e descartava a diferença).
  select * into v_exist from estoque_movimentos
   where loja_id = p_loja and origem = p_origem and ref = p_ref
     and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
  if found then
    if v_exist.tipo is distinct from p_tipo or v_exist.quantidade is distinct from round(v_delta, 6) then
      raise exception 'conflito de idempotência: % já gravado com outra quantidade', v_chave
        using errcode = 'PF002', detail = format('gravado: %s %s; pedido agora: %s %s', v_exist.tipo, v_exist.quantidade, p_tipo, round(v_delta, 6));
    end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end if;

  -- Trava SEMPRE na mesma ordem: custo do produto, depois saldo do local (evita deadlock).
  insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p_produto) on conflict do nothing;
  select * into v_custos from estoque_custos where loja_id = p_loja and codigo_produto = p_produto for update;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto) values (p_loja, p_local, p_produto) on conflict do nothing;
  select saldo into v_saldo_ant from estoque_saldos
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;

  if p_tipo = 'TRF' then
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- transferência não muda custo
  elsif v_delta > 0 then
    if p_custo is not null and p_custo > 0 then
      v_custo_mov := p_custo;
      -- Regra do Omie: pondera mesmo com saldo negativo; o custo da entrada assume só se o saldo zerar ou o
      -- ponderado der ≤ 0 (com saldo 0 o ponderado já é o custo da entrada).
      -- 317 (decisão do dono, desvio consciente da E9): sem custo conhecido (CMC = 0) a entrada vira o CMC, mesmo com
      -- saldo negativo (vendido antes da 1ª compra). Igual à cadeia do reprocessar_custo (312).
      if v_custos.cmc <= 0 or v_custos.saldo_total + v_delta = 0 then v_cmc_novo := p_custo;
      else
        v_cmc_novo := round((v_custos.saldo_total * v_custos.cmc + v_delta * p_custo) / (v_custos.saldo_total + v_delta), 6);
        if v_cmc_novo <= 0 then v_cmc_novo := p_custo; end if;
      end if;
    else
      v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc; v_estimado := true;  -- sem custo: não dilui nem zera o CMC
    end if;
  else
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- saída ao CMC vigente (não recalcula)
  end if;

  v_saldo_novo := v_saldo_ant + v_delta;
  v_total_novo := v_custos.saldo_total + v_delta;

  begin
    insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade,
        custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, custo_estimado, reverses_id, transferencia_ref, user_id, obs, data_ref)
    values (p_loja, p_local, p_produto, p_tipo, p_origem, p_ref, p_linha, v_delta,
        v_custo_mov, v_saldo_novo, v_total_novo, v_cmc_novo, v_estimado, p_reverses, p_transferencia_ref, p_user, p_obs,
        coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date))
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons like '%reverses_id%' then
      raise exception 'Este movimento já foi estornado' using errcode = '23505';
    end if;
    select * into v_exist from estoque_movimentos
     where loja_id = p_loja and origem = p_origem and ref = p_ref
       and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
    -- corrida (duas chamadas ao mesmo tempo): mesma regra do duplicado acima
    if v_exist.tipo is distinct from p_tipo or v_exist.quantidade is distinct from round(v_delta, 6) then
      raise exception 'conflito de idempotência: % já gravado com outra quantidade', v_chave
        using errcode = 'PF002', detail = format('gravado: %s %s; pedido agora: %s %s', v_exist.tipo, v_exist.quantidade, p_tipo, round(v_delta, 6));
    end if;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo,
         -- 330: estorno (p_reverses) não é compra: devolver uma saída ao custo médio não vira "último custo"
         ultimo_custo = case when p_custo is not null and p_custo > 0 and v_delta > 0 and p_tipo <> 'TRF' and p_reverses is null then p_custo else ultimo_custo end,
         updated_at = now()
   where loja_id = p_loja and codigo_produto = p_produto;

  -- Projeção para os relatórios atuais (posição do dia).
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select p_loja, p_local, p_produto, (now() at time zone 'America/Sao_Paulo')::date, pr.codigo, pr.descricao,
         v_saldo_novo, v_saldo_novo, v_cmc_novo, pr.estoque_minimo
    from (select 1) x left join produtos pr on pr.loja_id = p_loja and pr.codigo_produto = p_produto
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc, updated_at = now();

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'saldo', v_saldo_novo, 'saldo_total', v_total_novo,
                            'cmc', v_cmc_novo, 'negativo', v_saldo_novo < 0, 'custo_estimado', v_estimado);
end $function$;
