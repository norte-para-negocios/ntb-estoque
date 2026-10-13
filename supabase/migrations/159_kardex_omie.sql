-- 159 — Kardex do Omie (ListarMovimentoEstoque) espelhado por produto, sob demanda pela tela de Estoque.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 159_kardex_omie.sql
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
  -- id_mov + local: na transferência o Omie pode repetir o idMov nos dois locais; sem o local um lado sobrescreveria o outro.
  constraint kardex_omie_mov unique (loja_id, id_mov, codigo_local_estoque)
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

-- Última carga do kardex por produto (inclusive as que não trouxeram movimento): a tela diz
-- "sem movimentos nos últimos 55 dias" e o limite de 1 carga a cada 10 min vale mesmo sem linhas.
create table if not exists public.kardex_omie_carga (
  loja_id       bigint not null references public.lojas(id) on delete cascade,
  n_cod_prod    bigint not null,
  carregado_em  timestamptz not null default now(),
  movimentos    integer not null default 0,
  primary key (loja_id, n_cod_prod)
);
alter table public.kardex_omie_carga enable row level security;
drop policy if exists kardex_omie_carga_select_por_loja on public.kardex_omie_carga;
create policy kardex_omie_carga_select_por_loja on public.kardex_omie_carga for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on public.kardex_omie_carga from anon, authenticated;
revoke all on public.kardex_omie_carga from anon;
grant select on public.kardex_omie_carga to authenticated;

-- Trava por loja + recurso (ex.: 'posicao', 'kardex:<produto>') para não rodar duas leituras iguais
-- do Omie ao mesmo tempo (botão da tela x cron). Atômica: só pega se não existe ou já venceu.
create table if not exists public.sync_trava (
  loja_id  bigint not null references public.lojas(id) on delete cascade,
  recurso  text not null,
  ate      timestamptz not null,
  primary key (loja_id, recurso)
);
alter table public.sync_trava enable row level security; -- sem policy: só service role
revoke all on public.sync_trava from anon, authenticated;

create or replace function public.pegar_trava_sync(p_loja_id bigint, p_recurso text, p_segundos integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into sync_trava (loja_id, recurso, ate) values (p_loja_id, p_recurso, now() + make_interval(secs => p_segundos))
  on conflict (loja_id, recurso) do update set ate = excluded.ate where sync_trava.ate < now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.soltar_trava_sync(p_loja_id bigint, p_recurso text)
returns void language sql security definer set search_path = public as $$
  delete from sync_trava where loja_id = p_loja_id and recurso = p_recurso;
$$;

revoke all on function public.pegar_trava_sync(bigint, text, integer) from public, anon, authenticated;
revoke all on function public.soltar_trava_sync(bigint, text) from public, anon, authenticated;
