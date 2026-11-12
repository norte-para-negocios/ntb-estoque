-- Norte Cozinha (só dev), rodada 2 a partir da engenharia reversa do Kitchen Sense:
-- folga de produção e fechamento do evento, guia de preparo (modo de preparo, observações, foto) e configurações de compras.
-- Só colunas/tabelas novas; leitura por RLS (padrão initplan), gravação só pelas server actions.

-- Eventos: folga de produção, quando foi finalizado e o consumo real lançado (insumo -> quantidade na unidade do estoque).
alter table public.custo_eventos
  add column if not exists folga_pct      numeric(5,2) not null default 0 check (folga_pct >= 0 and folga_pct <= 200),
  add column if not exists finalizado_em  timestamptz,
  add column if not exists finalizado_por text,
  add column if not exists consumo_real   jsonb,
  add column if not exists baixa_ref      text;

-- Guia de preparo por prato/preparação (o que a ficha do Omie não guarda).
create table if not exists public.custo_receita_info (
  loja_id          bigint not null references public.lojas(id),
  codigo_produto   bigint not null,
  modo_preparo     text check (modo_preparo is null or length(modo_preparo) <= 20000),
  observacoes      text check (observacoes is null or length(observacoes) <= 5000),
  tempo_preparo_min integer check (tempo_preparo_min is null or (tempo_preparo_min >= 0 and tempo_preparo_min <= 10000)),
  rendimento_texto text check (rendimento_texto is null or length(rendimento_texto) <= 200),
  foto_path        text,
  atualizado_por   text,
  updated_at       timestamptz not null default now(),
  primary key (loja_id, codigo_produto)
);

-- Compras e contagem: cobertura em dias da sugestão, WhatsApp de quem recebe os pedidos, dia da contagem semanal (0 = domingo).
alter table public.custo_cardapio_config
  add column if not exists cobertura_dias   integer not null default 7 check (cobertura_dias between 1 and 90),
  add column if not exists whatsapp_compras text check (whatsapp_compras is null or whatsapp_compras ~ '^[0-9]{10,15}$'),
  add column if not exists dia_contagem     smallint check (dia_contagem is null or dia_contagem between 0 and 6);

-- Cardápio: porções de cada prato no conjunto (ex.: rodízio, combo).
alter table public.custo_cardapio_itens
  add column if not exists porcoes numeric(10,3) not null default 1 check (porcoes > 0 and porcoes <= 1000);

alter table public.custo_receita_info enable row level security;
drop policy if exists custo_receita_info_select_por_loja on public.custo_receita_info;
create policy custo_receita_info_select_por_loja on public.custo_receita_info
  for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.custo_receita_info from anon, authenticated;
grant select on public.custo_receita_info to authenticated;
grant all on public.custo_receita_info to service_role;

-- Fotos dos pratos: bucket privado; a tela lê por URL assinada gerada no servidor.
insert into storage.buckets (id, name, public) values ('cozinha-fotos', 'cozinha-fotos', false) on conflict (id) do nothing;

notify pgrst, 'reload schema';
