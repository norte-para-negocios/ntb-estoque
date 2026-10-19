-- Teste/medida da migration 191 (item 1: webhooks da nota no HistoricoStatusNF). Só no banco local (fi).
-- Rodar depois de scripts/testes-sql/fi_setup_usuario_loja5.sql (usuário comum da loja 5).
-- Volume de produção (19/10): webhooks 164.785 linhas (loja 5: 53.282; RecebimentoProduto% da loja 5: 1.524,
-- até 20 por nota), message ~856 B.
set client_min_messages = warning;
-- volta ao estado de antes da 191
drop trigger if exists webhooks_n_id_receb on public.webhooks;
drop function if exists public.webhooks_preencher_n_id_receb();
drop index if exists webhooks_loja_receb_idx;
drop index if exists webhooks_loja_n_id_receb_idx;
alter table public.webhooks drop column if exists n_id_receb;

alter table webhooks disable trigger outbox_trigger;
truncate webhooks;
-- lojas que já existem no fb_base: 5 (alvo) e 4/7/8/9 no papel das outras lojas reais
insert into webhooks (loja_id, message_id, message, created_at)
select case when g % 31 < 10 then 5 when g % 31 < 18 then 7 when g % 31 < 23 then 8 when g % 31 < 28 then 9 else 4 end,
       md5(g::text),
       case when g % 35 = 0
         then jsonb_build_object('topic', 'RecebimentoProduto.' || (array['Incluido','Alterado','Concluido'])[1 + g % 3],
                                 'event', jsonb_build_object('cabecalho', jsonb_build_object('nIdReceb', 3800000000 + (g / 35) % 400, 'cEtapa', '40')),
                                 'pad', repeat('r', 600))
         else jsonb_build_object('topic', (array['Produto.Alterado','OrdemProducao.Alterada','VendaProduto.Faturada'])[1 + g % 3],
                                 'event', jsonb_build_object('codigo', g), 'pad', repeat('x', 700)) end,
       now() - (g || ' seconds')::interval
from generate_series(1, 164785) g;
-- revisão M1: com `? 'nIdReceb'` esta linha fazia o laço de carga da 191 nunca terminar
insert into webhooks (loja_id, message_id, message) values (5, 'fi-receb-nulo', '{"topic":"RecebimentoProduto.Alterado","event":{"cabecalho":{"nIdReceb":null}}}');
analyze webhooks;
select count(*) total, count(*) filter (where loja_id = 5) loja5,
       count(*) filter (where loja_id = 5 and message->>'topic' like 'RecebimentoProduto%') receb_loja5 from webhooks;

drop table if exists fi_alvo;
create table fi_alvo as
select message->'event'->'cabecalho'->>'nIdReceb' as receb, count(*) n from webhooks
where loja_id = 5 and message->>'topic' like 'RecebimentoProduto%' group by 1 order by 2 desc, 1 limit 1;
grant select on fi_alvo to authenticated;

\echo == ANTES (o que a tela faz hoje: todas as páginas de 1000; o nIdReceb era filtrado em JS)
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
\timing on
select count(*) from (select id, message, created_at from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%' order by id asc limit 1000 offset 0) p1;
select count(*) from (select id, message, created_at from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%' order by id asc limit 1000 offset 1000) p2;
\timing off
commit;

\echo == aplica a 191 de verdade
alter table webhooks enable trigger outbox_trigger;
\i supabase/migrations/191_indices_telas_fase_i.sql

\echo == DEPOIS (código novo: .eq n_id_receb no banco)
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
\timing on
select count(*) from (select id, message, created_at from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%'
  and n_id_receb = (select receb from fi_alvo) order by id asc limit 1000 offset 0) p;
\timing off
explain (costs off) select id, message, created_at from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%'
  and n_id_receb = '3800000003' order by id asc limit 1000 offset 0;
do $$
declare a int; b int;
begin
  -- mesmas linhas que o filtro em JS de antes (String(nIdReceb) === nIdReceb)
  select count(*) into a from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%'
    and (message->'event'->'cabecalho'->'nIdReceb')::text = (select receb from fi_alvo);
  select count(*) into b from webhooks where loja_id = 5 and message->>'topic' ilike 'RecebimentoProduto%'
    and n_id_receb = (select receb from fi_alvo);
  assert a = b and a = (select n from fi_alvo), format('divergiu: %s x %s', a, b);
  assert (select count(*) from webhooks where loja_id = 7) = 0, 'RLS vazou loja 7';
end $$;
commit;

-- webhook novo preenche a coluna pelo gatilho
insert into webhooks (loja_id, message_id, message) values (5, 'fi-novo', '{"topic":"RecebimentoProduto.Alterado","event":{"cabecalho":{"nIdReceb":42}}}');
insert into webhooks (loja_id, message_id, message) values (5, 'fi-novo2', '{"topic":"Produto.Alterado","event":{"codigo":1}}');
do $$ begin
  assert (select n_id_receb from webhooks where message_id = 'fi-novo') = '42', 'gatilho não preencheu';
  assert (select n_id_receb from webhooks where message_id = 'fi-novo2') is null, 'gatilho preencheu sem nIdReceb';
  assert (select count(*) from webhooks where n_id_receb is null and (message->'event'->'cabecalho'->>'nIdReceb') is not null) = 0, 'carga incompleta';
  -- a linha com "nIdReceb": null (revisão M1) continua sem valor, e a carga terminou
  assert (select n_id_receb from webhooks where message_id = 'fi-receb-nulo') is null, 'nIdReceb null ganhou valor';
  assert (select bool_and(i.indisvalid) from pg_index i join pg_class c on c.oid = i.indexrelid
          where c.relname in ('webhooks_loja_n_id_receb_idx', 'idx_webhooks_loja_message')), 'índice inválido';
end $$;
drop table fi_alvo;
\echo RESULTADO: PASSOU (asserts ok)
