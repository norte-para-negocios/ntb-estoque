-- 191: Fase I (velocidade) — webhooks da nota, índice de duplicado versionado e autovacuum. Medido em
-- produção em 19/10/2026 como usuário comum da loja 5.
-- SEM transação (create index concurrently):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 191_indices_telas_fase_i.sql
-- Pode ir antes ou depois do código: sem a coluna nova o HistoricoStatusNF cai no caminho antigo.
--
-- 1) Histórico de status da nota (components/nota-fiscal/HistoricoStatusNF.tsx) lia TODOS os webhooks
--    RecebimentoProduto% da loja (seq scan em webhooks inteira: 22 mil blocos, 0,6 s + 0,2 s por página,
--    1.524 mensagens para o servidor filtrar o nIdReceb em JS) para achar os até ~20 da nota.
--    Um índice de EXPRESSÃO em message->...->>'nIdReceb' NÃO resolve para o usuário logado: com RLS, o
--    operador ->> (não leakproof) não pode virar condição de índice antes da política (testado:
--    scripts/testes-sql/191_webhooks_recebimento.sql). Por isso a coluna n_id_receb (texto, preenchida por
--    gatilho na entrada) + índice comum: a comparação vira texteq (leakproof) e usa o índice.
-- 2) idx_webhooks_loja_message já existe em produção (criado à mão, fora das migrations; é o que deixa a
--    checagem de duplicado do webhook, 1,1 mi chamadas, em 0,08 ms). Versionado aqui com IF NOT EXISTS.
-- 3) autovacuum: ordens_producao (442 mil linhas, 14,9 mi updates desde 26/09), movimentos e notas_fiscais
--    nunca passaram pelo autovacuum desde 26/09 (limite padrão = 20 % de linhas mortas; ordens_producao tem
--    64 mil mortas e a lista de OPs do mês visitava 7.711 entradas de índice para 4.900 linhas vivas).
--    2 % dispara o vacuum ~10× mais cedo.
--
-- Reverter:
--   drop trigger if exists webhooks_n_id_receb on public.webhooks;
--   drop function if exists public.webhooks_preencher_n_id_receb();
--   drop index concurrently if exists webhooks_loja_n_id_receb_idx;
--   alter table public.webhooks drop column if exists n_id_receb;
--   alter table public.ordens_producao reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
--   alter table public.movimentos reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
--   alter table public.notas_fiscais reset (autovacuum_vacuum_scale_factor, autovacuum_analyze_scale_factor);
--   (idx_webhooks_loja_message já existia antes: não apagar.)

-- 1) coluna + gatilho (add column sem default = instantâneo, sem reescrever a tabela).
-- O ALTER/CREATE TRIGGER pedem bloqueio exclusivo em webhooks: com lock_timeout de 3 s, se a tabela estiver
-- ocupada desiste logo e tenta de novo (até 20 vezes, 1 s entre elas), em vez de enfileirar os inserts dos
-- webhooks atrás do pedido de bloqueio (revisão I2, 19/10).
create or replace function public.webhooks_preencher_n_id_receb() returns trigger
language plpgsql as $$
begin
  new.n_id_receb := new.message -> 'event' -> 'cabecalho' ->> 'nIdReceb';
  return new;
end $$;

set lock_timeout = '3s';
do $$
declare i int;
begin
  for i in 1..20 loop
    begin
      alter table public.webhooks add column if not exists n_id_receb text;
      drop trigger if exists webhooks_n_id_receb on public.webhooks;
      create trigger webhooks_n_id_receb before insert or update of message on public.webhooks
        for each row execute function public.webhooks_preencher_n_id_receb();
      return;
    exception when lock_not_available then
      raise notice '191: webhooks ocupada, tentativa % de 20', i;
      perform pg_sleep(1);
    end;
  end loop;
  raise exception '191: não consegui o bloqueio de webhooks em 20 tentativas; rode de novo num momento mais calmo';
end $$;
reset lock_timeout;

-- carga das linhas que já existem (só as que têm nIdReceb: ~1,5 mil por loja grande), em lotes curtos.
-- `->> is not null` (e não `? 'nIdReceb'`): uma linha com "nIdReceb": null nunca ganha valor e o laço não pararia.
do $$
declare n int;
begin
  loop
    update public.webhooks w set n_id_receb = w.message -> 'event' -> 'cabecalho' ->> 'nIdReceb'
    where w.id in (
      select id from public.webhooks
      where n_id_receb is null and (message -> 'event' -> 'cabecalho' ->> 'nIdReceb') is not null
      limit 2000
    );
    get diagnostics n = row_count;
    commit;
    exit when n = 0;
  end loop;
end $$;

create index concurrently if not exists webhooks_loja_n_id_receb_idx
  on public.webhooks (loja_id, n_id_receb) where n_id_receb is not null;

-- coluna nova em tabela com RLS: o select de authenticated é por tabela (sem grant por coluna), nada a fazer.

-- 2) índice da checagem de duplicado (já existe em produção)
create index concurrently if not exists idx_webhooks_loja_message
  on public.webhooks (loja_id, message_id);

-- 3) autovacuum mais cedo nas tabelas grandes muito atualizadas
alter table public.ordens_producao set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.movimentos set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);
alter table public.notas_fiscais set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02);

analyze public.webhooks;

-- índice concurrently que falha no meio fica INVÁLIDO (e o IF NOT EXISTS de uma 2ª rodada não o refaz)
do $$
declare r record;
begin
  for r in select c.relname, i.indisvalid from pg_index i join pg_class c on c.oid = i.indexrelid
           where c.relname in ('webhooks_loja_n_id_receb_idx', 'idx_webhooks_loja_message') loop
    if not r.indisvalid then
      raise exception '191: índice % ficou inválido; rode "drop index concurrently %" e aplique a 191 de novo', r.relname, r.relname;
    end if;
  end loop;
  if (select count(*) from pg_class where relname in ('webhooks_loja_n_id_receb_idx', 'idx_webhooks_loja_message')) <> 2 then
    raise exception '191: índice não criado';
  end if;
  raise notice '191: índices válidos';
end $$;
notify pgrst, 'reload schema';
