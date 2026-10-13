-- 162 — "Nosso Omie" Fase 4 (escrever no Omie pela tela): permissões novas e registro das correções de custo.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Independe da 160/161.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 162_escrita_omie_tela.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
--  1. Permissões (catálogo lib/permissoes-catalogo.ts). Admin e AdminLoja já passam em tudo; os demais precisam
--     receber pelo cargo/usuário.
--  2. estoque_correcao_custo: cada "corrigir custo de um ajuste" (excluir o ajuste no Omie e relançar com o custo novo).
--     Serve de trava (índice único parcial: uma correção em andamento por ajuste) e de registro para refazer quando o
--     relançamento falha depois da exclusão. Escrita só pelo servidor (service role).

-- 1. Permissões -------------------------------------------------------------------------------------------
insert into permissoes (nome) values
  ('Estoque - Lancar no Omie'),
  ('Estoque - Corrigir custo'),
  ('Fichas - Trocar insumo'),
  ('OP - Acoes em lote')
on conflict (nome) do nothing;

-- 2. Correções de custo -----------------------------------------------------------------------------------
create table if not exists public.estoque_correcao_custo (
  id                   bigserial primary key,
  loja_id              bigint not null references public.lojas(id) on delete cascade,
  movimento_id         bigint not null,              -- linha de movimentos corrigida
  id_ajuste_antigo     bigint not null,              -- ajuste excluído no Omie
  id_ajuste_novo       bigint,                       -- ajuste relançado (null até dar certo)
  id_prod              bigint not null,
  codigo_local_estoque bigint not null,
  tipo                 text not null check (tipo in ('ENT', 'SAI')),
  quantidade           numeric not null,             -- sempre positiva (a direção é o tipo)
  data_ajuste          date not null,
  motivo               text,
  obs_original         text,
  custo_antigo         numeric,
  custo_novo           numeric not null,
  mes_fechado          boolean not null default false,
  status               text not null check (status in ('excluindo', 'relancando', 'concluido', 'pendente_relancar', 'falha_exclusao', 'cancelada')),
  erro                 text,
  user_id              uuid,
  user_nome            text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Uma correção em andamento por ajuste (duplo clique / duas abas): o 2º insert falha com 23505.
create unique index if not exists estoque_correcao_custo_em_andamento
  on public.estoque_correcao_custo (loja_id, id_ajuste_antigo)
  where status in ('excluindo', 'relancando', 'pendente_relancar');
create index if not exists estoque_correcao_custo_loja_status on public.estoque_correcao_custo (loja_id, status, id desc);

alter table public.estoque_correcao_custo enable row level security;
drop policy if exists estoque_correcao_custo_select_por_loja on public.estoque_correcao_custo;
create policy estoque_correcao_custo_select_por_loja on public.estoque_correcao_custo for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);
revoke all on public.estoque_correcao_custo from anon;
revoke insert, update, delete, truncate on public.estoque_correcao_custo from authenticated;
grant select on public.estoque_correcao_custo to authenticated;
