-- Teste da migration 194. Só no banco local (fi). Volume de produção: 414 mil movimentos (loja 5: 88 mil),
-- pendentes ~700 (Sem CMC 535, Iniciado 116, Erro 31, Processando 15). Consulta = a que o PostgREST gera para
-- retryMovimentosManuaisPendentes (service_role, sem RLS), com os parâmetros como no código.
set client_min_messages = warning;
drop index if exists movimentos_loja_status_tentativa_idx;
alter table movimentos disable trigger user;
delete from movimentos;
insert into movimentos (loja_id, codigo_local_estoque, id_prod, tipo, quan, data, status, tentativas, ultima_tentativa_em, motivo)
select (array[5,5,7,8,9,4])[1 + g % 6], 1, g % 3000, (array['ENT','SAI','SAI','SLD'])[1 + g % 4], 1, now() - (g || ' minutes')::interval,
       case when g % 600 = 0 then (array['Sem CMC','Sem CMC','Sem CMC','Iniciado','Erro','Processando'])[1 + (g / 600) % 6] else 'Concluido' end,
       case when g % 600 = 0 then (g / 600) % 5 else 0 end,
       case when g % 600 = 0 and g % 1200 = 0 then now() - interval '2 hours' end, 'INV'
from generate_series(1, 414000) g;
alter table movimentos enable trigger user;
analyze movimentos;
select status, count(*) from movimentos group by 1 order by 2 desc;

prepare elegiveis(bigint, text, timestamptz) as
  select id, loja_id, status, tentativas, id_ajuste, quan from movimentos
  where (ultima_tentativa_em is null or ultima_tentativa_em < $3) and loja_id = $1 and transferencia_id is null
    and tipo = any (array['ENT','SAI']) and status = $2 and tentativas < 30
  order by ultima_tentativa_em asc nulls first limit 10 offset 0;
create temp table fi_antes as
  select s.status, e.* from unnest(array['Erro','Sem CMC','Processando','Iniciado']) s(status),
    lateral (select id from movimentos where (ultima_tentativa_em is null or ultima_tentativa_em < now() - interval '1 hour') and loja_id = 5
      and transferencia_id is null and tipo = any (array['ENT','SAI']) and status = s.status and tentativas < 30
      order by ultima_tentativa_em asc nulls first, id limit 10) e;

\echo == ANTES
explain (analyze, buffers, costs off, timing off, summary on) execute elegiveis(5, 'Sem CMC', now() - interval '1 hour');

\i supabase/migrations/194_movimentos_indice_reenvio.sql
deallocate elegiveis;
prepare elegiveis(bigint, text, timestamptz) as
  select id, loja_id, status, tentativas, id_ajuste, quan from movimentos
  where (ultima_tentativa_em is null or ultima_tentativa_em < $3) and loja_id = $1 and transferencia_id is null
    and tipo = any (array['ENT','SAI']) and status = $2 and tentativas < 30
  order by ultima_tentativa_em asc nulls first limit 10 offset 0;

\echo == DEPOIS (7 execuções: passa do ponto em que o Postgres pode trocar para plano genérico)
execute elegiveis(5, 'Sem CMC', now() - interval '1 hour');
execute elegiveis(5, 'Erro', now() - interval '1 hour');
execute elegiveis(5, 'Processando', now() - interval '1 hour');
execute elegiveis(5, 'Sem CMC', now() - interval '1 hour');
execute elegiveis(5, 'Iniciado', now() - interval '1 hour');
execute elegiveis(5, 'Sem CMC', now() - interval '1 hour');
explain (analyze, buffers, costs off, timing off, summary on) execute elegiveis(5, 'Sem CMC', now() - interval '1 hour');
do $$ begin
  assert (select count(*) from (
    select * from fi_antes except
    select s.status, e.* from unnest(array['Erro','Sem CMC','Processando','Iniciado']) s(status),
      lateral (select id from movimentos where (ultima_tentativa_em is null or ultima_tentativa_em < now() - interval '1 hour') and loja_id = 5
        and transferencia_id is null and tipo = any (array['ENT','SAI']) and status = s.status and tentativas < 30
        order by ultima_tentativa_em asc nulls first, id limit 10) e) x) = 0, 'mudou o resultado';
end $$;
alter table movimentos disable trigger user;
delete from movimentos;
alter table movimentos enable trigger user;
\echo RESULTADO: PASSOU (asserts ok)
