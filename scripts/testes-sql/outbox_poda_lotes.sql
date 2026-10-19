-- Fase I (19/10/2026): poda da outbox — DELETE único (crontab atual) × lotes de 5.000 por id
-- (scripts/outbox-podar-lotes.sh), com o volume de produção. Só no banco local de teste (fi).
-- Rodar: docker exec -i ntb-teste-sql psql -U postgres -d fi -v ON_ERROR_STOP=1 -f - < scripts/testes-sql/outbox_poda_lotes.sql
--
-- Perfil de produção (19/10, última hora): 16,4 mil linhas/h; 93 % faturamento_importado (149 B de row_data),
-- o resto 800 B; tabela com ~25 h (a poda roda de hora em hora e apaga o que passou de 24 h).
\timing off
set client_min_messages = warning;

create or replace procedure fi_gerar_outbox(p_por_hora int, p_pct_fat numeric) language plpgsql as $$
begin
  truncate outbox restart identity;
  insert into outbox (table_name, operation, row_data, created_at)
  select case when random() < p_pct_fat then 'faturamento_importado' else 'produtos' end,
         case when g % 2 = 0 then 'INSERT' else 'DELETE' end,
         case when random() < p_pct_fat
              then jsonb_build_object('loja_id', 5, 'dimensao', 'produto', 'rotulo', 'PRODUTO ' || g, 'mes', '2026-10', 'valor', g)
              else jsonb_build_object('id', g, 'loja_id', 5, 'descricao', repeat('x', 600), 'codigo', 'P' || g) end,
         now() - interval '25 hours' + (g * (interval '1 hour' / p_por_hora))
  from generate_series(1, 25 * p_por_hora) g;
  delete from offline_meta where chave = 'ultimo_outbox';
  insert into offline_meta values ('ultimo_outbox', to_jsonb((select max(id) from outbox)));
  analyze outbox;
end $$;

-- poda em lotes: mesma SQL do scripts/outbox-podar-lotes.sh, um COMMIT por lote
create or replace procedure fi_podar_lotes(p_lote int, inout p_total int default 0, inout p_lotes int default 0, inout p_max_ms numeric default 0) language plpgsql as $$
declare n int; t0 timestamptz;
begin
  loop
    t0 := clock_timestamp();
    with alvo as (
      select id from outbox
      where created_at < now() - interval '1 day'
        and id < coalesce((select (valor #>> '{}')::bigint from offline_meta where chave = 'ultimo_outbox'), 0) - 5000
      order by id limit p_lote
    ), d as (delete from outbox o using alvo where o.id = alvo.id returning 1)
    select count(*) into n from d;
    commit;
    p_max_ms := greatest(p_max_ms, extract(epoch from clock_timestamp() - t0) * 1000);
    p_total := p_total + n; p_lotes := p_lotes + 1;
    exit when n < p_lote;
  end loop;
end $$;

-- 1) ANTES: perfil de hoje, DELETE único
call fi_gerar_outbox(16400, 0.93);
select count(*) as linhas_antes, count(*) filter (where created_at < now() - interval '1 day') as a_apagar from outbox;
\timing on
delete from outbox where created_at < now() - interval '1 day';
\timing off

-- 2) DEPOIS (poda): mesmo volume, em lotes
call fi_gerar_outbox(16400, 0.93);
\timing on
call fi_podar_lotes(5000);
\timing off
do $$ begin
  assert (select count(*) from outbox where created_at < now() - interval '1 day') = 0, 'sobrou linha velha';
  assert (select count(*) from outbox where created_at >= now() - interval '1 day') >= 24 * 16400 - 500, 'apagou linha nova';
end $$;

-- 3) a folga do offline_compactar é respeitada: se ele parou (ultimo_outbox antigo), nada acima dele - 5000 sai
call fi_gerar_outbox(16400, 0.93);
create temp table fi_min as select min(id) as v from outbox;
update offline_meta set valor = to_jsonb((select v from fi_min) + 10000) where chave = 'ultimo_outbox';
call fi_podar_lotes(5000);
do $$ begin
  assert (select min(id) from outbox) = (select v from fi_min) + 5000,
    'apagou o que o offline_compactar ainda nao leu: min id ' || (select min(id) from outbox);
end $$;
drop table fi_min;

-- 4) DEPOIS do diff do faturamento (sem as ~15,2 mil linhas/h de faturamento_importado: ~1,2 mil/h)
call fi_gerar_outbox(1200, 0.0);
\timing on
delete from outbox where created_at < now() - interval '1 day';
\timing off
select count(*) as linhas_restantes, pg_size_pretty(pg_total_relation_size('outbox')) as tamanho from outbox;

\echo RESULTADO: PASSOU (asserts ok)
drop procedure fi_gerar_outbox(int, numeric);
drop procedure fi_podar_lotes(int, int, int, numeric);
truncate outbox restart identity;
