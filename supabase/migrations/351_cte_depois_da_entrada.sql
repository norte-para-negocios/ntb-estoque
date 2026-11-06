-- 351 — CT-e (frete) ligado também DEPOIS da entrada da nota (decisão do dono e do Ramon, 05/11/2026). Só estoque próprio.
-- Depende da 186 (vincular/desvincular CT-e), 311 (revisões), 312 (reprocessar_custo) e 313 (entrada na data da nota).
--
-- Antes (186, como o Omie): CT-e só ligava/desligava em nota sem item lançado ("desfaça a entrada, ligue o CT-e e confirme
-- de novo"). Agora liga e desliga a qualquer momento; se a nota já entrou no estoque, o custo daquela entrada é refeito
-- pela data da nota com o mecanismo de revisão (estoque_mov_revisao + reprocessar_custo). O ledger não recebe UPDATE.
--
-- Como o custo de uma entrada muda sem mexer no ledger:
--   * reprocessar_custo (312) usa custo_original (= custo gravado no ledger) como valor da entrada. Esta migration troca
--     custo_original, na visão estoque_movimentos_efetivo, por: a última revisão "custo da entrada: …" do movimento, senão
--     o custo do ledger. Nenhum outro leitor muda: sem essa revisão o valor é o de sempre (hoje existem 0 revisões assim).
--   * _refazer_custo_entradas_compras grava essa revisão (pela _revisar_movimento de sempre, motivo "custo da entrada: …")
--     para cada item lançado cujo custo mudou com o novo frete — mesma conta do lancar_compra (custo_estoque_item_omie
--     sobre a projeção do item ÷ quantidade recebida) — e chama reprocessar_custo UMA vez desde a menor data efetiva das
--     entradas, que refaz CMC, saldos e o custo das saídas/OPs seguintes (cascata para os pratos).
--   * Item de compra antiga/manual (sem valor_total_item) não usa o CT-e no custo (como no lancar_compra): fica igual.
--   * Entrada em mês fechado: recusa (PF001 de _exigir_periodo_aberto), o CT-e não liga. Reabrir o mês primeiro.
--   * Trava o custo dos produtos (e dos pratos da cascata) em ordem de código antes de gravar, como a 313.
-- Desktop offline: a revisão desce pelo pull como qualquer revisão (318); lá reprocessar_custo é no-op e o CT-e depois da
-- entrada só funciona com internet (a ação vai à fila e o servidor refaz).
--
-- Aplicar (com backup e OK do dono, depois de 01:00): node scripts/aplicar-migration.mjs supabase/migrations/351_cte_depois_da_entrada.sql
-- Depois: \df vincular_cte_compra (1 overload), desktop/scripts/gerar-schema.sh + versão nova do desktop.
-- Teste (produção, em ROLLBACK, loja 19): bash scripts/testes-sql/351_rodar.sh  →  NOTICE "351 CTE DEPOIS DA ENTRADA OK"

begin;

-- revisão de custo da própria entrada: achada por índice parcial (quase vazio), não pesa na visão
create index if not exists estoque_mov_revisao_custo_entrada on public.estoque_mov_revisao (movimento_id, id desc)
  where motivo like 'custo da entrada:%';

-- Visão efetiva: igual à 311, só custo_original passa a considerar a revisão "custo da entrada: …".
create or replace view public.estoque_movimentos_efetivo with (security_invoker = true) as
select m.id, m.loja_id, m.codigo_local_estoque, m.codigo_produto, m.tipo, m.origem, m.ref, m.linha, m.quantidade,
       case when r.id is null then m.custo_unitario else r.custo_unitario end as custo_unitario,
       case when r.id is null then m.saldo_apos else r.saldo_apos end as saldo_apos,
       case when r.id is null then m.saldo_total_apos else r.saldo_total_apos end as saldo_total_apos,
       case when r.id is null then m.cmc_apos else r.cmc_apos end as cmc_apos,
       case when r.id is null then m.custo_estimado else r.custo_estimado end as custo_estimado,
       m.reverses_id, m.transferencia_ref, m.user_id, m.obs,
       coalesce(r.data_efetiva, m.data_ref) as data_ref,
       m.created_at,
       r.id is not null as revisado,
       coalesce(ce.custo_unitario, m.custo_unitario) as custo_original, -- 351: custo da entrada refeito (CT-e depois)
       m.data_ref as data_ref_original,
       r.criado_em as revisado_em,
       r.motivo as motivo_revisao
  from public.estoque_movimentos m
  left join lateral (
    select x.id, x.data_efetiva, x.custo_unitario, x.cmc_apos, x.saldo_apos, x.saldo_total_apos, x.custo_estimado,
           x.criado_em, x.motivo
      from public.estoque_mov_revisao x
     where x.movimento_id = m.id
     order by x.id desc
     limit 1
  ) r on true
  left join lateral (
    select x.custo_unitario
      from public.estoque_mov_revisao x
     where x.movimento_id = m.id and x.motivo like 'custo da entrada:%'
     order by x.id desc
     limit 1
  ) ce on true;

comment on view public.estoque_movimentos_efetivo is
  'Ledger do estoque próprio com a última revisão de custo/data aplicada (311). Fonte de custo dos relatórios. '
  'custo_original = custo do ledger, ou o custo da entrada refeito (revisão "custo da entrada: …", 351).';
revoke all on public.estoque_movimentos_efetivo from anon, authenticated, service_role;
grant select on public.estoque_movimentos_efetivo to authenticated, service_role;

-- Refaz o custo das entradas já lançadas destas compras (frete do CT-e mudou). Devolve
-- { entradas_revisadas, produtos, desde, reprocessamento, avisos }. Nada lançado = nada a fazer.
create or replace function public._refazer_custo_entradas_compras(p_loja bigint, p_compras bigint[], p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
set enable_seqscan = off as $$ -- mesma razão do reprocessar_custo (312)
declare
  it compras_proprio_itens%rowtype; e record; v_lote uuid := gen_random_uuid(); v_prods bigint[]; v_min date; v_local bigint;
  v_qtd numeric; v_novo numeric; v_n int := 0; v_rep jsonb; v_revisados bigint[] := '{}';
begin
  if (select modo_estoque from lojas where id = p_loja) is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  -- entradas vivas (lançadas, não estornadas) de item com a conta N3 (o CT-e só entra no custo desse caminho)
  select array_agg(distinct i.codigo_produto order by i.codigo_produto), min(ef.data_ref)
    into v_prods, v_min
    from compras_proprio_itens i
    join compras_proprio c on c.id = i.compra_id and c.loja_id = p_loja
    join estoque_movimentos_efetivo ef on ef.id = i.movimento_id
   where i.compra_id = any(p_compras) and i.lancado and i.movimento_id is not null and i.valor_total_item is not null
     and not exists (select 1 from estoque_movimentos s where s.reverses_id = i.movimento_id);
  if v_prods is null then
    return jsonb_build_object('entradas_revisadas', 0, 'produtos', '[]'::jsonb, 'avisos', '[]'::jsonb);
  end if;
  perform _exigir_periodo_aberto(p_loja, v_min, 'custo da entrada da nota (CT-e)');
  perform _travar_custo_produtos(p_loja, (select x.produtos from _cascata_custo(p_loja, v_prods,
    _recuo_pares(p_loja, v_prods, v_min, _primeiro_dia_aberto(p_loja))) x));

  for it in
    select i.* from compras_proprio_itens i join compras_proprio c on c.id = i.compra_id and c.loja_id = p_loja
     where i.compra_id = any(p_compras) and i.lancado and i.movimento_id is not null and i.valor_total_item is not null
       and not exists (select 1 from estoque_movimentos s where s.reverses_id = i.movimento_id)
     order by i.compra_id, i.linha
  loop
    select ef.* into e from estoque_movimentos_efetivo ef where ef.id = it.movimento_id;
    select codigo_local_estoque into v_local from compras_proprio where id = it.compra_id;
    v_qtd := coalesce(it.quantidade_recebida, it.quantidade * it.fator);
    continue when v_qtd is null or v_qtd <= 0;
    -- mesma conta do lancar_compra (313/185): regra N3 sobre a projeção do item, já com o frete_cte novo
    v_novo := round(custo_estoque_item_omie(item_compra_full_object(it, v_local), it.quantidade, it.valor_unitario) / v_qtd, 6);
    continue when not (v_novo > 0) or v_novo = coalesce(e.custo_original, 0);
    perform _revisar_movimento(e.id, v_lote, e.data_ref, v_novo, e.cmc_apos, e.saldo_apos, e.saldo_total_apos, false,
                               'custo da entrada: ' || p_motivo);
    update compras_proprio_itens set custo_unitario_base = v_novo where id = it.id;
    v_revisados := v_revisados || e.id;
    v_n := v_n + 1;
  end loop;

  if v_n > 0 then
    v_rep := reprocessar_custo(p_loja, v_prods, v_min, p_motivo);
  end if;
  return jsonb_build_object('entradas_revisadas', v_n, 'movimentos', to_jsonb(v_revisados), 'produtos', to_jsonb(v_prods),
                            'desde', v_min, 'reprocessamento', v_rep, 'avisos', coalesce(v_rep->'avisos', '[]'::jsonb));
end $$;
revoke all on function public._refazer_custo_entradas_compras(bigint, bigint[], text) from public, anon, authenticated, service_role;

-- vincular_cte_compra: corpo da 186 (igual ao de produção em 05/11/2026) sem as duas travas "já entrou no estoque";
-- no fim refaz o custo das entradas já lançadas das notas que ganharam ou perderam frete.
create or replace function public.vincular_cte_compra(p_loja bigint, p_cte bigint, p_rateio jsonb, p_user text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t compras_proprio_cte%rowtype; c compras_proprio%rowtype; x record; v_soma numeric := 0; v_n int := 0;
  v_tocadas bigint[] := '{}'; v_custo jsonb; -- 351
begin
  select * into t from compras_proprio_cte where id = p_cte and loja_id = p_loja for update;
  if not found then raise exception 'CT-e não encontrado nesta loja' using errcode = '22023'; end if;
  if jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then raise exception 'Informe as notas do CT-e' using errcode = '22023'; end if;
  for x in select (e->>'compra_id')::bigint as compra_id, round((e->>'valor')::numeric, 2) as valor from jsonb_array_elements(p_rateio) e loop
    select * into c from compras_proprio where id = x.compra_id and loja_id = p_loja for update;
    if not found then raise exception 'Nota % não é desta loja', x.compra_id using errcode = '22023'; end if;
    -- 351: nota já lançada também aceita o CT-e (o custo da entrada é refeito no fim)
    if x.valor is null or x.valor < 0 then raise exception 'Valor do frete inválido' using errcode = '22023'; end if;
    v_soma := v_soma + x.valor;
  end loop;
  if abs(v_soma - t.valor) > 0.01 then
    raise exception 'O rateio (%) não fecha com o valor do CT-e (%)', v_soma, t.valor using errcode = '22023';
  end if;
  -- nota que sai do rateio ao religar: trava a linha (o custo dela também é refeito no fim)
  for x in select distinct l.compra_id from compras_proprio_cte_compra l
            where l.cte_id = t.id and not exists (select 1 from jsonb_array_elements(p_rateio) e where (e->>'compra_id')::bigint = l.compra_id) loop
    perform 1 from compras_proprio where id = x.compra_id for update;
  end loop;
  -- religar o mesmo CT-e substitui o rateio anterior (não soma duas vezes)
  for x in select distinct compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    delete from compras_proprio_cte_compra where cte_id = t.id and compra_id = x.compra_id;
    if not exists (select 1 from jsonb_array_elements(p_rateio) e where (e->>'compra_id')::bigint = x.compra_id) then
      perform _recalcular_frete_cte(x.compra_id);
      perform projetar_itens_compra_na_nota(x.compra_id);
      v_tocadas := v_tocadas || x.compra_id; -- 351
    end if;
  end loop;
  for x in select (e->>'compra_id')::bigint as compra_id, round((e->>'valor')::numeric, 2) as valor from jsonb_array_elements(p_rateio) e loop
    insert into compras_proprio_cte_compra (cte_id, compra_id, loja_id, valor, percentual)
    values (t.id, x.compra_id, p_loja, x.valor, case when t.valor > 0 then round(x.valor / t.valor * 100, 4) else 0 end)
    on conflict (cte_id, compra_id) do update set valor = excluded.valor, percentual = excluded.percentual;
    perform _recalcular_frete_cte(x.compra_id);
    update compras_proprio set conferida_em = null, conferida_por = null, updated_at = now() where id = x.compra_id;
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
    values (p_loja, x.compra_id, 'cte_vinculado', jsonb_build_object('cte_id', t.id, 'chave', t.chave, 'numero', t.numero, 'valor', x.valor), p_user);
    perform projetar_itens_compra_na_nota(x.compra_id);
    v_tocadas := v_tocadas || x.compra_id; -- 351
    v_n := v_n + 1;
  end loop;
  -- 351: CT-e ligado depois da entrada → refaz o custo das entradas pela data da nota
  v_custo := _refazer_custo_entradas_compras(p_loja, v_tocadas,
               'CT-e ' || coalesce(t.numero, t.chave, t.id::text) || ' ligado depois da entrada');
  return jsonb_build_object('ok', true, 'cte_id', t.id, 'notas', v_n, 'custo_refeito', v_custo);
end $function$;

create or replace function public.desvincular_cte_compra(p_loja bigint, p_cte bigint, p_user text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t compras_proprio_cte%rowtype; c compras_proprio%rowtype; x record; v_n int := 0;
  v_tocadas bigint[] := '{}'; v_custo jsonb; -- 351
begin
  select * into t from compras_proprio_cte where id = p_cte and loja_id = p_loja for update;
  if not found then raise exception 'CT-e não encontrado nesta loja' using errcode = '22023'; end if;
  for x in select compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    select * into c from compras_proprio where id = x.compra_id for update;
    -- 351: nota já lançada também pode perder o CT-e (o custo da entrada é refeito no fim)
  end loop;
  for x in select compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    delete from compras_proprio_cte_compra where cte_id = t.id and compra_id = x.compra_id;
    perform _recalcular_frete_cte(x.compra_id);
    update compras_proprio set conferida_em = null, conferida_por = null, updated_at = now() where id = x.compra_id;
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
    values (p_loja, x.compra_id, 'cte_desvinculado', jsonb_build_object('cte_id', t.id, 'chave', t.chave, 'numero', t.numero), p_user);
    perform projetar_itens_compra_na_nota(x.compra_id);
    v_tocadas := v_tocadas || x.compra_id; -- 351
    v_n := v_n + 1;
  end loop;
  v_custo := _refazer_custo_entradas_compras(p_loja, v_tocadas,
               'CT-e ' || coalesce(t.numero, t.chave, t.id::text) || ' desligado depois da entrada');
  return jsonb_build_object('ok', true, 'cte_id', t.id, 'notas', v_n, 'custo_refeito', v_custo);
end $function$;

revoke all on function public.vincular_cte_compra(bigint, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.desvincular_cte_compra(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.vincular_cte_compra(bigint, bigint, jsonb, text) to service_role;
grant execute on function public.desvincular_cte_compra(bigint, bigint, text) to service_role;

commit;

notify pgrst, 'reload schema';
