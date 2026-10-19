-- Teste da migration 193 (offline_compactar com folga por tempo). Só no banco local (fi).
-- Perfil de produção (19/10): outbox ~400 mil linhas/25 h, rajada de ~15 mil de faturamento_importado por hora,
-- fora dela ~350 linhas em 10 min. offline_tabelas: linhas reais de produção de produtos e faturamento_importado.
set client_min_messages = warning;
insert into offline_tabelas (tabela, pk_cols, pk_tipos, regra, loja_col, modo, ocultas)
values ('produtos', array['id'], array['bigint'], 'loja', 'loja_id', 'log', array[]::text[]),
       ('faturamento_importado', array['loja_id','dimensao','rotulo','mes'], array['bigint','text','text','text'], 'loja', 'loja_id', 'log', array[]::text[])
on conflict (tabela) do nothing;

create or replace procedure fi_preparar_outbox() language plpgsql as $$
begin
  truncate outbox restart identity;
  truncate offline_versoes;
  -- 25 h de histórico já processado + 350 linhas dos últimos 10 min
  insert into outbox (table_name, operation, row_data, created_at)
  select case when g % 14 = 0 then 'produtos' else 'faturamento_importado' end, 'INSERT',
         case when g % 14 = 0 then jsonb_build_object('id', g % 3000, 'loja_id', 5, 'descricao', repeat('x', 600))
              else jsonb_build_object('loja_id', 5, 'dimensao', 'produto', 'rotulo', 'P' || (g % 7000), 'mes', '2026-10', 'valor', g) end,
         now() - interval '25 hours' + g * interval '216 milliseconds'
  from generate_series(1, 400000) g
  where now() - interval '25 hours' + g * interval '216 milliseconds' < now() - interval '10 minutes';
  insert into outbox (table_name, operation, row_data, created_at)
  select 'produtos', 'UPDATE', jsonb_build_object('id', 5000 + g, 'loja_id', 5), now() - (g || ' seconds')::interval
  from generate_series(1, 350) g;
  delete from offline_meta where chave = 'ultimo_outbox';
  insert into offline_meta values ('ultimo_outbox', '0'::jsonb);
  analyze outbox;
end $$;

\echo == 158 (atual): 1a passada (tudo) e passada estável (nada novo)
\i supabase/migrations/158_offline_compactar_leve.sql
call fi_preparar_outbox();
select offline_compactar() as versoes_1a_passada;
\timing on
select offline_compactar() as estavel_158;
select offline_compactar() as estavel_158;
\timing off
-- outbox_id relativo ao 1o id (a sequência da outbox não reinicia entre as duas cargas)
create temp table fi_v158 as select tabela, pk, apagado, outbox_id - (select min(id) from outbox) as rel from offline_versoes;

\echo == 193: mesmos dados
\i supabase/migrations/193_offline_compactar_folga_por_tempo.sql
call fi_preparar_outbox();
select offline_compactar() as versoes_1a_passada;
\timing on
select offline_compactar() as estavel_193;
select offline_compactar() as estavel_193;
\timing off
do $$ begin
  assert (select count(*) from (select * from fi_v158 except select tabela, pk, apagado, outbox_id - (select min(id) from outbox) from offline_versoes) a) = 0, 'versões diferentes da 158';
  assert (select count(*) from (select tabela, pk, apagado, outbox_id - (select min(id) from outbox) from offline_versoes except select * from fi_v158) a) = 0, 'versões a mais que a 158';
end $$;

\echo == transação que confirmou atrasada (id abaixo do último processado, gravada há 3 min) entra na próxima passada
-- (o id 20 abaixo do último fica "vago": a linha que estava nele sai e entra a da transação atrasada)
delete from outbox where id = (select (valor #>> '{}')::bigint - 20 from offline_meta where chave = 'ultimo_outbox');
insert into outbox (id, table_name, operation, row_data, created_at)
values ((select (valor #>> '{}')::bigint - 20 from offline_meta where chave = 'ultimo_outbox'), 'produtos', 'DELETE', '{"id": 999999, "loja_id": 5}', now() - interval '3 minutes');
insert into outbox (table_name, operation, row_data) values ('produtos', 'UPDATE', '{"id": 888888, "loja_id": 5}');
select offline_compactar() as nova_passada;
do $$ begin
  assert exists (select 1 from offline_versoes where tabela = 'produtos' and pk = '{"id": 999999}' and apagado), 'perdeu a transação atrasada';
  assert exists (select 1 from offline_versoes where tabela = 'produtos' and pk = '{"id": 888888}'), 'perdeu a linha nova';
  -- toda chave da outbox tem versão com o último outbox_id dela
  assert (select count(*) from (
    select o.table_name, jsonb_build_object('id', o.row_data -> 'id') pk, max(o.id) mx from outbox o where o.table_name = 'produtos' group by 1, 2
  ) k left join offline_versoes v on v.tabela = k.table_name and v.pk = k.pk where v.outbox_id is distinct from k.mx) = 0, 'versão desatualizada';
end $$;
drop procedure fi_preparar_outbox();
truncate outbox restart identity;
truncate offline_versoes;
\echo RESULTADO: PASSOU (asserts ok)
