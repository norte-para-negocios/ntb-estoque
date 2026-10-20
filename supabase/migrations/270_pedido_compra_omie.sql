-- 270 — C1 (paridade com o Omie): pedido de compra do NTB gravado no Omie (IncluirPedCompra) nas lojas de estoque Omie.
-- Plano: docs/superpowers/plans/2026-10-20-c1-pedido-compra-omie.md. Depende da 200 (pedidos_compra).
-- SÓ ADITIVA E DESLIGADA: colunas novas em lojas com padrão false/null, uma tabela nova, um gatilho que só age quando
-- existe linha na tabela nova, e _pc_loja_propria passa a aceitar TAMBÉM a loja Omie com
-- lojas.omie_gravar_pedidos_compra = true (nenhuma loja tem isso ligado depois desta migration: comportamento igual).
-- Aplicar (manual, com backup e OK do dono): docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 270_pedido_compra_omie.sql
-- Depois: NOTIFY pgrst (no fim deste arquivo); desktop/scripts/gerar-schema.sh + versão do desktop (colunas novas em lojas).
-- Reverter: ver "Rollback" no plano (drop do gatilho/funções/tabela/colunas + _pc_loja_propria da 200).
-- Revisão 20/10 (I1–I3): reivindicação com a linha do pedido travada (pc_omie_reivindicar), estado 'incerto' que trava
-- reabrir/cancelar, teto que só zera com nova aprovação, payload fora da leitura da sessão, loja 4 proibida por CHECK.

begin;
-- ALTER TABLE lojas pega lock exclusivo por instantes: se um sync estiver segurando a tabela, desiste (é só rodar de novo).
set local lock_timeout = '5s';

alter table public.lojas add column if not exists omie_gravar_pedidos_compra boolean not null default false;
alter table public.lojas add column if not exists omie_pedido_categoria text;
alter table public.lojas add column if not exists omie_pedido_email_aprovador text;
alter table public.lojas drop constraint if exists lojas_omie_pedido_categoria_formato;
alter table public.lojas add constraint lojas_omie_pedido_categoria_formato
  check (omie_pedido_categoria is null or omie_pedido_categoria ~ '^[0-9.]{1,20}$');
-- Loja 4 (Sertão, produção protegida) nunca liga a gravação (também no código e nas funções abaixo).
alter table public.lojas drop constraint if exists lojas_omie_pedido_compra_nunca_loja4;
alter table public.lojas add constraint lojas_omie_pedido_compra_nunca_loja4 check (id <> 4 or not omie_gravar_pedidos_compra);
comment on column public.lojas.omie_gravar_pedidos_compra is
  'C1: loja Omie liberada para criar pedido de compra no NTB e gravá-lo no Omie. Só vale com OMIE_GRAVAR_PEDIDOS_COMPRA=1 e NTB_AMBIENTE=producao no servidor. Loja 4 nunca.';
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
  payload               jsonb,                                                           -- IncluirPedCompra da última inclusão tentada (sem o e-mail do aprovador)
  -- A última inclusão pode ter sido gravada no Omie sem resposta (tempo esgotado, rede, erro 5xx): até uma consulta
  -- confirmar que o pedido NÃO está lá, ele não reabre nem cancela no NTB e a próxima tentativa consulta antes de incluir.
  incerto               boolean not null default false,
  -- Pedido adotado de uma tentativa anterior (já estava no Omie) com conteúdo diferente do pedido atual do NTB: conferir no Omie.
  divergente            boolean not null default false,
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
-- sem `payload` para a sessão (ele já é guardado sem o e-mail do aprovador, mas não precisa estar à vista)
grant select (pedido_id, loja_id, cod_int, status, n_cod_ped, numero_omie, tentativas, proxima_tentativa_em, ultima_tentativa_em,
              ultimo_erro, enviado_em, incerto, divergente, created_at, updated_at) on public.pedidos_compra_omie to authenticated;
grant all on public.pedidos_compra_omie to service_role;

-- Pedido gravado, sendo gravado ou que PODE estar gravado no Omie (incerto) não sai de "aprovado" pelo NTB: reabrir/cancelar
-- só no Omie (o NTB ainda não altera nem exclui pedido no Omie; a mesma regra está em bloqueioEtapaPorOmie, no TS).
-- Corrida com o envio: pc_acao trava a linha do pedido (for update) antes deste gatilho, e pc_omie_reivindicar trava a MESMA
-- linha antes de virar 'enviando' e confere etapa = 'aprovado'. Quem chega depois espera e vê o que o outro gravou.
-- O `for update` daqui também espera uma escrita em andamento na linha da fila (mesma ordem de travas: pedido → fila).
create or replace function public.trg_pedidos_compra_omie_etapa() returns trigger
language plpgsql set search_path = public as $$
declare v pedidos_compra_omie%rowtype;
begin
  if old.etapa = 'aprovado' and new.etapa is distinct from old.etapa then
    select * into v from pedidos_compra_omie where pedido_id = old.id for update;
    if found and v.status in ('enviando', 'enviado') then
      raise exception 'Este pedido já está no Omie%: altere ou cancele lá', coalesce(' (nº ' || v.numero_omie || ')', '') using errcode = '22023';
    end if;
    if found and v.incerto then
      raise exception 'Este pedido pode já ter sido gravado no Omie (a última tentativa ficou sem resposta). Use "Conferir no Omie" antes de reabrir ou cancelar'
        using errcode = '22023';
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

-- Põe o pedido aprovado na fila de gravação no Omie. Idempotente: pendente/enviando/enviado ficam como estão.
-- 'precisa_corrigir' só volta para 'pendente' (tentativas zeradas) quando o pedido foi APROVADO DE NOVO depois da última
-- tentativa (reabrir → editar → aprovar), e nunca se a última inclusão ficou incerta. Chamar de novo não zera o teto.
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
  on conflict (pedido_id) do nothing;
  select * into v from pedidos_compra_omie where pedido_id = p_pedido for update;
  if v.status = 'precisa_corrigir' and not v.incerto and v_ped.aprovado_em > coalesce(v.ultima_tentativa_em, '-infinity'::timestamptz) then
    update pedidos_compra_omie set status = 'pendente', tentativas = 0, proxima_tentativa_em = null, ultimo_erro = null, divergente = false, updated_at = now()
     where pedido_id = p_pedido returning * into v;
  end if;
  return jsonb_build_object('ok', true, 'status', v.status, 'cod_int', v.cod_int, 'incerto', v.incerto);
end $$;

-- Reivindica uma tentativa (status 'enviando') com a linha do PEDIDO travada e etapa = 'aprovado' conferida na mesma
-- transação (fecha a corrida com reabrir/cancelar). p_modo:
--   'enviar'   = pendente com a próxima tentativa vencida, ou 'enviando' parado há mais de p_travado_seg (tentativa morta);
--   'conferir' = 'precisa_corrigir' incerto, no máximo 1 vez a cada 10 min: só consulta o Omie, nunca inclui.
-- {ok:false} = nada a fazer agora (o chamador não chama o Omie).
create or replace function public.pc_omie_reivindicar(p_loja bigint, p_pedido bigint, p_modo text default 'enviar', p_travado_seg int default 3600)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ped pedidos_compra%rowtype; v pedidos_compra_omie%rowtype; v_pode boolean;
begin
  if p_modo not in ('enviar', 'conferir') then raise exception 'modo inválido: %', p_modo using errcode = '22023'; end if;
  select * into v_ped from pedidos_compra where id = p_pedido and loja_id = p_loja for update;
  if not found or v_ped.etapa <> 'aprovado' then return jsonb_build_object('ok', false, 'motivo', 'pedido não está aprovado'); end if;
  select * into v from pedidos_compra_omie where pedido_id = p_pedido and loja_id = p_loja for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'pedido fora da fila do Omie'); end if;
  v_pode := case p_modo
    when 'enviar' then (v.status = 'pendente' and (v.proxima_tentativa_em is null or v.proxima_tentativa_em <= now()))
                    or (v.status = 'enviando' and v.ultima_tentativa_em < now() - make_interval(secs => p_travado_seg))
    else v.status = 'precisa_corrigir' and v.incerto and (v.ultima_tentativa_em is null or v.ultima_tentativa_em < now() - interval '10 minutes')
  end;
  if not v_pode then
    return jsonb_build_object('ok', false, 'motivo', 'fora da hora', 'status', v.status, 'proxima_tentativa_em', v.proxima_tentativa_em);
  end if;
  update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now(), updated_at = now() where pedido_id = p_pedido;
  return jsonb_build_object('ok', true, 'status_antes', v.status, 'tentativas', v.tentativas, 'cod_int', v.cod_int,
                            'incerto', v.incerto, 'payload_antes', v.payload);
end $$;

revoke all on function public.pc_omie_enfileirar(bigint, bigint) from public, anon, authenticated;
grant execute on function public.pc_omie_enfileirar(bigint, bigint) to service_role;
revoke all on function public.pc_omie_reivindicar(bigint, bigint, text, int) from public, anon, authenticated;
grant execute on function public.pc_omie_reivindicar(bigint, bigint, text, int) to service_role;
revoke all on function public._pc_loja_propria(bigint) from public, anon, authenticated;
grant execute on function public._pc_loja_propria(bigint) to service_role;

commit;

notify pgrst, 'reload schema';
