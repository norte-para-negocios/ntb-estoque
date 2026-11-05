-- 319 — OP com a data da produção (Norte ERP, T5.2b, 04/11/2026). Depende da 311–314.
--
-- Antes: produzir gravava tudo na data de hoje. OP do pré-preparo lançada depois das vendas não corrigia o custo dessas
-- vendas (o insumo do prato saía a 0 ou estimado). Agora produzir aceita p_data (null = hoje, igual a antes):
--   * consumo dos insumos e entrada do prato gravados naquele dia;
--   * nunca no futuro, nunca em mês fechado, nunca antes do 1º movimento da loja (erro claro, nada gravado);
--   * data passada: reprocessar_custo(loja, insumos + prato, data, 'OP <ref>') na mesma transação, que refaz o custo do
--     prato desde aquele dia e a cascata das vendas e de outras receitas que usam o prato.
-- op_proprio_concluir (tela de Ordens de Produção) já pedia a data de conclusão e gravava em dt_conclusao_real, mas o
-- estoque entrava hoje. Agora passa essa mesma data ao produzir. Corpo copiado de pg_get_functiondef em PRODUÇÃO
-- (04/11/2026); mudou só a chamada do produzir. Nas 537 OPs concluídas da ODARA a data escolhida foi sempre o dia da
-- conclusão, então nada do que já existe muda.
-- Corpo do produzir copiado da 314 (= produção 04/11/2026); mudou só o que está marcado "319". Assinatura ganha p_data no fim, com
-- default: a antiga (8 argumentos) é removida para não sobrar dois overloads. Quem chama sem p_data continua igual.
--
-- Teste: scripts/testes-sql/319_op_com_data.sql (BEGIN … ROLLBACK). Aplicar com -1:
--   node scripts/aplicar-migration.mjs supabase/migrations/319_op_com_data.sql
-- Conferir: \df produzir (1 overload, 9 argumentos).

drop function if exists public.produzir(bigint, bigint, numeric, bigint, bigint, text, text, text);

CREATE OR REPLACE FUNCTION public.produzir(p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint, p_ref text, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ex ordens_producao_proprio%rowtype; v_ids bigint[]; r record; v_res jsonb;
  v_total numeric := 0; v_custo_un numeric; v_ordem bigint; v_out jsonb; v_itens jsonb := '[]'::jsonb;
  v_cu numeric; v_lote uuid := gen_random_uuid(); v_algum_est boolean := false; v_m estoque_movimentos%rowtype; -- 314
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_data date; v_aberto date; v_ini date; v_rep jsonb; -- 319
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade a produzir deve ser maior que zero' using errcode = '22023'; end if;
  if p_ref is null or btrim(p_ref) = '' then raise exception 'ref é obrigatório (idempotência)' using errcode = '22023'; end if;

  select * into v_ex from ordens_producao_proprio where loja_id = p_loja and ref = p_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ordem_id', v_ex.id, 'custo_unitario', v_ex.custo_unitario, 'custo_total', v_ex.custo_total);
  end if;

  -- 319: data da produção (null = hoje). Nunca no futuro, nunca em mês fechado, nunca antes do 1º movimento da loja.
  v_data := coalesce(p_data, v_hoje);
  if v_data > v_hoje then raise exception 'A data da produção não pode ser no futuro' using errcode = '22023'; end if;
  v_aberto := _primeiro_dia_aberto(p_loja);
  if v_aberto is not null and v_data < v_aberto then
    raise exception 'O mês de % já foi fechado. Use uma data a partir de %.', to_char(v_data, 'MM/YYYY'), to_char(v_aberto, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  select min(m.data_ref) into v_ini from estoque_movimentos m where m.loja_id = p_loja;
  if v_ini is not null and v_data < v_ini then
    raise exception 'O estoque desta loja começa em %. Use uma data a partir desse dia.', to_char(v_ini, 'DD/MM/YYYY') using errcode = '22023';
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
                                 'Produção de ' || _rotulo_produto(p_loja, p_produto), 0, null, null, v_data); -- 319
    v_cu := _custo_consumo_sem_cmc(v_res, v_lote); -- 314: insumo sem custo médio usa o último custo conhecido (estimado)
    if coalesce((v_res ->> 'cmc')::numeric, 0) <= 0 then v_algum_est := true; end if;
    v_total := v_total + r.quantidade * v_cu;
    insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario, movimento_id)
    values (v_ordem, r.codigo_insumo, r.quantidade, v_cu, (v_res ->> 'id')::bigint);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric));
  end loop;

  v_custo_un := round(v_total / p_quantidade, 6);
  v_out := registrar_movimento(p_loja, p_local_destino, p_produto, 'PRD', 'PRODUCAO', p_ref, p_quantidade,
                               case when v_custo_un > 0 then v_custo_un else null end, p_user, coalesce(p_obs, 'Produção de lote'), 0, null, null, v_data); -- 319
  -- 314: algum insumo saiu com custo estimado → a entrada do prato também fica estimada (igual à cadeia do 312)
  select * into v_m from estoque_movimentos where id = (v_out ->> 'id')::bigint;
  if v_algum_est and not v_m.custo_estimado then
    perform _revisar_movimento(v_m.id, v_lote, v_m.data_ref, v_m.custo_unitario, v_m.cmc_apos, v_m.saldo_apos, v_m.saldo_total_apos, true,
                               'custo estimado: algum insumo da OP saiu com custo estimado');
  end if;
  update ordens_producao_proprio set custo_total = round(v_total, 6), custo_unitario = v_custo_un where id = v_ordem;
  -- 319: produção com data passada refaz o custo do prato e dos insumos (e de quem usa o prato) desde aquele dia,
  -- na mesma transação, como a compra (313). O custo da OP e do prato entregue passam a valer o refeito.
  if v_data < v_hoje then
    v_rep := reprocessar_custo(p_loja, coalesce(v_ids, '{}') || p_produto, v_data, 'OP ' || p_ref);
    select e.custo_unitario into v_custo_un from estoque_movimentos_efetivo e where e.id = (v_out ->> 'id')::bigint;
  end if;
  return jsonb_build_object('ok', true, 'duplicado', false, 'ordem_id', v_ordem, 'custo_total', round(v_total, 6), 'custo_unitario', v_custo_un,
                            'saldo_produto', (v_out ->> 'saldo')::numeric, 'cmc_produto', (v_out ->> 'cmc')::numeric, 'itens', v_itens,
                            'data_producao', v_data, 'custo_unitario_refeito', case when v_rep is not null then v_custo_un end, -- 319
                            'reprocessamento', v_rep, 'avisos', coalesce(v_rep -> 'avisos', '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION public.op_proprio_concluir(p_loja bigint, p_op bigint, p_data date DEFAULT NULL::date, p_qtde numeric DEFAULT NULL::numeric, p_user text DEFAULT NULL::text, p_user_uuid uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o ordens_producao%rowtype; v_qtd numeric; v_n int; v_ref text; v_consumo bigint; v_destino bigint; v_res jsonb; v_ficha fichas_tecnicas%rowtype;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja for update;
  if not found then raise exception 'Ordem de produção não encontrada' using errcode = '22023'; end if;
  if coalesce(o.concluida, false) then raise exception 'Esta OP já está concluída' using errcode = '22023'; end if;
  v_qtd := coalesce(nullif(p_qtde, 0), o.identificacao_n_qtde, 1);
  if v_qtd <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  v_consumo := coalesce(o.identificacao_codigo_local_estoque,
                        (select codigo_local_estoque from local_estoques where loja_id = p_loja and padrao = 'S' order by id limit 1));
  if v_consumo is null then raise exception 'A OP não tem local de estoque e a loja não tem local padrão' using errcode = '22023'; end if;
  v_destino := coalesce(o.local_destino, v_consumo);
  v_n := o.producao_n + 1;
  v_ref := 'OP:' || o.id || ':' || v_n;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = o.identificacao_n_cod_produto and ativa;

  v_res := produzir(p_loja, o.identificacao_n_cod_produto, v_qtd, v_consumo, v_destino, v_ref, p_user,
                    'OP ' || coalesce(o.identificacao_c_num_op, o.id::text),
                    least(coalesce(p_data, v_hoje), v_hoje)); -- 319: o estoque entra na data de conclusão escolhida

  update ordens_producao set
    concluida = true, dt_conclusao_real = least(coalesce(p_data, v_hoje), v_hoje), concluida_por = p_user_uuid, concluida_por_nome = p_user,
    identificacao_n_qtde = v_qtd, producao_ref = v_ref, producao_n = v_n,
    ficha_id = v_ficha.id, ficha_versao = v_ficha.versao,
    custo_total = (v_res ->> 'custo_total')::numeric, custo_unitario = (v_res ->> 'custo_unitario')::numeric,
    full_object = _op_itens_detalhes(p_loja, o.identificacao_n_cod_produto, v_qtd),
    conclusao_status = null, conclusao_erro_msg = null, conclusao_tentativas = 0, updated_at = now()
  where id = o.id;

  insert into op_historico (loja_id, op_id, n_cod_op, num_op, evento, user_nome, user_uuid, quantidade, detalhes)
  values (p_loja, o.id, o.identificacao_n_cod_op, o.identificacao_c_num_op, 'concluida', p_user, p_user_uuid, v_qtd,
          jsonb_build_object('ref', v_ref, 'ficha_versao', v_ficha.versao, 'custo_total', v_res -> 'custo_total', 'custo_unitario', v_res -> 'custo_unitario',
                             'local_consumo', v_consumo, 'local_destino', v_destino, 'data', least(coalesce(p_data, v_hoje), v_hoje)));

  return v_res || jsonb_build_object('op_id', o.id, 'ref', v_ref);
end $function$;

revoke all on function public.produzir(bigint, bigint, numeric, bigint, bigint, text, text, text, date) from public, anon, authenticated;
grant execute on function public.produzir(bigint, bigint, numeric, bigint, bigint, text, text, text, date) to service_role;

notify pgrst, 'reload schema';
