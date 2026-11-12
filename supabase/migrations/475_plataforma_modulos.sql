-- Plataforma Norte, Fase 1: módulos, planos e assinaturas por loja.
-- Regra de ouro: loja sem linha em plataforma_assinaturas = tudo como hoje (padrões no código).
-- Leitura pelo usuário da loja (RLS initplan, padrão da 473); gravação só por service_role.

create table if not exists public.plataforma_modulos (
  id    text primary key,
  nome  text not null,
  ordem integer not null default 0
);

create table if not exists public.plataforma_planos (
  id            text primary key,
  modulo_id     text not null references public.plataforma_modulos(id),
  nome          text not null,
  preco_mensal  numeric(12,2) check (preco_mensal is null or preco_mensal >= 0),
  ativo         boolean not null default true
);

create table if not exists public.plataforma_clientes (
  id   bigserial primary key,
  nome text not null
);

create table if not exists public.plataforma_lojas (
  erp_loja_id     bigint primary key references public.lojas(id),
  vendas_store_id uuid,
  cliente_id      bigint references public.plataforma_clientes(id)
);

create table if not exists public.plataforma_assinaturas (
  id              bigserial primary key,
  erp_loja_id     bigint not null references public.lojas(id),
  modulo_id       text not null references public.plataforma_modulos(id),
  estado          text not null check (estado in ('ativo', 'teste', 'bloqueado', 'suspenso')),
  plano_id        text references public.plataforma_planos(id),
  preco_combinado numeric(12,2) check (preco_combinado is null or preco_combinado >= 0),
  obs             text,
  atualizado_por  text,
  updated_at      timestamptz not null default now(),
  unique (erp_loja_id, modulo_id)
);
create index if not exists plataforma_assinaturas_loja on public.plataforma_assinaturas (erp_loja_id);

insert into public.plataforma_modulos (id, nome, ordem) values
  ('dashboard', 'Início', 0),
  ('vendas', 'Norte Vendas', 1),
  ('erp', 'Norte ERP', 2),
  ('cozinha', 'Norte Cozinha', 3),
  ('pacioli', 'Pacioli', 4)
on conflict (id) do nothing;

insert into public.plataforma_planos (id, modulo_id, nome, preco_mensal) values
  ('vendas-balcao', 'vendas', 'Vendas balcão', null),
  ('vendas-mesas', 'vendas', 'Vendas mesas', null),
  ('vendas-mais-10-mesas', 'vendas', 'Vendas mais de 10 mesas', null),
  ('erp', 'erp', 'Norte ERP', null),
  ('cozinha', 'cozinha', 'Norte Cozinha', null),
  ('pacioli', 'pacioli', 'Pacioli', null)
on conflict (id) do nothing;

do $$
declare t text;
begin
  foreach t in array array['plataforma_modulos', 'plataforma_planos', 'plataforma_clientes', 'plataforma_lojas', 'plataforma_assinaturas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    if t in ('plataforma_lojas', 'plataforma_assinaturas') then
      execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or erp_loja_id in (select usuario_lojas()))', t || '_select', t);
    elsif t = 'plataforma_clientes' then
      execute format('create policy %I on public.%I for select using ((select usuario_e_admin()))', t || '_select', t);
    else
      execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.plataforma_clientes_id_seq, public.plataforma_assinaturas_id_seq to service_role;

notify pgrst, 'reload schema';
