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

-- 1) coluna + gatilho (add column sem default = instantâneo, sem reescrever a tabela)
alter table public.webhooks add column if not exists n_id_receb text;

create or replace function public.webhooks_preencher_n_id_receb() returns trigger
language plpgsql as $$
begin
  new.n_id_receb := new.message -> 'event' -> 'cabecalho' ->> 'nIdReceb';
  return new;
end $$;

drop trigger if exists webhooks_n_id_receb on public.webhooks;
create trigger webhooks_n_id_receb before insert or update of message on public.webhooks
  for each row execute function public.webhooks_preencher_n_id_receb();

-- carga das linhas que já existem (só as que têm nIdReceb: ~1,5 mil por loja grande), em lotes curtos
do $$
declare n int;
begin
  loop
    update public.webhooks w set n_id_receb = w.message -> 'event' -> 'cabecalho' ->> 'nIdReceb'
    where w.id in (
      select id from public.webhooks
      where n_id_receb is null and message -> 'event' -> 'cabecalho' ? 'nIdReceb'
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
notify pgrst, 'reload schema';
