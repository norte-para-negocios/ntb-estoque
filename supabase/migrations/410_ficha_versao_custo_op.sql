-- 410 — Fase 5 (T5.5): versão da ficha técnica por movimento, custo pela ficha (árvore de sub-receitas) e OP com custo
-- real × teórico. Só LEITURA, só estoque próprio. Nenhuma função que grava muda: `produzir`, `consumo_por_receita`,
-- `registrar_movimento`, `salvar_ficha` e o ledger ficam como estão (saldo e custo não mudam).
-- Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 5, T5.5).
-- Depende da 133 (fichas_tecnicas, estoque_receita_consumos), 136 (ordens_producao_proprio), 311/317 (estoque_movimentos_efetivo).
--
-- O QUE JÁ ERA GRAVADO (conferido em produção em 06/11/2026, por isso nada novo é escrito):
--   * produzir (OP manual, "Produzir lote" e OP automática da venda do Norte Vendas, via op_proprio_concluir) grava a ficha
--     usada em ordens_producao_proprio.ficha_id (NOT NULL, FK de fichas_tecnicas), uma linha por ref; os movimentos da OP
--     (consumo dos insumos e entrada do produto) têm origem PRODUCAO e a mesma ref (chave única loja + ref), e cada consumo
--     está em ordens_producao_proprio_itens.movimento_id. ODARA: 0 movimentos PRODUCAO sem OP.
--   * consumo_por_receita grava, por movimento, a ficha e a versão em estoque_receita_consumos (movimento_id, ficha_id, versao).
--   * fichas_tecnicas é versionada: itens imutáveis (trg_ficha_itens_imutavel), salvar = versão nova.
--   * ciclo: o gatilho trg_ficha_itens_ciclo (ficha_tem_ciclo) recusa, ao salvar, insumo que é o próprio produto ou que
--     já usa o produto em qualquer nível (erro 23514). O teste 410 prova direto e indireto.
--
-- 1) ficha_versao_dos_movimentos(loja, ids[]): ficha e versão de cada movimento feito pela receita. Estorno herda a do
--    movimento que ele desfaz. Movimento que não veio de receita não aparece.
-- 2) _custo_insumo_em(loja, produto, data, ate_id): custo de 1 unidade do insumo naquele ponto do ledger efetivo (ordem
--    data efetiva, id): CMC; sem CMC, o último custo de entrada conhecido até ali (estimado), como o consumo da 314.
-- 3) _custo_ficha_em(...): custo de 1 unidade pela ficha, descendo nas sub-receitas (prato → PI → insumos). Sub-receita
--    usa a versão da ficha dela que existia no momento (maior versão criada até lá). Ciclo/profundidade > 10 = erro.
-- 4) op_custo_real_teorico(loja, ref): uma execução de OP (ordens_producao_proprio).
--    REAL     = Σ quantidade consumida × custo unitário EFETIVO do movimento de consumo (estoque_movimentos_efetivo:
--               inclui as revisões da 311–317 e 351). É o que os insumos custaram de fato.
--    TEÓRICO  = ficha usada pela OP (a versão gravada) × quantidade ÷ rendimento; cada item a custo pela ficha dele quando
--               ele tem ficha (sub-receita, até o insumo comprado) ou pelo custo do insumo no momento da OP (item 2).
--               O momento é a entrada do produto da OP no ledger efetivo (data efetiva, id).
--    DIFERENÇA = real − teórico. Insumo comprado sai igual nos dois (mesmo custo médio); a diferença aparece quando o
--               PI saiu do estoque a um custo diferente do que a ficha dele dá hoje, quando um insumo saiu com custo
--               estimado, ou quando a ficha foi aberta na baixa (expandir_na_venda) de outro jeito.
--    GRAVADO  = ordens_producao_proprio.custo_total (o custo no momento da conclusão; não muda com revisões).
begin;

create or replace function public.ficha_versao_dos_movimentos(p_loja bigint, p_ids bigint[])
returns table (movimento_id bigint, ficha_id bigint, versao integer, codigo_produto_ficha bigint, via text)
language sql stable security definer set search_path = public as $$
  with alvo as (
    select m.id, coalesce(m.reverses_id, m.id) as base_id
      from estoque_movimentos m
     where m.loja_id = p_loja and m.id = any (p_ids)
  ), base as (
    select a.id, b.id as base_id, b.origem, b.ref
      from alvo a join estoque_movimentos b on b.id = a.base_id and b.loja_id = p_loja
  ), achados as (
    select b.id, rc.ficha_id, 'venda'::text as via
      from base b join estoque_receita_consumos rc on rc.movimento_id = b.base_id
    union all
    select b.id, o.ficha_id, 'op'::text
      from base b join ordens_producao_proprio o on o.loja_id = p_loja and o.ref = b.ref
     where b.origem = 'PRODUCAO'
       and not exists (select 1 from estoque_receita_consumos rc where rc.movimento_id = b.base_id)
  )
  select x.id, f.id, f.versao, f.codigo_produto, x.via
    from achados x join fichas_tecnicas f on f.id = x.ficha_id and f.loja_id = p_loja
$$;

create or replace function public._custo_insumo_em(p_loja bigint, p_produto bigint, p_data date, p_ate_id bigint)
returns table (custo numeric, estimado boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_cmc numeric; v_ult numeric;
begin
  select e.cmc_apos into v_cmc from estoque_movimentos_efetivo e
   where e.loja_id = p_loja and e.codigo_produto = p_produto and (e.data_ref, e.id) <= (p_data, p_ate_id)
   order by e.data_ref desc, e.id desc limit 1;
  if coalesce(v_cmc, 0) > 0 then custo := v_cmc; estimado := false; return next; return; end if;
  select e.custo_unitario into v_ult from estoque_movimentos_efetivo e
   where e.loja_id = p_loja and e.codigo_produto = p_produto and (e.data_ref, e.id) <= (p_data, p_ate_id)
     and e.quantidade > 0 and e.reverses_id is null and coalesce(e.custo_unitario, 0) > 0
   order by e.data_ref desc, e.id desc limit 1;
  custo := coalesce(v_ult, 0); estimado := true; return next;
end $$;

-- Ficha de um produto como estava no momento p_em (maior versão criada até lá).
create or replace function public._ficha_em(p_loja bigint, p_produto bigint, p_em timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select f.id from fichas_tecnicas f
   where f.loja_id = p_loja and f.codigo_produto = p_produto and f.created_at <= p_em
   order by f.versao desc limit 1
$$;

-- Custo de 1 unidade de p_produto pela ficha p_ficha, descendo nas sub-receitas. sem_custo/estimado = nº de insumos
-- comprados sem custo / com custo estimado na árvore.
create or replace function public._custo_ficha_em(p_loja bigint, p_ficha bigint, p_data date, p_ate_id bigint, p_em timestamptz,
                                                  p_nivel integer, p_caminho bigint[])
returns table (custo numeric, sem_custo integer, estimado integer)
language plpgsql stable security definer set search_path = public as $$
declare f fichas_tecnicas%rowtype; i record; v_sub bigint; s record; c record;
        v_total numeric := 0; v_sem int := 0; v_est int := 0;
begin
  if p_nivel > 10 then raise exception 'Receita com profundidade excessiva (ciclo?)' using errcode = '23514'; end if;
  select * into f from fichas_tecnicas where id = p_ficha and loja_id = p_loja;
  if not found then custo := null; sem_custo := 0; estimado := 0; return next; return; end if;
  for i in select * from ficha_tecnica_itens where ficha_id = f.id order by ordem loop
    if i.codigo_insumo = any (p_caminho) then raise exception 'Receita circular em %', i.codigo_insumo using errcode = '23514'; end if;
    v_sub := _ficha_em(p_loja, i.codigo_insumo, p_em);
    if v_sub is not null then
      select * into s from _custo_ficha_em(p_loja, v_sub, p_data, p_ate_id, p_em, p_nivel + 1, p_caminho || i.codigo_insumo);
      v_total := v_total + i.quantidade_bruta * coalesce(s.custo, 0);
      v_sem := v_sem + s.sem_custo; v_est := v_est + s.estimado;
    else
      select * into c from _custo_insumo_em(p_loja, i.codigo_insumo, p_data, p_ate_id);
      v_total := v_total + i.quantidade_bruta * c.custo;
      if c.custo <= 0 then v_sem := v_sem + 1; elsif c.estimado then v_est := v_est + 1; end if;
    end if;
  end loop;
  custo := round(v_total / f.rendimento, 6); sem_custo := v_sem; estimado := v_est; return next;
end $$;

create or replace function public.op_custo_real_teorico(p_loja bigint, p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o ordens_producao_proprio%rowtype; f fichas_tecnicas%rowtype; v_ate bigint; v_data date; v_itens jsonb;
        v_real numeric; v_teo numeric; v_sem int; v_est int;
begin
  select * into o from ordens_producao_proprio where loja_id = p_loja and ref = p_ref;
  if not found then return null; end if;
  select * into f from fichas_tecnicas where id = o.ficha_id;
  -- momento da OP = entrada do produto no ledger efetivo; sem ela, o último consumo da OP
  select e.id, e.data_ref into v_ate, v_data from estoque_movimentos_efetivo e
   where e.loja_id = p_loja and e.origem = 'PRODUCAO' and e.ref = p_ref and e.codigo_produto = o.codigo_produto
     and e.quantidade > 0 and e.reverses_id is null order by e.id limit 1;
  if v_ate is null then
    select e.id, e.data_ref into v_ate, v_data from estoque_movimentos_efetivo e
     where e.loja_id = p_loja and e.origem = 'PRODUCAO' and e.ref = p_ref and e.reverses_id is null order by e.id desc limit 1;
  end if;
  v_data := coalesce(v_data, (o.created_at at time zone 'America/Sao_Paulo')::date);
  v_ate := coalesce(v_ate, (select max(id) from estoque_movimentos where loja_id = p_loja));

  with real as (
    select i.codigo_insumo, sum(i.quantidade) as qtd,
           sum(i.quantidade * coalesce(e.custo_unitario, i.custo_unitario, 0)) as valor,
           bool_or(coalesce(e.custo_estimado, false)) as estimado
      from ordens_producao_proprio_itens i
      left join estoque_movimentos_efetivo e on e.id = i.movimento_id
     where i.ordem_id = o.id
     group by i.codigo_insumo
  ), teo_base as (
    select it.codigo_insumo, it.ordem, it.quantidade_bruta * o.quantidade / f.rendimento as qtd,
           _ficha_em(p_loja, it.codigo_insumo, o.created_at) as sub
      from ficha_tecnica_itens it where it.ficha_id = f.id
  ), teo as (
    select t.codigo_insumo, t.ordem, t.qtd, t.sub,
           case when t.sub is not null then sf.custo else ci.custo end as unit,
           case when t.sub is not null then sf.sem_custo else (case when ci.custo <= 0 then 1 else 0 end) end as sem,
           case when t.sub is not null then sf.estimado else (case when ci.custo > 0 and ci.estimado then 1 else 0 end) end as est
      from teo_base t
      left join lateral _custo_ficha_em(p_loja, t.sub, v_data, v_ate, o.created_at, 1, array[o.codigo_produto, t.codigo_insumo]) sf on t.sub is not null
      left join lateral _custo_insumo_em(p_loja, t.codigo_insumo, v_data, v_ate) ci on t.sub is null
  ), juntos as (
    select coalesce(r.codigo_insumo, t.codigo_insumo) as codigo_insumo, coalesce(t.ordem, 1000) as ordem,
           r.qtd as qtd_real, round(r.valor, 6) as custo_real, coalesce(r.estimado, false) as real_estimado,
           round(t.qtd, 6) as qtd_teorica, round(t.qtd * t.unit, 6) as custo_teorico, t.unit as unit_teorico,
           (t.sub is not null) as sub_receita, (select fs.versao from fichas_tecnicas fs where fs.id = t.sub) as versao_sub,
           coalesce(t.sem, 0) as sem, coalesce(t.est, 0) as est
      from real r full join teo t on t.codigo_insumo = r.codigo_insumo
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo_insumo', j.codigo_insumo, 'codigo', p.codigo, 'descricao', p.descricao, 'unidade', p.unidade,
           'qtd_real', j.qtd_real, 'custo_real', j.custo_real, 'real_estimado', j.real_estimado,
           'custo_unit_real', case when j.qtd_real > 0 then round(j.custo_real / j.qtd_real, 6) end,
           'qtd_teorica', j.qtd_teorica, 'custo_unit_teorico', round(j.unit_teorico, 6), 'custo_teorico', j.custo_teorico,
           'sub_receita', j.sub_receita, 'versao_sub', j.versao_sub, 'sem_custo', j.sem, 'estimado', j.est,
           'diferenca', round(coalesce(j.custo_real, 0) - coalesce(j.custo_teorico, 0), 6)) order by j.ordem, j.codigo_insumo), '[]'::jsonb),
         round(coalesce(sum(j.custo_real), 0), 6), round(coalesce(sum(j.custo_teorico), 0), 6),
         coalesce(sum(j.sem), 0), coalesce(sum(j.est), 0)
    into v_itens, v_real, v_teo, v_sem, v_est
    from juntos j left join produtos p on p.loja_id = p_loja and p.codigo_produto = j.codigo_insumo;

  return jsonb_build_object(
    'ref', o.ref, 'ordem_id', o.id, 'status', o.status, 'codigo_produto', o.codigo_produto, 'quantidade', o.quantidade,
    'ficha_id', f.id, 'versao', f.versao, 'rendimento', f.rendimento, 'data', v_data,
    'custo_gravado', o.custo_total, 'custo_real', v_real, 'custo_teorico', v_teo,
    'diferenca', round(v_real - v_teo, 6),
    'diferenca_pct', case when v_teo > 0 then round((v_real - v_teo) / v_teo * 100, 2) end,
    'teorico_sem_custo', v_sem, 'teorico_estimado', v_est, 'itens', v_itens);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ficha_versao_dos_movimentos(bigint, bigint[])',
    '_custo_insumo_em(bigint, bigint, date, bigint)',
    '_ficha_em(bigint, bigint, timestamptz)',
    '_custo_ficha_em(bigint, bigint, date, bigint, timestamptz, integer, bigint[])',
    'op_custo_real_teorico(bigint, text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
