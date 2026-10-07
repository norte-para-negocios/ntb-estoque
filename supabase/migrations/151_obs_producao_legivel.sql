-- 151 — Observação legível nos movimentos de produção e de receita (07/10/2026, QA rodada 3).
-- Antes: "Produção de 8000000000089" / "Receita 8000000000032 v1" (id interno). Agora: "Produção de 90014 Pizza …" /
-- "Receita 90005 Caipirinha de Limão v1". Só muda o texto da observação; lógica e assinaturas iguais.

create or replace function public._rotulo_produto(p_loja bigint, p_produto bigint) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(btrim(coalesce(codigo, '') || ' ' || coalesce(descricao, '')), '')
                     from produtos where loja_id = p_loja and codigo_produto = p_produto limit 1), p_produto::text)
$$;
revoke all on function public._rotulo_produto(bigint, bigint) from public, anon, authenticated;
grant execute on function public._rotulo_produto(bigint, bigint) to service_role;

CREATE OR REPLACE FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ex ordens_producao_proprio%rowtype; v_ids bigint[]; r record; v_res jsonb;
  v_total numeric := 0; v_custo_un numeric; v_ordem bigint; v_out jsonb; v_itens jsonb := '[]'::jsonb;
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
    v_total := v_total + r.quantidade * coalesce((v_res ->> 'cmc')::numeric, 0);
    insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario, movimento_id)
    values (v_ordem, r.codigo_insumo, r.quantidade, coalesce((v_res ->> 'cmc')::numeric, 0), (v_res ->> 'id')::bigint);
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
    if not coalesce((v_res ->> 'duplicado')::boolean, false) then
      insert into estoque_receita_consumos (movimento_id, loja_id, ficha_id, versao, produto_vendido, quantidade_vendida)
      values ((v_res ->> 'id')::bigint, p_loja, v_ficha.id, v_ficha.versao, p_produto, p_quantidade) on conflict do nothing;
    end if;
    if coalesce((v_res ->> 'negativo')::boolean, false) then v_negativo := true; end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric, 'duplicado', coalesce((v_res ->> 'duplicado')::boolean, false)));
  end loop;
  return jsonb_build_object('ok', true, 'tem_receita', true, 'ficha_id', v_ficha.id, 'versao', v_ficha.versao, 'negativo', v_negativo, 'itens', v_itens);
end $function$;

