-- 312 — reprocessar_custo: refaz a cadeia de custo médio (CMC) do estoque próprio na ordem certa (Norte ERP, custo certo,
-- Task 2, 04/11/2026). Depende da 311 (estoque_mov_revisao, estoque_movimentos_efetivo, _revisar_movimento).
--
-- Regras (mesmas de lib/estoque/reprocessar-custo-puro.ts — quem muda uma muda a outra; Omie em
-- ~/Projects/omie-rea/regras/estoque-saldo-e-custo.md):
--   E9  entrada: CMC₁ = (S₀·C₀ + q·vu)/(S₀+q), também com S₀ < 0;  E10 S₀+q = 0 ou resultado ≤ 0 → CMC₁ = vu;
--   E12 saída sai pelo CMC vigente e não o altera.  CMC por loja × produto, 6 casas.
--   Ordem da cadeia = (data efetiva, id). Movimento e seu estorno saem juntos do custo médio (o saldo físico conta os
--   dois; o estorno vale o custo do movimento estornado). Entrada sem custo = estimada (CMC vigente, não muda o CMC).
--   TRF não muda custo. Entrada de OP = Σ consumos (efetivos) da mesma OP ÷ quantidade produzida. Devolução ao fornecedor
--   sai ao custo da entrada (231). Consumo de insumo com CMC 0 usa o último custo conhecido, estimado (314).
--
-- Estado inicial de cada produto = movimentos efetivos antes de "desde" (saldo = soma; CMC = cmc_apos do último que não
-- é de um par movimento/estorno; último custo = última entrada com custo). Se um estorno na janela estorna um movimento
-- anterior a "desde", o produto recua até esse movimento. Mês fechado (estoque_periodo_fechado) nunca é reprocessado:
-- começa no 1º dia depois do último mês fechado, com aviso.
--
-- Cascata: produtos feitos por OP que consumiram um produto da fila entram na fila (nível = maior distância; receita em
-- ciclo para em 20 níveis, com aviso). Processa por nível e código; trava pg_advisory_xact_lock(loja, produto) + linha de
-- estoque_custos (FOR UPDATE), sempre em ordem de código, antes de ler qualquer coisa.
--
-- Grava revisão só onde custo, CMC, saldo, saldo total ou "estimado" mudam; no fim regrava estoque_custos
-- (cmc, saldo_total, ultimo_custo) com o fim da cadeia. Saldos por local (estoque_saldos) não mudam: são somas.
--
-- Teste: scripts/testes-sql/312_reprocessar_custo.sql (cópia local, BEGIN … ROLLBACK). Aplicar com -1, depois de 01:00:
--   node scripts/aplicar-migration.mjs supabase/migrations/312_reprocessar_custo.sql
-- Conferir: \df reprocessar_custo (1 overload).

-- Produtos cuja cadeia de custo depende dos pedidos: os pedidos (nível 0) e, em cascata, os produtos feitos por OP
-- (PRD/PRODUCAO) que consumiram um produto da fila a partir de p_desde. Nível = maior distância; para em 20 (ciclo = true).
-- Usada por reprocessar_custo e por lancar_compra (313), para travar tudo ANTES de gravar, sempre na mesma ordem.
create or replace function public._cascata_custo(p_loja bigint, p_produtos bigint[], p_desde date,
    out produtos bigint[], out niveis int[], out ciclo boolean)
language plpgsql stable security definer set search_path = public set enable_seqscan = off as $$
declare v_front bigint[]; v_prox bigint[]; v_k int; v_i int; p bigint;
begin
  produtos := array(select distinct x from unnest(coalesce(p_produtos, '{}')) x where x is not null order by 1);
  niveis := array_fill(0, array[cardinality(produtos)]);
  ciclo := false;
  v_front := produtos;
  for v_k in 1..21 loop
    v_prox := array(
      select distinct e.codigo_produto
        from estoque_movimentos_efetivo cns
        join estoque_movimentos e on e.loja_id = cns.loja_id and e.ref = cns.ref and e.origem = 'PRODUCAO'
                                 and e.tipo = 'PRD' and e.quantidade > 0
       where cns.loja_id = p_loja and cns.codigo_produto = any(v_front) and cns.origem = 'PRODUCAO' and cns.tipo = 'PRD'
         and cns.quantidade < 0 and cns.data_ref >= p_desde and e.codigo_produto <> cns.codigo_produto
       order by 1);
    exit when cardinality(v_prox) = 0;
    if v_k = 21 then ciclo := true; exit; end if;
    foreach p in array v_prox loop
      v_i := array_position(produtos, p);
      if v_i is null then produtos := produtos || p; niveis := niveis || v_k; else niveis[v_i] := v_k; end if;
    end loop;
    v_front := v_prox;
  end loop;
end $$;
revoke all on function public._cascata_custo(bigint, bigint[], date) from public, anon, authenticated, service_role;

-- Trava o custo de cada produto (advisory por loja × produto + linha de estoque_custos FOR UPDATE) em ordem de código:
-- a mesma ordem do _travar_custos de produzir/consumo_por_receita, então nota × OP não se travam em cruz.
create or replace function public._travar_custo_produtos(p_loja bigint, p_produtos bigint[])
returns void
language plpgsql security definer set search_path = public as $$
declare p bigint;
begin
  for p in select distinct x from unnest(coalesce(p_produtos, '{}')) x where x is not null order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended(format('custo:%s:%s', p_loja, p), 7311));
    insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p) on conflict do nothing;
    perform 1 from estoque_custos where loja_id = p_loja and codigo_produto = p for update;
  end loop;
end $$;
revoke all on function public._travar_custo_produtos(bigint, bigint[]) from public, anon, authenticated, service_role;

create or replace function public.reprocessar_custo(p_loja bigint, p_produtos bigint[], p_desde date, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public
-- estoque_mov_revisao cresce DENTRO desta transação (milhares de linhas no 1º reprocessamento) e as estatísticas dizem
-- que ela é minúscula: o planejador escolhia varrer a tabela inteira a cada movimento lido pela visão (15 s com 5 mil
-- movimentos, contra 0,6 s pelo índice). Aqui só há buscas por índice.
set enable_seqscan = off as $$
declare
  v_modo text; v_lote uuid := gen_random_uuid();
  v_desde date; v_aberto date; v_fech date; v_avisos jsonb := '[]'::jsonb;
  v_todos bigint[]; v_nivel int[]; v_ciclo boolean; p bigint; v_ord bigint[];
  v_dp date; v_s numeric; v_scusto numeric; v_c numeric; v_ult numeric; v_loc jsonb; v_custos_par jsonb;
  m record; v_q numeric; v_custo numeric; v_est boolean; v_vu numeric; v_w numeric; v_val numeric; v_sl numeric;
  v_n_rev int := 0; v_rev_prod int; v_cascata jsonb := '[]'::jsonb; v_tem boolean; v_old estoque_custos%rowtype;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  if p_desde is null then raise exception 'reprocessar_custo: "desde" é obrigatório' using errcode = '22023'; end if;
  if p_motivo is null or btrim(p_motivo) = '' then raise exception 'reprocessar_custo: motivo é obrigatório' using errcode = '22023'; end if;
  if coalesce(cardinality(p_produtos), 0) = 0 then
    return jsonb_build_object('lote', v_lote, 'produtos', 0, 'movimentos_revisados', 0, 'desde_efetivo', p_desde,
                              'cascata', '[]'::jsonb, 'avisos', '[]'::jsonb);
  end if;

  -- mês fechado: começa no 1º dia depois do último mês fechado
  select max(mes) into v_fech from estoque_periodo_fechado where loja_id = p_loja;
  v_aberto := case when v_fech is null then null else (v_fech + interval '1 month')::date end;
  v_desde := p_desde;
  if v_aberto is not null and v_desde < v_aberto then
    v_avisos := v_avisos || to_jsonb(format('Mês fechado até %s: o custo só foi refeito a partir de %s (pedido: %s).',
                  to_char(v_fech, 'MM/YYYY'), to_char(v_aberto, 'DD/MM/YYYY'), to_char(p_desde, 'DD/MM/YYYY')));
    v_desde := v_aberto;
  end if;

  -- fila com cascata (nível = maior distância a partir dos produtos pedidos) e travas em ordem de código, antes de ler
  select c.produtos, c.niveis, c.ciclo into v_todos, v_nivel, v_ciclo from _cascata_custo(p_loja, p_produtos, v_desde) c;
  if v_ciclo then
    v_avisos := v_avisos || to_jsonb('A cascata de receitas parou em 20 níveis (receita em ciclo?). Confira as fichas técnicas.'::text);
  end if;
  perform _travar_custo_produtos(p_loja, v_todos);

  v_ord := array(select t.p from unnest(v_todos, v_nivel) as t(p, n) order by t.n, t.p);
  foreach p in array v_ord loop
    -- recua até o movimento estornado de um par que cruza "desde"
    select least(v_desde, min(o.data_ref)) into v_dp
      from estoque_movimentos_efetivo e join estoque_movimentos_efetivo o on o.id = e.reverses_id
     where e.loja_id = p_loja and e.codigo_produto = p and e.data_ref >= v_desde and o.data_ref < v_desde;
    v_dp := coalesce(v_dp, v_desde);
    if v_aberto is not null and v_dp < v_aberto then
      v_avisos := v_avisos || to_jsonb(format('Produto %s: estorno de movimento de mês fechado ficou na cadeia como movimento comum.', p));
      v_dp := v_aberto;
    end if;

    -- estado inicial
    select coalesce(sum(quantidade), 0), count(*) > 0 into v_s, v_tem
      from estoque_movimentos_efetivo where loja_id = p_loja and codigo_produto = p and data_ref < v_dp;
    select coalesce(jsonb_object_agg(x.l::text, x.s), '{}'::jsonb) into v_loc
      from (select codigo_local_estoque as l, sum(quantidade) as s from estoque_movimentos_efetivo
             where loja_id = p_loja and codigo_produto = p and data_ref < v_dp group by 1) x;
    select e.cmc_apos into v_c from estoque_movimentos_efetivo e
     where e.loja_id = p_loja and e.codigo_produto = p and e.data_ref < v_dp and e.reverses_id is null
       and not exists (select 1 from estoque_movimentos x where x.reverses_id = e.id)
     order by e.data_ref desc, e.id desc limit 1;
    v_c := coalesce(v_c, 0);
    select e.custo_unitario into v_ult from estoque_movimentos_efetivo e
     where e.loja_id = p_loja and e.codigo_produto = p and e.data_ref < v_dp and e.quantidade > 0 and e.tipo <> 'TRF'
       and not e.custo_estimado and coalesce(e.custo_unitario, 0) > 0 and e.reverses_id is null
       and not exists (select 1 from estoque_movimentos x where x.reverses_id = e.id)
     order by e.data_ref desc, e.id desc limit 1;
    v_scusto := v_s; v_custos_par := '{}'::jsonb; v_rev_prod := 0;

    for m in
      select e.*,
             exists (select 1 from estoque_movimentos x where x.reverses_id = e.id) as estornado,
             (e.reverses_id is not null and coalesce(
                (select r.data_efetiva from estoque_mov_revisao r where r.movimento_id = e.reverses_id order by r.id desc limit 1),
                (select o.data_ref from estoque_movimentos o where o.id = e.reverses_id)) >= v_dp) as estorno_no_par,
             ((e.tipo = 'PRD' and e.quantidade < 0) or exists (select 1 from estoque_receita_consumos rc where rc.movimento_id = e.id)) as consumo
        from estoque_movimentos_efetivo e
       where e.loja_id = p_loja and e.codigo_produto = p and e.data_ref >= v_dp
       order by e.data_ref, e.id
    loop
      v_tem := true;
      v_q := m.quantidade; v_est := false;
      if m.estornado or m.estorno_no_par then
        -- par movimento/estorno: fora do custo médio
        if m.estorno_no_par then
          v_custo := coalesce((v_custos_par ->> m.reverses_id::text)::numeric, v_c);
          v_est := m.custo_estimado;
        elsif v_q > 0 and not m.custo_estimado and coalesce(m.custo_original, 0) > 0 then
          v_custo := m.custo_original;
        else
          v_custo := v_c; v_est := case when v_q > 0 then m.custo_estimado else false end;
        end if;
      elsif m.tipo = 'TRF' then
        v_custo := v_c; v_scusto := v_scusto + v_q;
      elsif v_q > 0 then
        v_vu := null;
        if m.tipo = 'PRD' and m.origem = 'PRODUCAO' then
          select sum(-x.quantidade * coalesce(x.custo_unitario, 0)) into v_val from estoque_movimentos_efetivo x
           where x.loja_id = p_loja and x.origem = 'PRODUCAO' and x.ref = m.ref and x.tipo = 'PRD' and x.quantidade < 0;
          if coalesce(v_val, 0) > 0 then v_vu := round(round(v_val, 6) / v_q, 6); end if;
        elsif not m.custo_estimado and coalesce(m.custo_original, 0) > 0 then
          v_vu := m.custo_original;
        end if;
        if v_vu is not null and v_vu > 0 then
          v_custo := v_vu;
          if v_scusto + v_q = 0 then v_c := v_vu;
          else
            v_w := round((v_scusto * v_c + v_q * v_vu) / (v_scusto + v_q), 6);
            v_c := case when v_w <= 0 then v_vu else v_w end;
          end if;
          v_ult := v_vu;
        else
          v_custo := v_c; v_est := true;
        end if;
        v_scusto := v_scusto + v_q;
      elsif m.origem = 'DEVOLUCAO_FORNECEDOR' and coalesce(m.custo_original, 0) > 0 then
        v_custo := m.custo_original; v_est := m.custo_estimado;
        if v_scusto + v_q > 0 then
          v_w := round((v_scusto * v_c + v_q * v_custo) / (v_scusto + v_q), 6);
          if v_w > 0 then v_c := v_w; end if;
        end if;
        v_scusto := v_scusto + v_q;
      else
        if v_c > 0 then v_custo := v_c;
        elsif m.consumo and v_ult is not null and v_ult > 0 then v_custo := v_ult; v_est := true;
        else v_custo := v_c; v_est := m.consumo;
        end if;
        v_scusto := v_scusto + v_q;
      end if;

      v_s := round(v_s + v_q, 6); v_scusto := round(v_scusto, 6); v_custo := round(v_custo, 6);
      v_sl := round(coalesce((v_loc ->> m.codigo_local_estoque::text)::numeric, 0) + v_q, 6);
      v_loc := jsonb_set(v_loc, array[m.codigo_local_estoque::text], to_jsonb(v_sl));
      if m.estornado then v_custos_par := jsonb_set(v_custos_par, array[m.id::text], to_jsonb(v_custo)); end if;

      if m.custo_unitario is distinct from v_custo or m.cmc_apos is distinct from round(v_c, 6)
         or m.saldo_apos is distinct from v_sl or m.saldo_total_apos is distinct from v_s or m.custo_estimado is distinct from v_est then
        perform _revisar_movimento(m.id, v_lote, m.data_ref, v_custo, v_c, v_sl, v_s, v_est, p_motivo);
        v_rev_prod := v_rev_prod + 1;
      end if;
    end loop;

    if v_tem then
      select * into v_old from estoque_custos where loja_id = p_loja and codigo_produto = p;
      if v_old.saldo_total is distinct from v_s then
        v_avisos := v_avisos || to_jsonb(format('Produto %s: saldo total era %s e a soma do ledger é %s (corrigido).', p, v_old.saldo_total, v_s));
      end if;
      update estoque_custos set cmc = round(v_c, 6), saldo_total = v_s, ultimo_custo = coalesce(v_ult, ultimo_custo), updated_at = now()
       where loja_id = p_loja and codigo_produto = p
         and (cmc is distinct from round(v_c, 6) or saldo_total is distinct from v_s or ultimo_custo is distinct from coalesce(v_ult, ultimo_custo));
    end if;
    v_n_rev := v_n_rev + v_rev_prod;
    if v_rev_prod > 0 and not (p = any(p_produtos)) then v_cascata := v_cascata || to_jsonb(p); end if;
  end loop;

  return jsonb_build_object('lote', v_lote, 'produtos', cardinality(v_todos), 'movimentos_revisados', v_n_rev,
                            'desde_efetivo', v_desde, 'cascata', v_cascata, 'avisos', v_avisos);
end $$;

revoke all on function public.reprocessar_custo(bigint, bigint[], date, text) from public, anon, authenticated;
grant execute on function public.reprocessar_custo(bigint, bigint[], date, text) to service_role;

notify pgrst, 'reload schema';
