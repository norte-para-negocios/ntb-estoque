-- 186 — Fase B (paridade com o Omie): CT-e de frete no custo do item (B9/R13). Depende da 184 (tabelas do CT-e,
-- compras_proprio_itens.frete_cte) e da 185 (custo_estoque_item_omie lê sefaz.freteCte; projetar_itens_compra_na_nota).
-- Só funções novas (nada existente muda). Rateio (HIPÓTESE N8): entre as notas pelo valor da nota (calculado no servidor,
-- conferido aqui: a soma tem de bater com o CT-e), dentro da nota pelo valor líquido do item (valor_total − desconto) dos
-- itens que movimentam estoque, centavo de sobra no maior. Como o Omie (que exige reverter o recebimento), só liga/desliga
-- CT-e de compra sem nenhum item lançado. Entra no custo do item só com a marcação Frete = S (custo_estoque_item_omie).
-- Tudo numa transação.

begin;

-- frete_cte de cada item = soma dos CT-e ligados à compra, repartida pelo valor líquido (centavo no maior)
create or replace function public._recalcular_frete_cte(p_compra bigint)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_total numeric; v_base numeric; v_soma numeric := 0; v_maior bigint; it record;
begin
  select coalesce(sum(valor), 0) into v_total from compras_proprio_cte_compra where compra_id = p_compra;
  update compras_proprio_itens set frete_cte = 0 where compra_id = p_compra;
  if v_total <= 0 then return; end if;
  select coalesce(sum(greatest(valor_total - desconto, 0)), 0) into v_base from compras_proprio_itens where compra_id = p_compra and movimenta_estoque;
  if v_base <= 0 then return; end if;
  for it in select id, greatest(valor_total - desconto, 0) as base from compras_proprio_itens where compra_id = p_compra and movimenta_estoque order by linha loop
    update compras_proprio_itens set frete_cte = round(v_total * it.base / v_base, 2) where id = it.id;
    v_soma := v_soma + round(v_total * it.base / v_base, 2);
  end loop;
  select id into v_maior from compras_proprio_itens where compra_id = p_compra and movimenta_estoque order by (valor_total - desconto) desc, linha limit 1;
  if round(v_total - v_soma, 2) <> 0 then update compras_proprio_itens set frete_cte = frete_cte + round(v_total - v_soma, 2) where id = v_maior; end if;
end $function$;

create or replace function public.vincular_cte_compra(p_loja bigint, p_cte bigint, p_rateio jsonb, p_user text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t compras_proprio_cte%rowtype; c compras_proprio%rowtype; x record; v_soma numeric := 0; v_n int := 0;
begin
  select * into t from compras_proprio_cte where id = p_cte and loja_id = p_loja for update;
  if not found then raise exception 'CT-e não encontrado nesta loja' using errcode = '22023'; end if;
  if jsonb_typeof(p_rateio) <> 'array' or jsonb_array_length(p_rateio) = 0 then raise exception 'Informe as notas do CT-e' using errcode = '22023'; end if;
  for x in select (e->>'compra_id')::bigint as compra_id, round((e->>'valor')::numeric, 2) as valor from jsonb_array_elements(p_rateio) e loop
    select * into c from compras_proprio where id = x.compra_id and loja_id = p_loja for update;
    if not found then raise exception 'Nota % não é desta loja', x.compra_id using errcode = '22023'; end if;
    if exists (select 1 from compras_proprio_itens where compra_id = c.id and lancado) then
      raise exception 'A nota % já entrou no estoque: desfaça a entrada, ligue o CT-e e confirme de novo.', coalesce(c.numero, c.id::text) using errcode = '22023';
    end if;
    if x.valor is null or x.valor < 0 then raise exception 'Valor do frete inválido' using errcode = '22023'; end if;
    v_soma := v_soma + x.valor;
  end loop;
  if abs(v_soma - t.valor) > 0.01 then
    raise exception 'O rateio (%) não fecha com o valor do CT-e (%)', v_soma, t.valor using errcode = '22023';
  end if;
  -- religar o mesmo CT-e substitui o rateio anterior (não soma duas vezes)
  for x in select distinct compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    delete from compras_proprio_cte_compra where cte_id = t.id and compra_id = x.compra_id;
    if not exists (select 1 from jsonb_array_elements(p_rateio) e where (e->>'compra_id')::bigint = x.compra_id) then
      perform _recalcular_frete_cte(x.compra_id);
      perform projetar_itens_compra_na_nota(x.compra_id);
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
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cte_id', t.id, 'notas', v_n);
end $function$;

create or replace function public.desvincular_cte_compra(p_loja bigint, p_cte bigint, p_user text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare t compras_proprio_cte%rowtype; c compras_proprio%rowtype; x record; v_n int := 0;
begin
  select * into t from compras_proprio_cte where id = p_cte and loja_id = p_loja for update;
  if not found then raise exception 'CT-e não encontrado nesta loja' using errcode = '22023'; end if;
  for x in select compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    select * into c from compras_proprio where id = x.compra_id for update;
    if exists (select 1 from compras_proprio_itens where compra_id = c.id and lancado) then
      raise exception 'A nota % já entrou no estoque: desfaça a entrada antes de desligar o CT-e.', coalesce(c.numero, c.id::text) using errcode = '22023';
    end if;
  end loop;
  for x in select compra_id from compras_proprio_cte_compra where cte_id = t.id loop
    delete from compras_proprio_cte_compra where cte_id = t.id and compra_id = x.compra_id;
    perform _recalcular_frete_cte(x.compra_id);
    update compras_proprio set conferida_em = null, conferida_por = null, updated_at = now() where id = x.compra_id;
    insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
    values (p_loja, x.compra_id, 'cte_desvinculado', jsonb_build_object('cte_id', t.id, 'chave', t.chave, 'numero', t.numero), p_user);
    perform projetar_itens_compra_na_nota(x.compra_id);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cte_id', t.id, 'notas', v_n);
end $function$;

revoke all on function public._recalcular_frete_cte(bigint) from public, anon, authenticated;
revoke all on function public.vincular_cte_compra(bigint, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.desvincular_cte_compra(bigint, bigint, text) from public, anon, authenticated;
grant execute on function public._recalcular_frete_cte(bigint) to service_role;
grant execute on function public.vincular_cte_compra(bigint, bigint, jsonb, text) to service_role;
grant execute on function public.desvincular_cte_compra(bigint, bigint, text) to service_role;

commit;

notify pgrst, 'reload schema';
