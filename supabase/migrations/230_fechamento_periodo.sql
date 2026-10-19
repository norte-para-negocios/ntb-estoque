-- 230 — Fase F: fechamento de período (mês) por loja, com trava no banco.
-- Plano: docs/superpowers/plans/2026-10-19-fase-f-contador.md (R1–R4).
--
-- O gerente fecha um mês ANTERIOR ao atual; depois disso nenhuma escrita do Norte Estoque com data dentro dele é
-- aceita: movimento do ledger próprio, estorno/alteração de item de nota lançado nele, OP própria, inventário,
-- pedido de compra e correção de custo de ajuste do Omie. Reabrir só com permissão própria e motivo, tudo registrado
-- em estoque_periodo_eventos (append-only). Erro de período fechado: SQLSTATE PF001, mensagem "Período fechado: …".
-- Lojas Omie: nada que o sync do Omie grava ganha gatilho (movimentos, ordens_producao de loja Omie, notas); a trava
-- delas é no servidor, antes de mandar ao Omie (lib/estoque/periodo-fechado.ts).
--
-- SÓ ADITIVA (código velho continua funcionando). Aplicar (manual, com backup e OK do dono):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 230_fechamento_periodo.sql
-- Depois: NOTIFY pgrst / restart do PostgREST; desktop/scripts/gerar-schema.sh + versão nova do app desktop.
-- Teste: scripts/testes-sql/230_fechamento_periodo.sql (banco local, nunca produção).

begin;

insert into permissoes (nome) values ('Fechamento - Fechar mes'), ('Fechamento - Reabrir mes') on conflict (nome) do nothing;

-- 1) Estado e histórico -----------------------------------------------------------------------------------------------
create table if not exists public.estoque_periodo_fechado (
  loja_id          bigint not null references public.lojas(id),
  mes              date not null check (mes = date_trunc('month', mes)::date),
  fechado_em       timestamptz not null default now(),
  fechado_por      text,
  fechado_por_nome text,
  obs              text,
  primary key (loja_id, mes)
);

create table if not exists public.estoque_periodo_eventos (
  id          bigint generated always as identity primary key,
  loja_id     bigint not null references public.lojas(id),
  mes         date not null,
  acao        text not null check (acao in ('fechar', 'reabrir')),
  user_id     text,
  user_nome   text,
  motivo      text,
  pendencias  jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists estoque_periodo_eventos_loja on public.estoque_periodo_eventos (loja_id, id desc);

create or replace function public.trg_estoque_periodo_eventos_imutavel() returns trigger language plpgsql as $$
begin
  raise exception 'estoque_periodo_eventos é append-only' using errcode = '55000';
end $$;
drop trigger if exists estoque_periodo_eventos_imutavel on public.estoque_periodo_eventos;
create trigger estoque_periodo_eventos_imutavel before update or delete on public.estoque_periodo_eventos
  for each row execute function public.trg_estoque_periodo_eventos_imutavel();

do $$ declare t text; begin
  foreach t in array array['estoque_periodo_fechado', 'estoque_periodo_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 2) Consulta e exigência -----------------------------------------------------------------------------------------------
create or replace function public.periodo_fechado(p_loja bigint, p_data date) returns boolean
language sql stable security definer set search_path = public as $$
  select p_data is not null and exists (
    select 1 from estoque_periodo_fechado where loja_id = p_loja and mes = date_trunc('month', p_data)::date)
$$;

-- Data de Brasília/Bahia de um timestamptz (o servidor do banco não está no fuso do Brasil).
create or replace function public.data_bahia(p_ts timestamptz) returns date
language sql immutable set search_path = public as $$ select (p_ts at time zone 'America/Bahia')::date $$;

-- Levanta PF001 se a data cai num mês fechado. Trava consultiva compartilhada por loja: o fechar_periodo pega a
-- exclusiva, então uma escrita e o fechamento da mesma loja nunca se cruzam no meio.
create or replace function public._exigir_periodo_aberto(p_loja bigint, p_data date, p_oque text) returns void
language plpgsql security definer set search_path = public as $$
declare f estoque_periodo_fechado%rowtype;
begin
  if p_data is null or p_loja is null then return; end if;
  perform pg_advisory_xact_lock_shared(7230, p_loja::int);
  select * into f from estoque_periodo_fechado where loja_id = p_loja and mes = date_trunc('month', p_data)::date;
  if found then
    raise exception 'Período fechado: % com data em %. O mês % foi fechado em % por %. Para mudar, quem tem a permissão "Reabrir mês" reabre em Contador → Fechamento.',
      coalesce(p_oque, 'escrita'), to_char(p_data, 'DD/MM/YYYY'), to_char(f.mes, 'MM/YYYY'),
      to_char(f.fechado_em at time zone 'America/Bahia', 'DD/MM/YYYY'), coalesce(nullif(f.fechado_por_nome, ''), 'alguém')
      using errcode = 'PF001';
  end if;
end $$;

-- 3) Pendências: o que ainda vai escrever com data no mês (reenvios ao Omie, inventário aberto, correção de custo) -----
create or replace function public.periodo_pendencias(p_loja bigint, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini date := date_trunc('month', p_mes)::date;
  v_fim date := (date_trunc('month', p_mes) + interval '1 month')::date;
  v_out jsonb := '[]'::jsonb; n int;
begin
  -- ajustes manuais e transferências do Omie à espera de reenvio (o resíduo TRF sem transferência e as linhas
  -- encerradas pelo teto de 30 tentativas nunca mais são reenviados: não contam)
  select count(*) into n from movimentos m
   where m.loja_id = p_loja and m.status in ('Iniciado', 'Processando', 'Erro', 'Sem CMC') and m.id_ajuste is null
     and coalesce(m.tentativas, 0) < 30 and not (m.tipo = 'TRF' and m.transferencia_id is null)
     and m.data >= (v_ini::timestamp at time zone 'America/Bahia') and m.data < (v_fim::timestamp at time zone 'America/Bahia');
  if n > 0 then v_out := v_out || jsonb_build_object('tipo', 'ajuste_omie', 'quantidade', n, 'detalhe', 'ajustes ou transferências esperando reenvio ao Omie'); end if;

  select count(*) into n from inventarios i
   where i.loja_id = p_loja and i.status is distinct from 'Finalizado'
     and i.data >= (v_ini::timestamp at time zone 'America/Bahia') and i.data < (v_fim::timestamp at time zone 'America/Bahia');
  if n > 0 then v_out := v_out || jsonb_build_object('tipo', 'inventario_aberto', 'quantidade', n, 'detalhe', 'inventários do mês ainda não finalizados'); end if;

  select count(*) into n from inventario_items it join inventarios i on i.id = it.inventario_id
   where i.loja_id = p_loja and it.status in ('Iniciado', 'Processando', 'Processando no Omie', 'Erro', 'Sem CMC') and it.id_ajuste is null
     and coalesce(it.tentativas, 0) < 30
     and i.data >= (v_ini::timestamp at time zone 'America/Bahia') and i.data < (v_fim::timestamp at time zone 'America/Bahia');
  if n > 0 then v_out := v_out || jsonb_build_object('tipo', 'inventario_envio', 'quantidade', n, 'detalhe', 'itens de inventário esperando envio ao Omie'); end if;

  select count(*) into n from estoque_correcao_custo c
   where c.loja_id = p_loja and c.status in ('excluindo', 'relancando', 'pendente_relancar') and c.data_ajuste >= v_ini and c.data_ajuste < v_fim;
  if n > 0 then v_out := v_out || jsonb_build_object('tipo', 'correcao_custo', 'quantidade', n, 'detalhe', 'correções de custo em andamento'); end if;

  select count(*) into n from ordens_producao o
   where o.loja_id = p_loja and o.conclusao_status is not null and not coalesce(o.concluida, false)
     and coalesce(o.conclusao_data_desejada, o.identificacao_d_dt_previsao) >= v_ini
     and coalesce(o.conclusao_data_desejada, o.identificacao_d_dt_previsao) < v_fim;
  if n > 0 then v_out := v_out || jsonb_build_object('tipo', 'op_conclusao', 'quantidade', n, 'detalhe', 'OPs com conclusão esperando reenvio ao Omie'); end if;
  return v_out;
end $$;

-- 4) Fechar e reabrir (só o servidor chama, depois de conferir a permissão) -------------------------------------------
-- Com pendência, só fecha com p_aceitar_pendencias = true: enquanto o mês estiver fechado esses reenvios não saem
-- (os crons pulam), e a lista fica gravada no evento.
create or replace function public.fechar_periodo(
  p_loja bigint, p_mes date, p_user text, p_user_nome text, p_obs text default null, p_aceitar_pendencias boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_pend jsonb;
begin
  if p_loja is null or p_mes is null then raise exception 'Loja e mês são obrigatórios' using errcode = '22023'; end if;
  if v_mes >= date_trunc('month', now() at time zone 'America/Bahia')::date then
    raise exception 'Só dá para fechar um mês que já terminou' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(7230, p_loja::int);
  if exists (select 1 from estoque_periodo_fechado where loja_id = p_loja and mes = v_mes) then
    return jsonb_build_object('ok', true, 'duplicado', true);
  end if;
  v_pend := periodo_pendencias(p_loja, v_mes);
  if jsonb_array_length(v_pend) > 0 and not coalesce(p_aceitar_pendencias, false) then
    return jsonb_build_object('ok', false, 'pendencias', v_pend);
  end if;
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por, fechado_por_nome, obs) values (p_loja, v_mes, p_user, p_user_nome, nullif(btrim(coalesce(p_obs, '')), ''));
  insert into estoque_periodo_eventos (loja_id, mes, acao, user_id, user_nome, motivo, pendencias)
  values (p_loja, v_mes, 'fechar', p_user, p_user_nome, nullif(btrim(coalesce(p_obs, '')), ''), v_pend);
  return jsonb_build_object('ok', true, 'duplicado', false, 'pendencias', v_pend);
end $$;

create or replace function public.reabrir_periodo(p_loja bigint, p_mes date, p_user text, p_user_nome text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date;
begin
  if length(btrim(coalesce(p_motivo, ''))) < 10 then
    raise exception 'Explique por que o mês vai ser reaberto (pelo menos 10 letras)' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(7230, p_loja::int);
  delete from estoque_periodo_fechado where loja_id = p_loja and mes = v_mes;
  if not found then raise exception 'Este mês não está fechado' using errcode = '22023'; end if;
  insert into estoque_periodo_eventos (loja_id, mes, acao, user_id, user_nome, motivo) values (p_loja, v_mes, 'reabrir', p_user, p_user_nome, btrim(p_motivo));
  return jsonb_build_object('ok', true);
end $$;

-- 5) Gatilhos (estoque próprio + o que só o Norte Estoque grava) ---------------------------------------------------------
-- (a) ledger: movimento novo com data num mês fechado. Estorno com data de hoje de um documento antigo passa.
create or replace function public.trg_estoque_movimentos_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _exigir_periodo_aberto(new.loja_id, new.data_ref, 'movimento de estoque');
  return new;
end $$;
drop trigger if exists estoque_movimentos_periodo on public.estoque_movimentos;
create trigger estoque_movimentos_periodo before insert on public.estoque_movimentos
  for each row execute function public.trg_estoque_movimentos_periodo();

-- (b) item de nota já lançado num mês fechado: não estorna (desfazer entrada / excluir nota), não muda, não apaga.
create or replace function public.trg_compras_itens_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_data date;
begin
  if not coalesce(old.lancado, false) or old.movimento_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.lancado is not distinct from old.lancado and new.movimento_id is not distinct from old.movimento_id
     and new.codigo_produto is not distinct from old.codigo_produto and new.quantidade is not distinct from old.quantidade
     and new.fator is not distinct from old.fator and new.custo_unitario_base is not distinct from old.custo_unitario_base then
    return new;
  end if;
  select data_ref into v_data from estoque_movimentos where id = old.movimento_id;
  perform _exigir_periodo_aberto(old.loja_id, v_data, 'nota de entrada lançada no estoque');
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists compras_itens_periodo on public.compras_proprio_itens;
create trigger compras_itens_periodo before update or delete on public.compras_proprio_itens
  for each row execute function public.trg_compras_itens_periodo();

-- (c) OP de loja de estoque próprio (a mesma tabela das lojas Omie: só vale para modo 'proprio').
create or replace function public.trg_ordens_producao_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loja bigint := coalesce(new.loja_id, old.loja_id);
begin
  if (select modo_estoque from lojas where id = v_loja) is distinct from 'proprio' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and coalesce(old.concluida, false) then
    if tg_op = 'DELETE' or new.concluida is distinct from old.concluida or new.dt_conclusao_real is distinct from old.dt_conclusao_real
       or new.identificacao_n_qtde is distinct from old.identificacao_n_qtde or new.producao_ref is distinct from old.producao_ref
       or new.custo_total is distinct from old.custo_total or new.identificacao_n_cod_produto is distinct from old.identificacao_n_cod_produto then
      perform _exigir_periodo_aberto(v_loja, old.dt_conclusao_real, 'OP concluída');
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'INSERT' or new.identificacao_d_dt_previsao is distinct from old.identificacao_d_dt_previsao then
    perform _exigir_periodo_aberto(v_loja, new.identificacao_d_dt_previsao, 'ordem de produção');
  end if;
  if coalesce(new.concluida, false) and (tg_op = 'INSERT' or new.dt_conclusao_real is distinct from old.dt_conclusao_real) then
    perform _exigir_periodo_aberto(v_loja, new.dt_conclusao_real, 'conclusão de OP');
  end if;
  return new;
end $$;
drop trigger if exists ordens_producao_periodo on public.ordens_producao;
create trigger ordens_producao_periodo before insert or update or delete on public.ordens_producao
  for each row execute function public.trg_ordens_producao_periodo();

-- (d) inventário (as duas lojas; só o Norte Estoque grava estas tabelas). Mudança de status do reenvio passa.
create or replace function public.trg_inventarios_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform _exigir_periodo_aberto(old.loja_id, data_bahia(old.data), 'inventário');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform _exigir_periodo_aberto(new.loja_id, data_bahia(new.data), 'inventário');
    return new;
  end if;
  return old;
end $$;
drop trigger if exists inventarios_periodo on public.inventarios;
create trigger inventarios_periodo before insert or delete or update of data on public.inventarios
  for each row execute function public.trg_inventarios_periodo();

create or replace function public.trg_inventario_items_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv bigint := coalesce(new.inventario_id, old.inventario_id); v_loja bigint := coalesce(new.loja_id, old.loja_id); v_data timestamptz;
begin
  select data into v_data from inventarios where id = v_inv;
  perform _exigir_periodo_aberto(v_loja, data_bahia(v_data), 'item de inventário');
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists inventario_items_periodo on public.inventario_items;
create trigger inventario_items_periodo before insert or delete on public.inventario_items
  for each row execute function public.trg_inventario_items_periodo();
drop trigger if exists inventario_items_periodo_quan on public.inventario_items;
create trigger inventario_items_periodo_quan before update of quan on public.inventario_items
  for each row when (old.quan is distinct from new.quan) execute function public.trg_inventario_items_periodo();

-- (e) pedido de compra (estoque próprio): criado num mês fechado não muda de conteúdo (etapa/aprovação passam);
--     previsão de entrega não cai num mês fechado.
create or replace function public.trg_pedidos_compra_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.fornecedor_id, new.fornecedor_nome, new.fornecedor_cnpj, new.previsao_entrega, new.frete, new.outras_despesas,
        new.parcelas, new.numero_fornecedor, new.contato, new.obs) is distinct from
       (old.fornecedor_id, old.fornecedor_nome, old.fornecedor_cnpj, old.previsao_entrega, old.frete, old.outras_despesas,
        old.parcelas, old.numero_fornecedor, old.contato, old.obs) then
    perform _exigir_periodo_aberto(old.loja_id, data_bahia(old.created_at), 'pedido de compra');
  end if;
  if new.previsao_entrega is not null and (tg_op = 'INSERT' or new.previsao_entrega is distinct from old.previsao_entrega) then
    perform _exigir_periodo_aberto(new.loja_id, new.previsao_entrega, 'previsão de entrega do pedido');
  end if;
  return new;
end $$;
drop trigger if exists pedidos_compra_periodo on public.pedidos_compra;
create trigger pedidos_compra_periodo before insert or update on public.pedidos_compra
  for each row execute function public.trg_pedidos_compra_periodo();

create or replace function public.trg_pedidos_compra_itens_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ped bigint := coalesce(new.pedido_id, old.pedido_id); v_criado timestamptz; v_loja bigint;
begin
  select created_at, loja_id into v_criado, v_loja from pedidos_compra where id = v_ped;
  perform _exigir_periodo_aberto(v_loja, data_bahia(v_criado), 'item de pedido de compra');
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists pedidos_compra_itens_periodo on public.pedidos_compra_itens;
create trigger pedidos_compra_itens_periodo before insert or update or delete on public.pedidos_compra_itens
  for each row execute function public.trg_pedidos_compra_itens_periodo();

-- (f) correção de custo de ajuste do Omie (o Norte Estoque exclui e relança o ajuste NA DATA DELE).
create or replace function public.trg_correcao_custo_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _exigir_periodo_aberto(new.loja_id, new.data_ajuste, 'correção de custo de ajuste');
  return new;
end $$;
drop trigger if exists correcao_custo_periodo on public.estoque_correcao_custo;
create trigger correcao_custo_periodo before insert on public.estoque_correcao_custo
  for each row execute function public.trg_correcao_custo_periodo();

-- 6) Cancelamento da nota na SEFAZ que não dá para estornar (mês fechado ou devolução ativa): a fila não para --------
create or replace function public.sefaz_marcar_cancelada(p_loja bigint, p_chave text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n notas_fiscais%rowtype; c compras_proprio%rowtype; v_nota boolean := false; v_est jsonb; v_estornada boolean := false; v_n int := 0;
  v_mes_fechado boolean := false; v_msg text; v_estado text; v_pendente boolean := false;
begin
  insert into sefaz_chaves_canceladas (loja_id, chave) values (p_loja, p_chave) on conflict do nothing;
  select * into n from notas_fiscais where loja_id = p_loja and c_chave_nfe = p_chave and deleted_at is null for update;
  if found then
    v_nota := true;
    update notas_fiscais set updated_at = now(),
           full_object = jsonb_set(coalesce(full_object, '{}'::jsonb), '{infoCadastro}', coalesce(full_object->'infoCadastro', '{}'::jsonb) || jsonb_build_object('cCancelada', 'S'), true)
     where id = n.id;
  end if;
  select * into c from compras_proprio where loja_id = p_loja and chave_acesso = p_chave for update;
  if found then
    if c.status = 'pendente' then
      update compras_proprio set status = 'cancelada', updated_at = now() where id = c.id;
    elsif c.status in ('lancada', 'parcial') then
      begin
        v_est := estornar_compra(c.id, 'SEFAZ: nota cancelada');
        v_estornada := true; v_n := coalesce((v_est->>'estornados')::int, 0);
      exception when sqlstate 'PF001' or sqlstate '22023' then
        -- PF001 = mês fechado; 22023 = regra do estorno (ex.: devolução ao fornecedor ativa, migration 231). Nos dois a
        -- fila da SEFAZ não pode voltar atrás: a chave fica cancelada e a compra marcada para estornar à mão.
        get stacked diagnostics v_msg = message_text, v_estado = returned_sqlstate;
        v_mes_fechado := v_estado = 'PF001';
        v_pendente := true;
        insert into compras_proprio_eventos (loja_id, compra_id, tipo, detalhe, user_id)
        values (p_loja, c.id, 'cancelada', jsonb_build_object('mes_fechado', v_mes_fechado, 'estorno_pendente', true, 'motivo', v_msg), 'SEFAZ');
      end;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'nota', v_nota, 'nota_id', case when v_nota then n.id end,
                            'estornada', v_estornada, 'estornados', v_n, 'mes_fechado', v_mes_fechado, 'estorno_pendente', v_pendente);
end $function$;

-- 7) Quem chama o quê -------------------------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'periodo_fechado(bigint,date)', '_exigir_periodo_aberto(bigint,date,text)', 'periodo_pendencias(bigint,date)',
    'fechar_periodo(bigint,date,text,text,text,boolean)', 'reabrir_periodo(bigint,date,text,text,text)',
    'sefaz_marcar_cancelada(bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array[
    'trg_estoque_movimentos_periodo()', 'trg_compras_itens_periodo()', 'trg_ordens_producao_periodo()', 'trg_inventarios_periodo()',
    'trg_inventario_items_periodo()', 'trg_pedidos_compra_periodo()', 'trg_pedidos_compra_itens_periodo()', 'trg_correcao_custo_periodo()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
grant execute on function public.data_bahia(timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
