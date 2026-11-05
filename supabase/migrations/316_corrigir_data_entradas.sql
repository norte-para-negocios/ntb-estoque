-- 316 — corrigir_data_entradas_compra: põe as entradas de compra já lançadas na data da nota (Norte ERP, custo certo,
-- Task 6, 04/11/2026). Depende de 311 (revisões), 312 (reprocessar_custo), 313 (_data_entrada_compra) e 315 (CMV efetivo).
--
-- Para cada compra lançada da loja (compras_proprio lançada/parcial) cujo movimento de entrada (origem COMPRA, item
-- lançado, não estornado) tem data efetiva diferente da data da nota — mesma regra da 313: dhSaiEnt do XML, senão
-- emissão; nunca no futuro; nunca antes do início do ledger da loja; nunca em mês fechado —, grava uma revisão de data
-- (motivo 'entrada pela data da nota') e, no fim, chama reprocessar_custo UMA vez com TODOS os produtos da loja que têm
-- movimento no ledger desde a menor data envolvida (p_desde ou a data antiga/nova de uma entrada movida) — não só os de
-- entrada movida: produto só com par de estorno (fardo errado) também tem o CMC distorcido. Só olha entradas com data
-- efetiva ou data da nota a partir de p_desde.
-- Idempotente: na 2ª chamada nada difere e o reprocessamento não grava nada.
-- Movimento com data atual em mês fechado não muda (aviso).
--
-- Retorno: { compras, movimentos_revisados (datas), produtos (de entrada movida), produtos_reprocessados, custos_revisados,
--            lote_reprocesso, desde, avisos, cmv_antes, cmv_depois, reprocessamento } — cmv_* = CMV por mês (YYYY-MM) a partir do mês de p_desde, por vendas_proprio_cmv.
-- Prévia: p_simular = true faz tudo e termina com a exceção PF900 ('Prévia: nada foi gravado', DETAIL = o retorno em
-- JSON): a transação desfaz tudo. Em psql também dá para rodar dentro de BEGIN … ROLLBACK.
--
-- Sem acesso pela API (só supabase_admin, pelo psql do servidor). Loja de outro modo = erro 22023.
-- ODARA é loja aberta: rodar depois de 01:00, com backup antes. Depois: analyze estoque_mov_revisao; (os relatórios leem a
-- visão efetiva; com estatística velha de tabela "vazia" o planejador varre a tabela inteira por movimento).
--   select corrigir_data_entradas_compra(15, '2026-10-01', 'correcao custo outubro', true);   -- prévia (PF900)
--   select corrigir_data_entradas_compra(15, '2026-10-01', 'correcao custo outubro');          -- de verdade
-- Teste: scripts/testes-sql/316_corrigir_data_entradas.sql (cópia local).

create or replace function public.corrigir_data_entradas_compra(p_loja bigint, p_desde date, p_motivo text, p_simular boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
set enable_seqscan = off as $$ -- mesma razão do reprocessar_custo (312): revisões crescendo dentro da transação
declare
  v_modo text; v_lote uuid := gen_random_uuid(); x record; v_alvo date; v_fech date; v_aberto date;
  v_compras bigint[] := '{}'; v_prods bigint[] := '{}'; v_n int := 0; v_min date; v_avisos jsonb := '[]'::jsonb;
  v_rep jsonb; v_antes jsonb; v_depois jsonb; v_res jsonb; v_todos bigint[];
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  if p_desde is null or p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'corrigir_data_entradas_compra: desde e motivo são obrigatórios' using errcode = '22023';
  end if;
  select max(mes) into v_fech from estoque_periodo_fechado where loja_id = p_loja;
  v_aberto := case when v_fech is null then null else (v_fech + interval '1 month')::date end;

  select coalesce(jsonb_object_agg(mes, cmv), '{}'::jsonb) into v_antes from (
    select to_char(v.data, 'YYYY-MM') as mes, round(sum(c.cmv), 2) as cmv
      from vendas_proprio v join vendas_proprio_cmv c on c.venda_id = v.id
     where v.loja_id = p_loja and v.data >= date_trunc('month', p_desde) and not v.cancelado and not v.devolvido
     group by 1) t;

  for x in
    select c.id as compra_id, e.id as mov_id, e.codigo_produto, e.data_ref, e.custo_unitario, e.cmc_apos, e.saldo_apos,
           e.saldo_total_apos, e.custo_estimado, (select d.data from _data_entrada_compra(p_loja, c.id, null) d) as alvo
      from compras_proprio c
      join compras_proprio_itens i on i.compra_id = c.id and i.lancado and i.movimento_id is not null
      join estoque_movimentos_efetivo e on e.id = i.movimento_id and e.origem = 'COMPRA'
     where c.loja_id = p_loja and c.status in ('lancada', 'parcial')
       and not exists (select 1 from estoque_movimentos s where s.reverses_id = e.id)
     order by c.id, i.linha
  loop
    v_alvo := x.alvo;
    continue when v_alvo is null or v_alvo = x.data_ref;
    continue when greatest(v_alvo, x.data_ref) < p_desde;
    if v_aberto is not null and x.data_ref < v_aberto then
      v_avisos := v_avisos || to_jsonb(format('Compra %s: a entrada de %s está num mês fechado e ficou como estava.',
                                              x.compra_id, to_char(x.data_ref, 'DD/MM/YYYY')));
      continue;
    end if;
    perform _revisar_movimento(x.mov_id, v_lote, v_alvo, x.custo_unitario, x.cmc_apos, x.saldo_apos, x.saldo_total_apos,
                               x.custo_estimado, 'entrada pela data da nota');
    v_n := v_n + 1;
    if not x.compra_id = any(v_compras) then v_compras := v_compras || x.compra_id; end if;
    if not x.codigo_produto = any(v_prods) then v_prods := v_prods || x.codigo_produto; end if;
    v_min := least(coalesce(v_min, v_alvo), v_alvo, x.data_ref);
  end loop;

  -- todos os produtos com movimento desde a menor data envolvida
  v_min := least(coalesce(v_min, p_desde), p_desde);
  v_todos := array(select distinct e.codigo_produto from estoque_movimentos_efetivo e where e.loja_id = p_loja and e.data_ref >= v_min
                   union select unnest(v_prods) order by 1);
  if cardinality(v_todos) > 0 then
    v_rep := reprocessar_custo(p_loja, v_todos, v_min, p_motivo);
    v_avisos := v_avisos || coalesce(v_rep->'avisos', '[]'::jsonb);
  end if;

  select coalesce(jsonb_object_agg(mes, cmv), '{}'::jsonb) into v_depois from (
    select to_char(v.data, 'YYYY-MM') as mes, round(sum(c.cmv), 2) as cmv
      from vendas_proprio v join vendas_proprio_cmv c on c.venda_id = v.id
     where v.loja_id = p_loja and v.data >= date_trunc('month', p_desde) and not v.cancelado and not v.devolvido
     group by 1) t;

  v_res := jsonb_build_object('compras', cardinality(v_compras), 'movimentos_revisados', v_n,
                              'produtos', to_jsonb(array(select p from unnest(v_prods) p order by 1)),
                              'produtos_reprocessados', coalesce((v_rep->>'produtos')::int, 0),
                              'custos_revisados', coalesce((v_rep->>'movimentos_revisados')::int, 0),
                              'lote_reprocesso', v_rep->'lote', 'desde', v_min, 'avisos', v_avisos,
                              'cmv_antes', v_antes, 'cmv_depois', v_depois, 'reprocessamento', v_rep);
  if p_simular then
    raise exception 'Prévia: nada foi gravado' using errcode = 'PF900', detail = v_res::text;
  end if;
  return v_res;
end $$;

revoke all on function public.corrigir_data_entradas_compra(bigint, date, text, boolean) from public, anon, authenticated, service_role;
