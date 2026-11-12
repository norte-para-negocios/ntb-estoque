-- Norte Cozinha (só dev): meta/taxas por loja, cardápios e eventos.
-- Leitura pelo usuário da loja (RLS no padrão initplan da 156); gravação só pelas server actions (service_role),
-- que checam desenvolvedor + gestor. Nada aqui escreve no Omie.

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

-- Cardápio = seleção de pratos para um canal (salão, delivery, evento), com preço próprio opcional por prato.
create table if not exists public.custo_cardapios (
  id          bigserial primary key,
  loja_id     bigint not null references public.lojas(id),
  nome        text not null check (length(trim(nome)) between 1 and 80),
  canal       text not null default 'salao' check (canal in ('salao', 'delivery', 'evento')),
  ativo       boolean not null default true,
  criado_por  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists custo_cardapios_loja on public.custo_cardapios (loja_id, ativo);

create table if not exists public.custo_cardapio_itens (
  id              bigserial primary key,
  cardapio_id     bigint not null references public.custo_cardapios(id) on delete cascade,
  loja_id         bigint not null references public.lojas(id),
  codigo_produto  bigint not null,
  -- null = usa o preço do cadastro (produtos.valor_unitario)
  preco           numeric(12,2) check (preco is null or preco >= 0),
  ordem           integer not null default 0,
  unique (cardapio_id, codigo_produto)
);
create index if not exists custo_cardapio_itens_cardapio on public.custo_cardapio_itens (cardapio_id, ordem);

-- Evento = orçamento por convidado + lista de produção e de compras (descontando o estoque).
create table if not exists public.custo_eventos (
  id                bigserial primary key,
  loja_id           bigint not null references public.lojas(id),
  nome              text not null check (length(trim(nome)) between 1 and 120),
  data_evento       date,
  convidados        integer not null default 1 check (convidados > 0 and convidados <= 100000),
  status            text not null default 'orcamento' check (status in ('orcamento', 'confirmado', 'realizado', 'cancelado')),
  -- preço cobrado por pessoa; null = ainda não definido (a tela sugere)
  preco_por_pessoa  numeric(12,2) check (preco_por_pessoa is null or preco_por_pessoa >= 0),
  obs               text,
  criado_por        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists custo_eventos_loja on public.custo_eventos (loja_id, data_evento desc);

create table if not exists public.custo_evento_itens (
  id                    bigserial primary key,
  evento_id             bigint not null references public.custo_eventos(id) on delete cascade,
  loja_id               bigint not null references public.lojas(id),
  codigo_produto        bigint not null,
  -- porções (unidades do prato) por convidado: 0,5 = meio prato por pessoa
  porcoes_por_convidado numeric(10,3) not null default 1 check (porcoes_por_convidado > 0),
  ordem                 integer not null default 0,
  unique (evento_id, codigo_produto)
);
create index if not exists custo_evento_itens_evento on public.custo_evento_itens (evento_id, ordem);

do $$
declare t text;
begin
  foreach t in array array['custo_cardapio_config', 'custo_cardapios', 'custo_cardapio_itens', 'custo_eventos', 'custo_evento_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.custo_cardapios_id_seq, public.custo_cardapio_itens_id_seq, public.custo_eventos_id_seq, public.custo_evento_itens_id_seq to service_role;

notify pgrst, 'reload schema';
