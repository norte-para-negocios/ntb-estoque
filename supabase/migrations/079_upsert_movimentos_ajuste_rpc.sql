-- O supabase-js/PostgREST nao consegue expressar ON CONFLICT contra um
-- indice UNICO PARCIAL via .upsert({ onConflict: 'loja_id,id_ajuste' }) --
-- Postgres exige que o predicado do indice parcial (WHERE id_ajuste IS NOT
-- NULL, migration 059) seja repetido no ON CONFLICT pra ser inferido como
-- arbitro, e o PostgREST nao gera isso. Resultado: todo upsert do cron de
-- sync-ajustes com dado novo falhava com "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification" desde 2026-06-29 (dia
-- em que o indice parcial e o cron foram introduzidos juntos) -- a tabela
-- so parecia atualizada porque scripts/sync-ajustes-omie.mjs (SQL cru, ja
-- com o WHERE certo) foi rodado manualmente durante a Onda 1 desta sessao.
-- RPC contorna a limitacao do PostgREST fazendo o INSERT ... ON CONFLICT
-- certo direto em SQL.
create or replace function upsert_movimentos_ajuste(p_rows jsonb)
returns void
language plpgsql
security definer
as $$
begin
  insert into movimentos (
    loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque,
    codigo_local_estoque_destino, data, motivo, obs, origem, status
  )
  select
    (r->>'loja_id')::bigint,
    (r->>'id_ajuste')::bigint,
    (r->>'id_prod')::bigint,
    r->>'tipo',
    (r->>'quan')::numeric,
    (r->>'valor')::numeric,
    (r->>'codigo_local_estoque')::bigint,
    (r->>'codigo_local_estoque_destino')::bigint,
    (r->>'data')::timestamptz,
    r->>'motivo',
    r->>'obs',
    r->>'origem',
    r->>'status'
  from jsonb_array_elements(p_rows) as r
  on conflict (loja_id, id_ajuste) where id_ajuste is not null do update set
    id_prod = excluded.id_prod,
    tipo = excluded.tipo,
    quan = excluded.quan,
    valor = excluded.valor,
    codigo_local_estoque = excluded.codigo_local_estoque,
    codigo_local_estoque_destino = excluded.codigo_local_estoque_destino,
    data = excluded.data,
    motivo = excluded.motivo,
    obs = excluded.obs,
    origem = excluded.origem,
    status = excluded.status,
    updated_at = now();
end;
$$;
