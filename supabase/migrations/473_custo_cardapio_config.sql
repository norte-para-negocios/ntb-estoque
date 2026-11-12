-- Custo e Cardápio (só dev): meta de CMV e taxas de venda por loja, usadas no preço sugerido de salão e delivery.
-- Leitura pelo usuário da loja (RLS); gravação só pela server action (service_role), que checa dev + gestor.
create table if not exists public.custo_cardapio_config (
  loja_id           bigint primary key references public.lojas(id),
  meta_cmv          numeric(6,4) not null default 0.30 check (meta_cmv > 0 and meta_cmv < 1),
  imposto_pct       numeric(6,4) not null default 0.06 check (imposto_pct >= 0 and imposto_pct < 1),
  taxa_cartao_pct   numeric(6,4) not null default 0.03 check (taxa_cartao_pct >= 0 and taxa_cartao_pct < 1),
  taxa_delivery_pct numeric(6,4) not null default 0.23 check (taxa_delivery_pct >= 0 and taxa_delivery_pct < 1),
  embalagem         numeric(12,2) not null default 2.00 check (embalagem >= 0),
  atualizado_por    text,
  updated_at        timestamptz not null default now()
);

alter table public.custo_cardapio_config enable row level security;
drop policy if exists custo_cardapio_config_select_por_loja on public.custo_cardapio_config;
create policy custo_cardapio_config_select_por_loja on public.custo_cardapio_config
  for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.custo_cardapio_config from anon, authenticated;
grant select on public.custo_cardapio_config to authenticated;
grant all on public.custo_cardapio_config to service_role;

notify pgrst, 'reload schema';
