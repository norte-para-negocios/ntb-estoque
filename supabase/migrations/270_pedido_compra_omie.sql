-- 270 — C1 (paridade com o Omie): pedido de compra do NTB gravado no Omie (IncluirPedCompra) nas lojas de estoque Omie.
-- Plano: docs/superpowers/plans/2026-10-20-c1-pedido-compra-omie.md. Depende da 200 (pedidos_compra).
-- SÓ ADITIVA E DESLIGADA: colunas novas em lojas com padrão false/null, uma tabela nova, um gatilho que só age quando
-- existe linha na tabela nova, e _pc_loja_propria passa a aceitar TAMBÉM a loja Omie com
-- lojas.omie_gravar_pedidos_compra = true (nenhuma loja tem isso ligado depois desta migration: comportamento igual).
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 270_pedido_compra_omie.sql
-- Depois: NOTIFY pgrst (no fim deste arquivo); desktop/scripts/gerar-schema.sh + versão do desktop (colunas novas em lojas).
-- Reverter: ver "Rollback" no plano (drop do gatilho/tabela/colunas + _pc_loja_propria da 200).

begin;
-- ALTER TABLE lojas pega lock exclusivo por instantes: se um sync estiver segurando a tabela, desiste (é só rodar de novo).
set local lock_timeout = '5s';

alter table public.lojas add column if not exists omie_gravar_pedidos_compra boolean not null default false;
alter table public.lojas add column if not exists omie_pedido_categoria text;
alter table public.lojas add column if not exists omie_pedido_email_aprovador text;
alter table public.lojas drop constraint if exists lojas_omie_pedido_categoria_formato;
alter table public.lojas add constraint lojas_omie_pedido_categoria_formato
  check (omie_pedido_categoria is null or omie_pedido_categoria ~ '^[0-9.]{1,20}$');
comment on column public.lojas.omie_gravar_pedidos_compra is
  'C1: loja Omie liberada para criar pedido de compra no NTB e gravá-lo no Omie. Só vale com OMIE_GRAVAR_PEDIDOS_COMPRA=1 no servidor. Loja 4 nunca (código).';
comment on column public.lojas.omie_pedido_categoria is 'C1: cCodCateg do pedido no Omie (ex. 2.01.01); vazio = padrão do Omie.';
comment on column public.lojas.omie_pedido_email_aprovador is 'C1: cEmailAprovador; com ele o Omie cria o pedido já aprovado.';
-- Lidas só pelo servidor (service role): sem GRANT de coluna para authenticated (padrão da 109).

-- Estado da gravação no Omie: uma linha por pedido de loja Omie aprovado no NTB. Loja de estoque próprio nunca tem linha.
create table if not exists public.pedidos_compra_omie (
  pedido_id             bigint primary key references public.pedidos_compra(id) on delete cascade,
  loja_id               bigint not null references public.lojas(id),
  cod_int               text not null check (cod_int ~ '^NTB-PC-[0-9]{1,13}$'),        -- cCodIntPed (idempotência)
  status                text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviado', 'precisa_corrigir')),
  n_cod_ped             bigint,                                                          -- nCodPed do Omie
  numero_omie           text,                                                            -- cNumero (o fornecedor põe no xPed da NF-e)
  tentativas            int not null default 0 check (tentativas >= 0),
  proxima_tentativa_em  timestamptz,
  ultima_tentativa_em   timestamptz,
  ultimo_erro           text,
  enviado_em            timestamptz,
  payload               jsonb,                                                           -- último IncluirPedCompra montado
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (loja_id, cod_int)
);
create unique index if not exists pedidos_compra_omie_ncodped on public.pedidos_compra_omie (loja_id, n_cod_ped) where n_cod_ped is not null;
create index if not exists pedidos_compra_omie_fila on public.pedidos_compra_omie (status, proxima_tentativa_em) where status in ('pendente', 'enviando');

alter table public.pedidos_compra_omie enable row level security;
drop policy if exists pedidos_compra_omie_select_por_loja on public.pedidos_compra_omie;
create policy pedidos_compra_omie_select_por_loja on public.pedidos_compra_omie for select
  using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()));
revoke all on public.pedidos_compra_omie from anon, authenticated;
grant select on public.pedidos_compra_omie to authenticated;
grant all on public.pedidos_compra_omie to service_role;

-- Pedido já gravado (ou sendo gravado) no Omie não sai de "aprovado" pelo NTB: reabrir/cancelar só no Omie.
-- (o NTB ainda não altera nem exclui pedido no Omie; a regra também está em bloqueioEtapaPorOmie, no TS)
create or replace function public.trg_pedidos_compra_omie_etapa() returns trigger
language plpgsql set search_path = public as $$
declare v pedidos_compra_omie%rowtype;
begin
  if old.etapa = 'aprovado' and new.etapa is distinct from old.etapa then
    select * into v from pedidos_compra_omie where pedido_id = old.id;
    if found and v.status in ('enviando', 'enviado') then
      raise exception 'Este pedido já está no Omie%: altere ou cancele lá', coalesce(' (nº ' || v.numero_omie || ')', '') using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists pedidos_compra_omie_etapa on public.pedidos_compra;
create trigger pedidos_compra_omie_etapa before update of etapa on public.pedidos_compra
  for each row execute function public.trg_pedidos_compra_omie_etapa();

-- Loja do pedido de compra: estoque próprio (como na 200) OU loja Omie liberada (C1). Mesma mensagem da 200.
-- Efeito colateral conhecido: rc_*/comp_salvar/fornecedor_lead_time_salvar/pc_importar (240–242) também usam esta
-- função e passam a aceitar a loja Omie liberada no BANCO; as telas/ações dessas continuam só no estoque próprio (TS).
create or replace function public._pc_loja_propria(p_loja bigint) returns void
language plpgsql stable set search_path = public as $$
begin
  if not exists (select 1 from lojas where id = p_loja
                   and (modo_estoque = 'proprio' or (modo_estoque = 'omie' and omie_gravar_pedidos_compra and id <> 4))) then
    raise exception 'A loja % não usa estoque próprio: pedido de compra local só existe no estoque próprio', p_loja using errcode = '22023';
  end if;
end $$;

-- Põe (ou devolve) o pedido aprovado na fila de gravação no Omie. Idempotente: pendente/enviando/enviado ficam como
-- estão; 'precisa_corrigir' volta para 'pendente' com as tentativas zeradas (o pedido foi corrigido e aprovado de novo).
create or replace function public.pc_omie_enfileirar(p_loja bigint, p_pedido bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v pedidos_compra_omie%rowtype;
begin
  if not exists (select 1 from lojas where id = p_loja and modo_estoque = 'omie' and omie_gravar_pedidos_compra and id <> 4) then
    raise exception 'A loja % não grava pedido de compra no Omie', p_loja using errcode = '22023';
  end if;
  select * into v_ped from pedidos_compra where id = p_pedido and loja_id = p_loja for update;
  if not found then raise exception 'Pedido inexistente' using errcode = '22023'; end if;
  if v_ped.etapa <> 'aprovado' then raise exception 'Só pedido aprovado vai ao Omie (etapa atual: %)', v_ped.etapa using errcode = '22023'; end if;
  insert into pedidos_compra_omie (pedido_id, loja_id, cod_int) values (p_pedido, p_loja, 'NTB-PC-' || p_pedido)
  on conflict (pedido_id) do update set status = 'pendente', tentativas = 0, proxima_tentativa_em = null, ultimo_erro = null, updated_at = now()
    where pedidos_compra_omie.status = 'precisa_corrigir'
  returning * into v;
  if not found then select * into v from pedidos_compra_omie where pedido_id = p_pedido; end if;
  return jsonb_build_object('ok', true, 'status', v.status, 'cod_int', v.cod_int);
end $$;

revoke all on function public.pc_omie_enfileirar(bigint, bigint) from public, anon, authenticated;
grant execute on function public.pc_omie_enfileirar(bigint, bigint) to service_role;
revoke all on function public._pc_loja_propria(bigint) from public, anon, authenticated;
grant execute on function public._pc_loja_propria(bigint) to service_role;

commit;

notify pgrst, 'reload schema';
