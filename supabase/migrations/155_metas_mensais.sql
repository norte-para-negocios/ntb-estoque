-- 155 — Meta de faturamento por mês e loja (tela "Meta do mês").
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 155_metas_mensais.sql
create table if not exists public.metas_mensais (
  loja_id        bigint not null references public.lojas(id) on delete cascade,
  mes            char(7) not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  valor_mensal   numeric(14,2) not null check (valor_mensal > 0),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid,
  primary key (loja_id, mes)
);

alter table public.metas_mensais enable row level security;

drop policy if exists metas_mensais_select_por_loja on public.metas_mensais;
create policy metas_mensais_select_por_loja on public.metas_mensais for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);

revoke insert, update, delete, truncate on public.metas_mensais from anon, authenticated;
grant select on public.metas_mensais to authenticated;
