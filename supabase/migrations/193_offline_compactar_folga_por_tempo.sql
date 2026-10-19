-- 193: offline_compactar() com folga de reprocessamento por TEMPO em vez de 5.000 ids (Fase I, 19/10/2026).
--
-- Medido em produção: roda a cada minuto (crontab), 13,4 mil chamadas desde 26/09, 245 ms em média, pico 4 s.
-- Só a leitura relê ~5.000 linhas da outbox TODA vez (141 ms medidos), mesmo quando quase nada é novo: a folga
-- existe para pegar transação que ganhou id antes e confirmou depois, e a 158 a fixou em 5.000 ids. Às 18:57 UTC de
-- 19/10 a janela de 5.000 ids cobria desde 18:38 do dia anterior, mas só 358 linhas eram dos últimos 10 minutos.
-- E na rajada de hora em hora (até 15 mil linhas) 5.000 ids são menos de 1 minuto: a folga por contagem ficava
-- curta justamente quando mais precisa.
-- Agora: relê só o que entrou nos últimos 10 minutos (created_at = início da transação que gravou; "transação
-- mais longa que 5 min escrevendo na outbox não existe neste app", 158) além do que é novo. Usa o índice
-- outbox_created_at_idx_n. Resto do corpo idêntico ao da 158 (produção, md5 conferido em 19/10).
--
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 193_offline_compactar_folga_por_tempo.sql
-- Reverter: reaplicar supabase/migrations/158_offline_compactar_leve.sql (só tem esta função).
-- Teste: scripts/testes-sql/193_offline_compactar_folga_por_tempo.sql

create or replace function offline_compactar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
  v_max bigint;
  v_inicio bigint;
  n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('offline_compactar')) then
    return 0;
  end if;
  select (valor #>> '{}')::bigint into v_ultimo from offline_meta where chave = 'ultimo_outbox';
  select max(id) into v_max from outbox;
  -- folga: tudo depois do último processado + o que foi gravado nos últimos 10 minutos (pode ter confirmado depois)
  select least(coalesce(v_ultimo, 0), coalesce(min(id) - 1, coalesce(v_ultimo, 0))) into v_inicio
    from outbox where created_at > now() - interval '10 minutes';
  if v_max is null or v_max <= v_inicio then
    return 0;
  end if;

  with fonte as (
    select o.id, o.table_name, o.operation, o.row_data, t.pk_cols, t.regra, t.loja_col, t.pai_tabela, t.pai_fk
    from outbox o
    join offline_tabelas t on t.tabela = o.table_name and t.modo = 'log'
    where o.id > greatest(v_inicio, 0) and o.id <= v_max
  ), chaves as (
    select distinct on (f.table_name, k.pk)
      f.table_name, k.pk, f.id, f.operation,
      case
        when f.regra = 'loja' then (f.row_data ->> f.loja_col)::bigint
        when f.regra = 'lojas' then (f.row_data ->> 'id')::bigint
        when f.regra = 'pai' and f.pai_tabela = 'vendas_proprio' then
          (select vp.loja_id from vendas_proprio vp where vp.id = (f.row_data ->> f.pai_fk)::bigint)
        when f.regra = 'pai' and f.pai_tabela = 'ordens_producao_proprio' then
          (select op.loja_id from ordens_producao_proprio op where op.id = (f.row_data ->> f.pai_fk)::bigint)
        else null
      end as loja_id
    from fonte f
    cross join lateral (
      select jsonb_object_agg(c, f.row_data -> c) as pk from unnest(f.pk_cols) c
    ) k
    order by f.table_name, k.pk, f.id desc
  )
  insert into offline_versoes as v (tabela, pk, loja_id, versao, apagado, outbox_id, em)
  select c.table_name, c.pk, c.loja_id, nextval('offline_versao_seq'), c.operation = 'DELETE', c.id, now()
  from chaves c
  -- já registrado (reprocessamento da folga): pula sem gastar versão nem escrever
  where not exists (
    select 1 from offline_versoes x where x.tabela = c.table_name and x.pk = c.pk and x.outbox_id >= c.id
  )
  on conflict (tabela, pk) do update
    set versao = excluded.versao,
        apagado = excluded.apagado,
        outbox_id = excluded.outbox_id,
        loja_id = coalesce(excluded.loja_id, v.loja_id),
        em = excluded.em
    where excluded.outbox_id > v.outbox_id;
  get diagnostics n = row_count;

  update offline_meta set valor = to_jsonb(v_max) where chave = 'ultimo_outbox';
  return n;
end $$;
