-- 314 — OP e venda pela receita: insumo sem custo médio usa o último custo conhecido (Norte ERP, custo certo, Task 4,
-- 04/11/2026). Depende da 311 (revisões) e da 312 (o reprocessamento usa a mesma regra).
--
-- Antes: consumo de insumo com CMC 0 saía a R$ 0 e o prato da OP entrava sem custo (custo_estimado) — a venda do prato
-- saía a zero (ODARA, outubro). Agora, quando o consumo sai com CMC 0:
--   * se estoque_custos.ultimo_custo > 0: o consumo vale o último custo, marcado como estimado;
--   * sem nenhum custo: 0 e estimado (como hoje para o prato).
-- O ledger não muda (append-only): o custo usado vai para estoque_mov_revisao (motivo dizendo de onde veio) e para o item
-- da OP (ordens_producao_proprio_itens.custo_unitario); o prato entra com Σ consumos ÷ produzido como antes. Quando a nota
-- do insumo chega, a cascata do reprocessar_custo (312/313) troca o estimado pelo custo real.
-- produzir e consumo_por_receita: corpos copiados de pg_get_functiondef em PRODUÇÃO (04/11/2026); mudou só o custo do
-- consumo. Assinaturas iguais.
--
-- Teste: scripts/testes-sql/314_op_custo_fallback.sql (cópia local). Aplicar com -1 depois de 01:00:
--   node scripts/aplicar-migration.mjs supabase/migrations/314_op_custo_fallback.sql

-- Recebe o retorno do registrar_movimento de um consumo; devolve o custo unitário a usar e, se o CMC era 0, grava a revisão.
create or replace function public._custo_consumo_sem_cmc(p_res jsonb, p_lote uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare m estoque_movimentos%rowtype; v_ult numeric; v_cu numeric;
begin
  if coalesce((p_res ->> 'cmc')::numeric, 0) > 0 then return (p_res ->> 'cmc')::numeric; end if;
  select * into m from estoque_movimentos where id = (p_res ->> 'id')::bigint;
  if not found then return 0; end if;
  if coalesce((p_res ->> 'duplicado')::boolean, false) then
    -- repetição: devolve o custo já em vigor (revisão anterior), sem gravar de novo
    return coalesce((select e.custo_unitario from estoque_movimentos_efetivo e where e.id = m.id), 0);
  end if;
  select ultimo_custo into v_ult from estoque_custos where loja_id = m.loja_id and codigo_produto = m.codigo_produto;
  v_cu := case when coalesce(v_ult, 0) > 0 then v_ult else 0 end;
  perform _revisar_movimento(m.id, p_lote, m.data_ref, v_cu, m.cmc_apos, m.saldo_apos, m.saldo_total_apos, true,
    case when v_cu > 0 then 'custo estimado: insumo sem custo médio, usado o último custo conhecido'
         else 'custo estimado: insumo sem nenhum custo conhecido' end);
  return v_cu;
end $$;
revoke all on function public._custo_consumo_sem_cmc(jsonb, uuid) from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ex ordens_producao_proprio%rowtype; v_ids bigint[]; r record; v_res jsonb;
  v_total numeric := 0; v_custo_un numeric; v_ordem bigint; v_out jsonb; v_itens jsonb := '[]'::jsonb;
  v_cu numeric; v_lote uuid := gen_random_uuid(); -- 314
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade a produzir deve ser maior que zero' using errcode = '22023'; end if;
  if p_ref is null or btrim(p_ref) = '' then raise exception 'ref é obrigatório (idempotência)' using errcode = '22023'; end if;

  select * into v_ex from ordens_producao_proprio where loja_id = p_loja and ref = p_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ordem_id', v_ex.id, 'custo_unitario', v_ex.custo_unitario, 'custo_total', v_ex.custo_total);
  end if;

  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then raise exception 'O produto % não tem ficha técnica ativa', p_produto using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_consumo)
     or not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de consumo ou de destino inexistente' using errcode = '22023';
  end if;

  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  perform _travar_custos(p_loja, coalesce(v_ids, '{}') || p_produto);

  insert into ordens_producao_proprio (loja_id, ref, codigo_produto, ficha_id, quantidade, local_consumo, local_destino, user_id, obs)
  values (p_loja, p_ref, p_produto, v_ficha.id, p_quantidade, p_local_consumo, p_local_destino, p_user, p_obs) returning id into v_ordem;

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local_consumo, r.codigo_insumo, 'PRD', 'PRODUCAO', p_ref, -r.quantidade, null, p_user,
                                 'Produção de ' || _rotulo_produto(p_loja, p_produto), 0, null, null, null);
    v_cu := _custo_consumo_sem_cmc(v_res, v_lote); -- 314: insumo sem custo médio usa o último custo conhecido (estimado)
    v_total := v_total + r.quantidade * v_cu;
    insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario, movimento_id)
    values (v_ordem, r.codigo_insumo, r.quantidade, v_cu, (v_res ->> 'id')::bigint);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric));
  end loop;

  v_custo_un := round(v_total / p_quantidade, 6);
  v_out := registrar_movimento(p_loja, p_local_destino, p_produto, 'PRD', 'PRODUCAO', p_ref, p_quantidade,
                               case when v_custo_un > 0 then v_custo_un else null end, p_user, coalesce(p_obs, 'Produção de lote'), 0, null, null, null);
  update ordens_producao_proprio set custo_total = round(v_total, 6), custo_unitario = v_custo_un where id = v_ordem;
  return jsonb_build_object('ok', true, 'duplicado', false, 'ordem_id', v_ordem, 'custo_total', round(v_total, 6), 'custo_unitario', v_custo_un,
                            'saldo_produto', (v_out ->> 'saldo')::numeric, 'cmc_produto', (v_out ->> 'cmc')::numeric, 'itens', v_itens);
end $function$;

CREATE OR REPLACE FUNCTION public.consumo_por_receita(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text, p_user text DEFAULT NULL::text, p_linha_base integer DEFAULT 0, p_origem text DEFAULT 'VENDA'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ref text; r record; v_res jsonb; v_itens jsonb := '[]'::jsonb;
  v_negativo boolean := false; v_ids bigint[];
  v_lote uuid := gen_random_uuid(); -- 314
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then return jsonb_build_object('ok', true, 'tem_receita', false); end if;

  v_ref := p_ref || '|' || p_produto || '|' || p_linha_base;
  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  if v_ids is null then return jsonb_build_object('ok', true, 'tem_receita', false); end if;
  perform _travar_custos(p_loja, v_ids);

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local, r.codigo_insumo, 'SAI', p_origem, v_ref, r.quantidade, null, p_user,
                                 'Receita ' || _rotulo_produto(p_loja, p_produto) || ' v' || v_ficha.versao, 0, null, null, null);
    perform _custo_consumo_sem_cmc(v_res, v_lote); -- 314: insumo sem custo médio usa o último custo conhecido (estimado)
    if not coalesce((v_res ->> 'duplicado')::boolean, false) then
      insert into estoque_receita_consumos (movimento_id, loja_id, ficha_id, versao, produto_vendido, quantidade_vendida)
      values ((v_res ->> 'id')::bigint, p_loja, v_ficha.id, v_ficha.versao, p_produto, p_quantidade) on conflict do nothing;
    end if;
    if coalesce((v_res ->> 'negativo')::boolean, false) then v_negativo := true; end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric, 'duplicado', coalesce((v_res ->> 'duplicado')::boolean, false)));
  end loop;
  return jsonb_build_object('ok', true, 'tem_receita', true, 'ficha_id', v_ficha.id, 'versao', v_ficha.versao, 'negativo', v_negativo, 'itens', v_itens);
end $function$;

notify pgrst, 'reload schema';
