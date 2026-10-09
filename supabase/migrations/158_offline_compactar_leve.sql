-- 158: offline_compactar mais leve (achado da revisão do canal desktop, 2026-10-09).
-- Folga de reprocessamento 50.000 -> 5.000 ids (~5 min de outbox; transação mais longa que isso
-- escrevendo na outbox não existe neste app) e não gasta versão/escrita com o que já está
-- registrado. As rotas deixam de compactar a cada pull: o crontab de 1 minuto basta.
create or replace function offline_compactar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
  v_max bigint;
  n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('offline_compactar')) then
    return 0;
  end if;
  select (valor #>> '{}')::bigint into v_ultimo from offline_meta where chave = 'ultimo_outbox';
  select max(id) into v_max from outbox;
  if v_max is null or v_max <= coalesce(v_ultimo, 0) - 5000 then
    return 0;
  end if;

  with fonte as (
    select o.id, o.table_name, o.operation, o.row_data, t.pk_cols, t.regra, t.loja_col, t.pai_tabela, t.pai_fk
    from outbox o
    join offline_tabelas t on t.tabela = o.table_name and t.modo = 'log'
    where o.id > greatest(coalesce(v_ultimo, 0) - 5000, 0) and o.id <= v_max
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

