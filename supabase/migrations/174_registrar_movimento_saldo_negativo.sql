-- 174: custo médio do estoque próprio com saldo negativo na regra do Omie.
--
-- A 132 fazia o custo da entrada assumir sempre que o saldo total era ≤ 0. O Omie pondera mesmo com saldo negativo
-- (CMC = (S0·C0 + q·custo) / (S0 + q)) e só volta ao custo da entrada quando o saldo zera ou o ponderado dá ≤ 0.
-- Evidência: omie-rea/regras/estoque-saldo-e-custo.md E9/E10 (kardex real da loja 5: entradas com S0 < 0 batem em
-- 980 de 1.085 com esta regra, contra 904 com "reset sempre"). Só esse trecho muda; o resto é a função da 132 igual.
-- Teste: scripts/testes-sql/174_registrar_movimento_saldo_negativo.sql (cópia local, nunca em produção).

create or replace function public.registrar_movimento(
  p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text,
  p_quantidade numeric, p_custo numeric default null, p_user text default null, p_obs text default null,
  p_linha int default 0, p_reverses bigint default null, p_transferencia_ref text default null,
  p_data date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_delta numeric; v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric;
  v_total_novo numeric; v_cmc_novo numeric; v_custo_mov numeric; v_estimado boolean := false;
  v_exist estoque_movimentos%rowtype; v_id bigint; v_cons text;
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

  select * into v_exist from estoque_movimentos
   where loja_id = p_loja and origem = p_origem and ref = p_ref
     and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end if;

  v_delta := case p_tipo when 'ENT' then abs(p_quantidade) when 'SAI' then -abs(p_quantidade) else p_quantidade end;

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
      if v_custos.saldo_total + v_delta = 0 then v_cmc_novo := p_custo;
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
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo,
         ultimo_custo = case when p_custo is not null and p_custo > 0 and v_delta > 0 and p_tipo <> 'TRF' then p_custo else ultimo_custo end,
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
end $$;
