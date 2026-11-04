-- 317 — Custo certo, revisão independente (Norte ERP, 04/11/2026). Depende de 311 e 312.
--
-- 1) registrar_movimento (corpo de PRODUÇÃO, versão da 308): DESVIO CONSCIENTE DA E9, decisão do dono — sem custo
--    conhecido (CMC = 0), a entrada com custo vira o CMC mesmo com saldo negativo (vendido antes da 1ª compra: pela E9,
--    S₀ = −5, C₀ = 0 e 10 a R$ 4 dariam R$ 8). Com C₀ > 0 continua E9/E10. Mesma regra da cadeia (312), para o lançamento
--    ao vivo e o reprocessamento darem o mesmo número.
-- 2) Leitores que usavam o ledger cru passam a ler estoque_movimentos_efetivo (custo e data da última revisão), partindo de
--    pg_get_functiondef de PRODUÇÃO; sem revisão a saída é a de antes (prova em scripts/testes-sql/317_leitores_custo_efetivo.sql):
--    curva_abc, relatorio_movimentacao_valor_mov, op_proprio_detalhe (custo dos insumos e movimentos; ordem data efetiva, id),
--    sugestao_compra_proprio (consumo pela data efetiva), _saida_ao_custo_da_entrada (duplicado devolve o CMC efetivo).
-- 3) posicao_proprio_em_data (Bloco H, pacote do contador): ordem (data efetiva, id), custos efetivos, e as regras da cadeia
--    — movimento + estorno fora do custo médio e o reset sem custo conhecido. Aqui a saída MUDA quando há par de estorno ou
--    venda antes da 1ª compra (de propósito: passa a bater com o CMC da cadeia).
-- Aplicar com -1 depois de 01:00: node scripts/aplicar-migration.mjs supabase/migrations/317_custo_efetivo_leitores.sql
-- Conferir: \df de cada função (1 overload).

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
end $function$;

CREATE OR REPLACE FUNCTION public.posicao_proprio_em_data(p_loja bigint, p_data date)
 RETURNS TABLE(codigo_produto bigint, codigo_local_estoque bigint, saldo numeric, cmc numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  m record; v_prod bigint; v_s numeric := 0; v_c numeric := 0; v_q numeric; v_novo numeric;
  v_prods bigint[] := '{}'; v_cmcs numeric[] := '{}';
begin
  -- Saldo por produto × local: soma direta do ledger até a data (data efetiva).
  -- Custo médio por produto: refeito na ORDEM DA DATA EFETIVA (data_ref da última revisão, depois id), com as regras da
  -- cadeia do reprocessar_custo (312/317): movimento + estorno fora do custo médio; sem custo conhecido a entrada vira o
  -- CMC; E9/E10; devolução (231). Custos efetivos (visão 311). Sem revisão e sem par de estorno = saída de antes.
  for m in
    select e.codigo_produto, e.tipo, e.origem, e.quantidade, e.custo_unitario, e.custo_estimado,
           (e.reverses_id is not null or exists (select 1 from estoque_movimentos x where x.reverses_id = e.id)) as par
      from estoque_movimentos_efetivo e
     where e.loja_id = p_loja and e.data_ref <= p_data
     order by e.codigo_produto, e.data_ref, e.id
  loop
    if v_prod is distinct from m.codigo_produto then
      if v_prod is not null then v_prods := v_prods || v_prod; v_cmcs := v_cmcs || v_c; end if;
      v_prod := m.codigo_produto; v_s := 0; v_c := 0;
    end if;
    continue when m.par;                                                -- 317: o par não existe para o custo
    v_q := m.quantidade;
    if m.tipo = 'TRF' then
      null;                                                             -- transferência não muda saldo total nem custo
    -- mesma regra da cadeia (312): entrada de OP entra no custo médio pelo custo dela mesmo estimada (algum insumo
    -- estimado); as outras entradas só com custo informado (estimada = entrou ao CMC vigente, não muda o custo)
    elsif v_q > 0 and coalesce(m.custo_unitario, 0) > 0
          and (not coalesce(m.custo_estimado, false) or (m.tipo = 'PRD' and m.origem = 'PRODUCAO')) then
      if v_c <= 0 or v_s + v_q = 0 then v_c := m.custo_unitario;         -- 317: sem custo conhecido, reset
      else
        v_novo := round((v_s * v_c + v_q * m.custo_unitario) / (v_s + v_q), 6);
        v_c := case when v_novo <= 0 then m.custo_unitario else v_novo end;
      end if;
    elsif v_q < 0 and m.origem = 'DEVOLUCAO_FORNECEDOR' and v_s + v_q > 0 and coalesce(m.custo_unitario, 0) > 0 then
      v_novo := round((v_s * v_c + v_q * m.custo_unitario) / (v_s + v_q), 6);   -- 231: tira as unidades ao custo da entrada
      if v_novo > 0 then v_c := v_novo; end if;
    end if;
    if m.tipo <> 'TRF' then v_s := v_s + v_q; end if;
  end loop;
  if v_prod is not null then v_prods := v_prods || v_prod; v_cmcs := v_cmcs || v_c; end if;

  return query
    select s.codigo_produto, s.codigo_local_estoque, round(s.saldo, 6), coalesce(c.cmc, 0)
      from (select e.codigo_produto, e.codigo_local_estoque, sum(e.quantidade) as saldo
              from estoque_movimentos_efetivo e
             where e.loja_id = p_loja and e.data_ref <= p_data
             group by e.codigo_produto, e.codigo_local_estoque) s
      left join unnest(v_prods, v_cmcs) as c(codigo_produto, cmc) on c.codigo_produto = s.codigo_produto;
end $function$;

CREATE OR REPLACE FUNCTION public.curva_abc(p_loja bigint, p_dias integer DEFAULT NULL::integer)
 RETURNS TABLE(codigo_produto bigint, valor_movimentado numeric, percentual_acumulado numeric, classe text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cfg as (select coalesce(p_dias, (select dias_curva_abc from estoque_config where loja_id = p_loja), 90) as dias),
  base as (
    select m.codigo_produto, sum(abs(m.quantidade) * coalesce(m.custo_unitario, 0)) as v
      from estoque_movimentos_efetivo m, cfg -- 317: custo efetivo
     where m.loja_id = p_loja and m.tipo = 'SAI' and m.created_at >= now() - make_interval(days => cfg.dias)
     group by m.codigo_produto
  ),
  rot as (select b.codigo_produto, b.v, sum(b.v) over (order by b.v desc, b.codigo_produto) as acum, sum(b.v) over () as total from base b),
  todos as (
    select pr.codigo_produto, coalesce(r.v, 0) as v, r.acum, r.total
      from produtos pr left join rot r on r.codigo_produto = pr.codigo_produto
     where pr.loja_id = p_loja and coalesce(pr.inativo, false) = false
  )
  select t.codigo_produto, t.v,
         case when t.total > 0 then round(coalesce(t.acum, t.total) / t.total * 100, 2) else 100 end,
         case when t.v <= 0 or t.total is null or t.total <= 0 then 'C'
              when (t.acum - t.v) / t.total < 0.80 then 'A'
              when (t.acum - t.v) / t.total < 0.95 then 'B'
              else 'C' end
    from todos t
$function$;

CREATE OR REPLACE FUNCTION public.relatorio_movimentacao_valor_mov(p_loja_id bigint, p_ini date, p_fim date)
 RETURNS TABLE(origem text, sentido text, codigo_local_estoque bigint, n_cod_prod bigint, mes text, inventario boolean, qtde numeric, valor numeric, sem_custo integer, valor_omie numeric, ajustados integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with modo as (select coalesce((select l.modo_estoque from lojas l where l.id = p_loja_id), 'omie') as m),
  ref as (
    select * from custo_referencia_produto(p_loja_id, p_fim) where (select m from modo) <> 'proprio'
  ),
  base as (
    select coalesce(nullif(k.des_origem, ''), nullif(k.cod_origem, ''), 'Sem origem') as origem,
           case when k.quantidade > 0 then 'E' else 'S' end as sentido,
           k.codigo_local_estoque, k.n_cod_prod, to_char(k.data_mov, 'YYYY-MM') as mes,
           (k.cod_origem = 'INV' or coalesce(mv.motivo = 'INV', false)) as inventario,
           abs(k.quantidade) as q,
           abs(k.quantidade) * case when k.valor_unit > r.limite and k.cod_origem not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC')
                                    then coalesce(r.referencia, 0) else coalesce(k.valor_unit, 0) end as v,
           abs(k.quantidade) * coalesce(k.valor_unit, 0) as v_omie,
           k.valor_unit is null as sem,
           coalesce(k.valor_unit > r.limite and k.cod_origem not in ('COM', 'IMP', 'CIM', 'DCP', 'CDC'), false) as aj
    from kardex_omie k
    left join movimentos mv on mv.loja_id = k.loja_id and mv.id_ajuste = k.id_ajuste and k.id_ajuste is not null
    left join ref r on r.n_cod_prod = k.n_cod_prod
    where (select m from modo) <> 'proprio'
      and k.loja_id = p_loja_id and k.data_mov between p_ini and p_fim and not k.cancelado and k.quantidade <> 0
    union all
    select case e.origem
             when 'COMPRA' then 'Compra de Produto'
             when 'VENDA' then 'Venda'
             when 'PRODUCAO' then case when e.quantidade < 0 then 'Consumo da Ordem de Produção' else 'Entrada da Ordem de Produção' end
             when 'INVENTARIO' then 'Inventário'
             when 'PERDA' then 'Perda'
             when 'TRANSFERENCIA' then 'Transferência'
             when 'ESTORNO' then 'Estorno'
             else initcap(replace(lower(e.origem), '_', ' ')) end,
           case when e.quantidade > 0 then 'E' else 'S' end,
           e.codigo_local_estoque, e.codigo_produto, to_char(e.data_ref, 'YYYY-MM'),
           e.origem = 'INVENTARIO',
           abs(e.quantidade), abs(e.quantidade) * coalesce(e.custo_unitario, 0), abs(e.quantidade) * coalesce(e.custo_unitario, 0),
           e.custo_unitario is null, false
    from estoque_movimentos_efetivo e -- 317: custo e data efetivos
    where (select m from modo) = 'proprio'
      and e.loja_id = p_loja_id and e.data_ref between p_ini and p_fim
  )
  select origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario,
         round(sum(q), 6), round(sum(v), 2), count(*) filter (where sem)::int, round(sum(v_omie), 2), count(*) filter (where aj)::int
  from base
  group by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
  order by origem, sentido, codigo_local_estoque, n_cod_prod, mes, inventario
$function$;

CREATE OR REPLACE FUNCTION public.op_proprio_detalhe(p_loja bigint, p_op bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o ordens_producao%rowtype; v_ficha jsonb; v_exec jsonb; v_hist jsonb;
begin
  select * into o from ordens_producao where id = p_op and loja_id = p_loja;
  if not found then return null; end if;

  select jsonb_build_object('id', f.id, 'versao', f.versao, 'rendimento', f.rendimento, 'ativa', f.ativa, 'itens', coalesce((
           select jsonb_agg(jsonb_build_object('codigo_insumo', i.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_liquida', i.quantidade_liquida, 'fator_correcao', i.fator_correcao, 'perda_pct', i.perda_pct, 'quantidade_bruta', i.quantidade_bruta) order by i.ordem)
             from ficha_tecnica_itens i left join produtos p on p.loja_id = f.loja_id and p.codigo_produto = i.codigo_insumo where i.ficha_id = f.id), '[]'::jsonb))
    into v_ficha from fichas_tecnicas f where f.id = o.ficha_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.n), '[]'::jsonb) into v_exec from (
    select (regexp_replace(op.ref, '^OP:\d+:', ''))::int as n, op.ref, op.status, op.quantidade, op.custo_total, op.custo_unitario, op.local_consumo, op.local_destino,
           op.user_id, op.created_at,
           (select jsonb_agg(jsonb_build_object('codigo_insumo', it.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
                    'quantidade_bruta', it.quantidade, 'custo_unitario', coalesce(me.custo_unitario, it.custo_unitario),
                    'custo_total', round(it.quantidade * coalesce(me.custo_unitario, it.custo_unitario), 6), 'movimento_id', it.movimento_id)
                    order by it.id)
              from ordens_producao_proprio_itens it left join produtos p on p.loja_id = op.loja_id and p.codigo_produto = it.codigo_insumo
              left join estoque_movimentos_efetivo me on me.id = it.movimento_id -- 317: custo efetivo do consumo
             where it.ordem_id = op.id) as insumos,
           (select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'codigo_produto', m.codigo_produto, 'codigo', p.codigo, 'descricao', p.descricao,
                    'codigo_local_estoque', m.codigo_local_estoque, 'local', l.descricao, 'quantidade', m.quantidade, 'custo_unitario', m.custo_unitario,
                    'saldo_apos', m.saldo_apos, 'created_at', m.created_at,
                    'estornado', exists (select 1 from estoque_movimentos r where r.reverses_id = m.id)) order by m.data_ref, m.id)
              from estoque_movimentos_efetivo m -- 317: custo e data efetivos
              left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.codigo_produto
              left join local_estoques l on l.loja_id = m.loja_id and l.codigo_local_estoque = m.codigo_local_estoque
             where m.loja_id = op.loja_id and m.origem = 'PRODUCAO' and m.ref = op.ref) as movimentos
      from ordens_producao_proprio op
     where op.loja_id = p_loja and op.ref like 'OP:' || o.id || ':%'
  ) e;

  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'evento', h.evento, 'user_nome', h.user_nome, 'quantidade', h.quantidade, 'detalhes', h.detalhes, 'created_at', h.created_at)
                  order by h.id), '[]'::jsonb)
    into v_hist from op_historico h where h.loja_id = p_loja and h.n_cod_op = o.identificacao_n_cod_op;

  return jsonb_build_object('ficha', v_ficha, 'execucoes', v_exec, 'historico', v_hist);
end $function$;

CREATE OR REPLACE FUNCTION public.sugestao_compra_proprio(p_loja bigint, p_ini date, p_fim date, p_proj_ini date, p_proj_fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with prod as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.descricao_familia as familia, pc.lead_time_dias as lead_time
    from produtos p left join produto_compra_param pc on pc.loja_id = p.loja_id and pc.codigo_produto = p.codigo_produto
   where p.loja_id = p_loja and not coalesce(p.inativo, false)
), cons as (
  -- saídas do período (venda, consumo de produção, ajuste para baixo); transferência entre locais não é consumo;
  -- saída estornada não conta (o estorno aponta para ela em reverses_id)
  select m.codigo_produto, sum(-m.quantidade) as s from estoque_movimentos_efetivo m -- 317: data efetiva
   where m.loja_id = p_loja and m.data_ref between p_ini and p_fim and m.tipo in ('SAI', 'PRD', 'AJU') and m.quantidade < 0
     and m.reverses_id is null and not exists (select 1 from estoque_movimentos e where e.reverses_id = m.id)
   group by 1
), pos as (
  select s.codigo_produto, sum(s.saldo) as saldo, sum(coalesce(s.minimo, 0)) as minimo from estoque_saldos s where s.loja_id = p_loja group by 1
), cmc as (
  select codigo_produto, nullif(cmc, 0) as cmc from estoque_custos where loja_id = p_loja
), nfp as (
  -- nota do fornecedor já recebida no sistema e ainda não lançada no estoque ("faturado pelo fornecedor")
  select i.codigo_produto, sum(coalesce(i.quantidade_recebida, i.quantidade * i.fator)) as q
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status in ('pendente', 'parcial') and not i.lancado and i.codigo_produto is not null
     and coalesce(i.movimenta_estoque, true)
   group by 1
), ped as (
  -- saldo dos pedidos aguardando/aprovados que ainda não está em nenhuma nota (o que já está em nota conta em nfp)
  select s.codigo_produto, sum(greatest(0, s.quantidade_base - s.vinculado)) as q
    from pedidos_compra_itens_situacao s join pedidos_compra pc on pc.id = s.pedido_id
   where pc.loja_id = p_loja and pc.etapa in ('aguardando_aprovacao', 'aprovado')
     and (pc.previsao_entrega is null or pc.previsao_entrega <= p_proj_fim)
   group by 1
), req as (
  -- 241: requisições abertas ou aprovadas com entrega até o fim da estimativa. A que virou pedido conta aqui enquanto o
  -- pedido é rascunho (ped só conta aguardando/aprovado); depois disso conta só em ped.
  select i.codigo_produto, sum(i.quantidade * i.fator) as q
    from requisicoes_compra r join requisicoes_compra_itens i on i.requisicao_id = r.id
    left join pedidos_compra pr on pr.id = i.pedido_id
   where r.loja_id = p_loja and (r.etapa in ('aberta', 'aprovada') or (r.etapa = 'pedido' and pr.etapa = 'rascunho'))
     and (r.sugestao_entrega is null or r.sugestao_entrega <= p_proj_fim)
   group by 1
), ops as (
  select * from _sugestao_ops_abertas(p_loja, p_proj_fim)
), opent as (
  select produto, sum(quantidade) as q from ops group by 1
), opcons as (
  select (it->>'nIdProdutoMalha')::bigint as insumo, sum(coalesce((it->>'nQtde')::numeric, 0)) as q
    from ops, jsonb_array_elements(ops.itens) it where (it->>'nIdProdutoMalha') ~ '^[0-9]+$' group by 1
), prev as (
  select * from _sugestao_previsao(p_loja, (p_proj_fim - p_proj_ini) + 1)
), ficha as (
  select codigo_produto from fichas_tecnicas where loja_id = p_loja and ativa
), ult as (
  select distinct on (i.codigo_produto) i.codigo_produto, c.fornecedor_nome, nullif(regexp_replace(coalesce(c.fornecedor_cnpj, ''), '\D', '', 'g'), '') as cnpj,
         coalesce(c.emissao, c.created_at::date) as data,
         coalesce(i.custo_unitario_base, round((i.valor_total - i.desconto) / nullif(i.quantidade * i.fator, 0), 6)) as custo
    from compras_proprio c join compras_proprio_itens i on i.compra_id = c.id
   where c.loja_id = p_loja and c.status <> 'cancelada' and i.codigo_produto is not null
   order by i.codigo_produto, coalesce(c.emissao, c.created_at::date) desc, c.id desc
), linhas as (
  select p.codigo_produto, p.codigo, p.descricao, p.unidade, p.tipo_item, p.familia,
         coalesce(c.s, 0) as consumo_total, coalesce(pos.saldo, 0) as estoque_atual, coalesce(pos.minimo, 0) as estoque_minimo,
         coalesce(p.lead_time, fcp.lead_time_dias) as lead_time,   -- 241: do produto; senão do fornecedor da última nota
         case when p.lead_time is not null then 'produto' when fcp.lead_time_dias is not null then 'fornecedor' end as lead_time_origem,
         coalesce(req.q, 0) as entrada_requisicoes,
         coalesce(nfp.q, 0) as entrada_nf, coalesce(opent.q, 0) as entrada_ops, coalesce(ped.q, 0) as entrada_pedidos,
         coalesce(opcons.q, 0) as consumo_ops, coalesce(prev.qtde, 0) as previsao_qtde, coalesce(prev.dias, 0) as previsao_dias,
         (ficha.codigo_produto is not null) as tem_ficha,
         f.id as fornecedor_id, coalesce(ult.fornecedor_nome, f.razao_social) as fornecedor_nome, ult.cnpj as fornecedor_cnpj,
         ult.custo as ultimo_custo, ult.data as ultima_compra, cmc.cmc
    from prod p
    left join cons c on c.codigo_produto = p.codigo_produto
    left join pos on pos.codigo_produto = p.codigo_produto
    left join nfp on nfp.codigo_produto = p.codigo_produto
    left join ped on ped.codigo_produto = p.codigo_produto
    left join opent on opent.produto = p.codigo_produto
    left join opcons on opcons.insumo = p.codigo_produto
    left join prev on prev.n_cod_prod = p.codigo_produto
    left join ficha on ficha.codigo_produto = p.codigo_produto
    left join ult on ult.codigo_produto = p.codigo_produto
    left join cmc on cmc.codigo_produto = p.codigo_produto
    left join lateral (select f.id, f.razao_social from fornecedores f
                        where f.loja_id = p_loja and ult.cnpj is not null and regexp_replace(coalesce(f.cnpj_cpf, ''), '\D', '', 'g') = ult.cnpj
                        order by f.id limit 1) f on true
    left join fornecedor_compra_param fcp on fcp.loja_id = p_loja and fcp.fornecedor_id = f.id
    left join req on req.codigo_produto = p.codigo_produto
)
select coalesce(jsonb_agg(to_jsonb(l) order by l.codigo_produto), '[]'::jsonb) from linhas l
 where l.consumo_total <> 0 or l.estoque_minimo <> 0 or l.estoque_atual <> 0 or l.entrada_nf <> 0 or l.entrada_ops <> 0
    or l.entrada_pedidos <> 0 or l.consumo_ops <> 0 or l.entrada_requisicoes <> 0
$function$;

CREATE OR REPLACE FUNCTION public._saida_ao_custo_da_entrada(p_loja bigint, p_local bigint, p_produto bigint, p_ref text, p_linha integer, p_quantidade numeric, p_custo numeric, p_user text DEFAULT NULL::text, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric; v_total_novo numeric; v_cmc_novo numeric;
  v_exist estoque_movimentos_efetivo%rowtype; v_id bigint; v_q numeric := abs(p_quantidade);
begin
  if v_q = 0 then raise exception 'Quantidade zero' using errcode = '22023'; end if;
  -- 317: duplicado devolve o CMC efetivo (última revisão)
  select * into v_exist from estoque_movimentos_efetivo
   where loja_id = p_loja and origem = 'DEVOLUCAO_FORNECEDOR' and ref = p_ref and codigo_produto = p_produto
     and codigo_local_estoque = p_local and linha = p_linha;
  if found then return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'cmc', v_exist.cmc_apos); end if;

  insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p_produto) on conflict do nothing;
  select * into v_custos from estoque_custos where loja_id = p_loja and codigo_produto = p_produto for update;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto) values (p_loja, p_local, p_produto) on conflict do nothing;
  select saldo into v_saldo_ant from estoque_saldos
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;

  v_saldo_novo := v_saldo_ant - v_q;
  v_total_novo := v_custos.saldo_total - v_q;
  -- HIPÓTESE (R9): refaz o custo médio sem as unidades devolvidas; saldo ≤ 0 ou resultado ≤ 0 mantém o custo médio
  if v_total_novo > 0 and coalesce(p_custo, 0) > 0 then
    v_cmc_novo := round((v_custos.saldo_total * v_custos.cmc - v_q * p_custo) / v_total_novo, 6);
    if v_cmc_novo <= 0 then v_cmc_novo := v_custos.cmc; end if;
  else
    v_cmc_novo := v_custos.cmc;
  end if;

  insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade,
      custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, custo_estimado, user_id, obs, data_ref)
  values (p_loja, p_local, p_produto, 'SAI', 'DEVOLUCAO_FORNECEDOR', p_ref, p_linha, -v_q,
      coalesce(nullif(p_custo, 0), v_custos.cmc), v_saldo_novo, v_total_novo, v_cmc_novo, coalesce(p_custo, 0) <= 0, p_user, p_obs,
      (now() at time zone 'America/Sao_Paulo')::date)
  returning id into v_id;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo, updated_at = now()
   where loja_id = p_loja and codigo_produto = p_produto;

  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select p_loja, p_local, p_produto, (now() at time zone 'America/Sao_Paulo')::date, pr.codigo, pr.descricao,
         v_saldo_novo, v_saldo_novo, v_cmc_novo, pr.estoque_minimo
    from (select 1) x left join produtos pr on pr.loja_id = p_loja and pr.codigo_produto = p_produto
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc, updated_at = now();

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'saldo', v_saldo_novo, 'cmc', v_cmc_novo, 'negativo', v_saldo_novo < 0);
end $function$;

notify pgrst, 'reload schema';
