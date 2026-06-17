-- Arquivo morto: offload do histórico que sai da janela quente (12 meses) para o
-- Supabase Storage (bucket separado, 1 GB, não conta nos 500 MB do Postgres).
-- O cron /api/cron/arquivar exporta cada mês > janela em .json.gz, faz upload e
-- apaga do Postgres. /api/cron/restaurar traz de volta sob demanda.
-- Ver docs/superpowers/plans/2026-06-17-estrategia-espaco.md.

-- Marca d'água: registra o que está arquivado para a UI saber oferecer "carregar do arquivo".
create table if not exists arquivos_mortos (
  id            bigserial primary key,
  tabela        text        not null,   -- 'movimentos_historico' | 'ordens_producao' | 'notas_fiscais'
  periodo       text        not null,   -- 'AAAA-MM'
  path          text        not null,   -- 'ordens_producao/2025-01.json.gz'
  linhas        int         not null,
  bytes         bigint,
  criado_em     timestamptz default now(),
  restaurado_em timestamptz,            -- preenchido quando re-inserido no Postgres sob demanda
  unique (tabela, periodo)
);

create index if not exists idx_arquivos_mortos_tabela on arquivos_mortos (tabela, periodo);

-- Meses com dados anteriores ao corte, agrupados (periodo AAAA-MM + contagem).
-- SQL dinâmico para servir as 3 tabelas; %I protege os identificadores. Só o cron
-- (autenticado) chama, sempre com valores de uma allowlist no código.
create or replace function meses_arquivaveis(p_tabela text, p_col text, p_corte date)
returns table (periodo text, linhas bigint)
language plpgsql
as $$
begin
  return query execute format(
    'select to_char(%1$I, ''YYYY-MM'') as periodo, count(*)::bigint as linhas
       from %2$I
      where %1$I is not null and %1$I < $1
      group by 1 order by 1',
    p_col, p_tabela
  ) using p_corte;
end;
$$;

-- Bucket privado para os .json.gz. Idempotente.
insert into storage.buckets (id, name, public)
values ('arquivo-morto', 'arquivo-morto', false)
on conflict (id) do nothing;
