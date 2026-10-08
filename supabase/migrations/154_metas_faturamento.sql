-- 154 — Meta diária de faturamento por loja (relatório Meta × Realizado).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 154_metas_faturamento.sql
create table if not exists public.metas_faturamento (
  loja_id        bigint primary key references public.lojas(id) on delete cascade,
  valor_diario   numeric(14,2) not null check (valor_diario >= 0),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.metas_faturamento enable row level security;

drop policy if exists metas_faturamento_select_por_loja on public.metas_faturamento;
create policy metas_faturamento_select_por_loja on public.metas_faturamento for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);

revoke insert, update, delete, truncate on public.metas_faturamento from anon, authenticated;
grant select on public.metas_faturamento to authenticated;
