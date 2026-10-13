-- 157 — Kardex do Omie (ListarMovimentoEstoque) espelhado por produto, sob demanda pela tela de Estoque.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 157_kardex_omie.sql
create table if not exists public.kardex_omie (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id) on delete cascade,
  id_mov              bigint not null,
  n_cod_prod          bigint not null,
  codigo_local_estoque bigint not null,
  data_mov            date not null,
  cod_origem          text not null default '',
  des_origem          text,
  tipo                text,            -- 'entrada' | 'saida' (como vem do Omie)
  quantidade          numeric not null, -- assinada (saída negativa), como o Omie devolve
  valor_unit          numeric,
  cmc_apos            numeric,
  saldo_apos          numeric,
  num_doc             text,
  num_pedido          text,
  id_ajuste           bigint,
  id_cupom            bigint,
  cancelado           boolean not null default false,
  carregado_em        timestamptz not null default now(),
  constraint kardex_omie_mov unique (loja_id, id_mov)
);
create index if not exists kardex_omie_prod_idx on public.kardex_omie (loja_id, n_cod_prod, data_mov desc, id_mov desc);

alter table public.kardex_omie enable row level security;
drop policy if exists kardex_omie_select_por_loja on public.kardex_omie;
create policy kardex_omie_select_por_loja on public.kardex_omie for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on public.kardex_omie from anon, authenticated;
revoke all on public.kardex_omie from anon;
grant select on public.kardex_omie to authenticated;
