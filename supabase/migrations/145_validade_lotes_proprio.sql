-- 145 — Validade e lotes no Estoque próprio (07/10/2026). Aditiva; lojas 'omie' não são tocadas.
--
-- Ideia: o ledger (estoque_movimentos) continua sendo a verdade. Um gatilho AFTER INSERT distribui CADA movimento
-- em lotes (estoque_lotes) e grava o vínculo (estoque_lote_movimentos). Assim nenhuma rota que já grava no ledger
-- (venda, OP, transferência, inventário, compra, estorno) precisa mudar, e o saldo dos lotes de um (local, produto)
-- é SEMPRE igual ao saldo do ledger:
--   * entrada (quantidade > 0): cria/soma um lote com o lote e a validade descobertos pela origem
--     (compra: item da compra; OP: validade e número da OP; outros: GUC estoque.lote/estoque.validade; senão o
--     prazo padrão do produto, produtos.validade_dias); sem lote nem validade cai no "saldo sem lote".
--   * saída (quantidade < 0): consome FEFO (validade mais próxima primeiro; sem validade por último); o que faltar sai
--     do "saldo sem lote", que é o único lote que pode ficar negativo (o ledger permite negativo).
--   * estorno (reverses_id): espelha os lotes do movimento original (devolve ao mesmo lote).
--   * transferência: a perna de saída consome FEFO na origem; a de entrada recria os MESMOS lotes no destino.
--   * baixa de um lote específico (vencimento): GUC estoque.lote_id dirige a saída para aquele lote.

-- 1) Colunas novas ------------------------------------------------------------------------------------------------
alter table public.produtos add column if not exists validade_dias int check (validade_dias is null or validade_dias > 0);
alter table public.compras_proprio_itens add column if not exists lote text;
alter table public.compras_proprio_itens add column if not exists validade date;
alter table public.estoque_config add column if not exists validade_alerta_dias int not null default 7
  check (validade_alerta_dias between 1 and 365);

-- 2) Tabelas -------------------------------------------------------------------------------------------------------
create table if not exists public.estoque_lotes (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  codigo_local_estoque bigint not null,
  codigo_produto       bigint not null,
  lote                 text,          -- null + validade null = "saldo sem lote" (um por local/produto)
  validade             date,
  saldo                numeric(18,6) not null default 0,
  quantidade_entrada   numeric(18,6) not null default 0,
  origem               text,
  ref                  text,
  movimento_origem_id  bigint,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (saldo >= 0 or (lote is null and validade is null))
);
create unique index if not exists estoque_lotes_sem_lote_uk on public.estoque_lotes (loja_id, codigo_local_estoque, codigo_produto)
  where lote is null and validade is null;
create unique index if not exists estoque_lotes_ident_uk on public.estoque_lotes
  (loja_id, codigo_local_estoque, codigo_produto, coalesce(lote, ''), coalesce(validade, '0001-01-01'::date))
  where not (lote is null and validade is null);
create index if not exists estoque_lotes_fefo on public.estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, validade nulls last, id);
create index if not exists estoque_lotes_vencimento on public.estoque_lotes (loja_id, validade) where saldo > 0 and validade is not null;

create table if not exists public.estoque_lote_movimentos (
  id           bigint generated always as identity primary key,
  loja_id      bigint not null,
  movimento_id bigint not null references public.estoque_movimentos(id),
  lote_id      bigint not null references public.estoque_lotes(id),
  quantidade   numeric(18,6) not null check (quantidade <> 0),
  created_at   timestamptz not null default now()
);
create index if not exists estoque_lote_movimentos_mov on public.estoque_lote_movimentos (movimento_id);
create index if not exists estoque_lote_movimentos_lote on public.estoque_lote_movimentos (lote_id);

do $$ declare t text; begin
  foreach t in array array['estoque_lotes', 'estoque_lote_movimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 3) Peças do motor ------------------------------------------------------------------------------------------------
-- Lote "sem lote" do (loja, local, produto); cria se faltar.
create or replace function public._lote_sem_lote(p_loja bigint, p_local bigint, p_produto bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  select id into v from estoque_lotes
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and lote is null and validade is null;
  if v is null then
    insert into estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, origem)
    values (p_loja, p_local, p_produto, 'sem_lote')
    on conflict do nothing;
    select id into v from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and lote is null and validade is null;
  end if;
  return v;
end $$;

-- Soma uma quantidade POSITIVA num lote identificado por (lote, validade); cria se não existir.
create or replace function public._lote_entrar(
  p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_lote text, p_validade date, p_origem text, p_ref text
) returns void
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if p_qtd <= 0 then return; end if;
  if p_lote is null and p_validade is null then
    v := _lote_sem_lote(p_loja, p_local, p_produto);
  else
    select id into v from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto
       and coalesce(lote, '') = coalesce(p_lote, '') and coalesce(validade, '0001-01-01'::date) = coalesce(p_validade, '0001-01-01'::date)
       and not (lote is null and validade is null)
     for update;
    if v is null then
      insert into estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, lote, validade, origem, ref, movimento_origem_id)
      values (p_loja, p_local, p_produto, p_lote, p_validade, p_origem, p_ref, p_mov)
      returning id into v;
    end if;
  end if;
  update estoque_lotes set saldo = saldo + p_qtd, quantidade_entrada = quantidade_entrada + p_qtd, updated_at = now() where id = v;
  insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, v, p_qtd);
end $$;

-- Tira uma quantidade POSITIVA: primeiro do lote preferido (se houver), depois FEFO, o resto do "sem lote".
create or replace function public._lote_sair(p_mov bigint, p_loja bigint, p_local bigint, p_produto bigint, p_qtd numeric, p_preferido bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rest numeric := p_qtd; v_tira numeric; l record;
begin
  if p_qtd <= 0 then return; end if;
  if p_preferido is not null then
    select * into l from estoque_lotes
     where id = p_preferido and loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;
    if found and l.saldo > 0 then
      v_tira := least(l.saldo, v_rest);
      update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
      insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
      v_rest := v_rest - v_tira;
    end if;
  end if;
  for l in
    select * from estoque_lotes
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and saldo > 0
       and not (lote is null and validade is null)
     order by validade nulls last, created_at, id
     for update
  loop
    exit when v_rest <= 0;
    v_tira := least(l.saldo, v_rest);
    update estoque_lotes set saldo = saldo - v_tira, updated_at = now() where id = l.id;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_tira);
    v_rest := v_rest - v_tira;
  end loop;
  if v_rest > 0 then
    -- "sem lote" é o último a sair e o único que pode ficar negativo (o ledger permite saldo negativo)
    l := null;
    update estoque_lotes set saldo = saldo - v_rest, updated_at = now()
     where id = _lote_sem_lote(p_loja, p_local, p_produto)
     returning * into l;
    insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (p_loja, p_mov, l.id, -v_rest);
  end if;
end $$;

-- Descobre lote e validade de uma ENTRADA pela origem.
create or replace function public._lote_da_entrada(m public.estoque_movimentos, out o_lote text, out o_validade date)
language plpgsql security definer set search_path = public as $$
declare v_dias int; v_op ordens_producao%rowtype; v_guc_l text; v_guc_v text; v_map jsonb;
begin
  o_lote := null; o_validade := null;
  -- 1) contexto explícito da transação (entrada manual com lote, testes)
  begin v_guc_l := nullif(current_setting('estoque.lote', true), ''); exception when others then v_guc_l := null; end;
  begin v_guc_v := nullif(current_setting('estoque.validade', true), ''); exception when others then v_guc_v := null; end;
  if v_guc_l is not null or v_guc_v is not null then
    o_lote := v_guc_l; o_validade := v_guc_v::date; return;
  end if;
  -- 2) compra: item da compra pela (ref = chave ou 'compra:id', linha)
  if m.origem = 'COMPRA' then
    select i.lote, i.validade into o_lote, o_validade
      from compras_proprio_itens i join compras_proprio c on c.id = i.compra_id
     where c.loja_id = m.loja_id and i.linha = m.linha
       and coalesce(c.chave_acesso, 'compra:' || c.id) = m.ref
     limit 1;
    -- compra lançada e criada na mesma chamada (lancar_compra_com_lotes): mapa linha -> {lote, validade} da transação
    if o_lote is null and o_validade is null then
      begin
        v_map := nullif(current_setting('estoque.lotes_compra', true), '')::jsonb;
      exception when others then v_map := null; end;
      if v_map is not null and v_map ? m.linha::text then
        o_lote := nullif(btrim(v_map -> m.linha::text ->> 'lote'), '');
        o_validade := nullif(v_map -> m.linha::text ->> 'validade', '')::date;
      end if;
    end if;
  -- 3) produção da OP: ref = 'OP:<id>:<n>' → validade e número da OP
  elsif m.origem = 'PRODUCAO' and m.ref like 'OP:%' then
    select * into v_op from ordens_producao where id = nullif(split_part(m.ref, ':', 2), '')::bigint and loja_id = m.loja_id;
    if found then
      o_lote := coalesce(v_op.identificacao_c_num_op, v_op.num_ordem::text);
      o_validade := v_op.validade;
    end if;
  elsif m.origem = 'PRODUCAO' then
    o_lote := m.ref;
  end if;
  -- 4) sem validade informada: prazo padrão do produto (entrada de compra e produção)
  if o_validade is null and m.origem in ('COMPRA', 'PRODUCAO', 'ENTRADA_MANUAL', 'MANUAL') then
    select validade_dias into v_dias from produtos where loja_id = m.loja_id and codigo_produto = m.codigo_produto;
    if v_dias is not null then o_validade := m.data_ref + v_dias; end if;
  end if;
end $$;

-- 4) Gatilho --------------------------------------------------------------------------------------------------------
create or replace function public.trg_estoque_movimentos_lotes() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record; v_pref bigint; v_lote text; v_val date; v_par bigint; v_achou boolean := false;
begin
  -- a) estorno: espelha os lotes do original (devolve ao mesmo lote)
  if new.reverses_id is not null then
    for r in select lm.lote_id, lm.quantidade, l.lote, l.validade from estoque_lote_movimentos lm join estoque_lotes l on l.id = lm.lote_id
              where lm.movimento_id = new.reverses_id loop
      v_achou := true;
      if -r.quantidade > 0 then
        -- devolve ao lote de onde saiu (se o local for outro, recria no local do estorno)
        if exists (select 1 from estoque_lotes where id = r.lote_id and codigo_local_estoque = new.codigo_local_estoque) then
          update estoque_lotes set saldo = saldo - r.quantidade, updated_at = now() where id = r.lote_id;
          insert into estoque_lote_movimentos (loja_id, movimento_id, lote_id, quantidade) values (new.loja_id, new.id, r.lote_id, -r.quantidade);
        else
          perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, -r.quantidade, r.lote, r.validade, new.origem, new.ref);
        end if;
      else
        perform _lote_sair(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, r.quantidade, r.lote_id);
      end if;
    end loop;
    if v_achou then return null; end if;
    -- original anterior aos lotes: segue como movimento comum
  end if;

  if new.quantidade > 0 then
    -- b) perna de ENTRADA de transferência: recria os lotes que a perna de saída tirou
    if new.tipo = 'TRF' and new.transferencia_ref is not null then
      select id into v_par from estoque_movimentos
       where loja_id = new.loja_id and origem = new.origem and ref = new.ref and codigo_produto = new.codigo_produto
         and transferencia_ref = new.transferencia_ref and quantidade < 0 and id <> new.id and reverses_id is null
       order by id desc limit 1;
      if v_par is not null then
        for r in select l.lote, l.validade, -lm.quantidade as q from estoque_lote_movimentos lm join estoque_lotes l on l.id = lm.lote_id
                  where lm.movimento_id = v_par loop
          v_achou := true;
          perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, r.q, r.lote, r.validade, new.origem, new.ref);
        end loop;
        if v_achou then return null; end if;
      end if;
    end if;
    -- c) entrada comum
    select o_lote, o_validade into v_lote, v_val from _lote_da_entrada(new);
    perform _lote_entrar(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, new.quantidade, v_lote, v_val, new.origem, new.ref);
  else
    -- d) saída: lote dirigido (baixa por vencimento) ou FEFO
    begin v_pref := nullif(current_setting('estoque.lote_id', true), '')::bigint; exception when others then v_pref := null; end;
    perform _lote_sair(new.id, new.loja_id, new.codigo_local_estoque, new.codigo_produto, -new.quantidade, v_pref);
  end if;
  return null;
end $$;

drop trigger if exists estoque_movimentos_lotes on public.estoque_movimentos;
create trigger estoque_movimentos_lotes after insert on public.estoque_movimentos
  for each row execute function public.trg_estoque_movimentos_lotes();

-- 5) Carga inicial: o saldo que já existe vira "saldo sem lote" (mantém lotes = ledger) ------------------------------
insert into public.estoque_lotes (loja_id, codigo_local_estoque, codigo_produto, saldo, quantidade_entrada, origem)
select s.loja_id, s.codigo_local_estoque, s.codigo_produto, s.saldo, greatest(s.saldo, 0), 'carga_inicial'
  from public.estoque_saldos s
 where s.saldo <> 0
   and not exists (select 1 from public.estoque_lotes l where l.loja_id = s.loja_id and l.codigo_local_estoque = s.codigo_local_estoque
                     and l.codigo_produto = s.codigo_produto)
on conflict do nothing;

-- 6) Conferência lotes × ledger e correção ---------------------------------------------------------------------------
create or replace view public.estoque_lotes_divergencia with (security_invoker = true) as
  select coalesce(s.loja_id, l.loja_id) as loja_id,
         coalesce(s.codigo_local_estoque, l.codigo_local_estoque) as codigo_local_estoque,
         coalesce(s.codigo_produto, l.codigo_produto) as codigo_produto,
         coalesce(s.saldo, 0) as saldo_ledger, coalesce(l.saldo, 0) as saldo_lotes
    from public.estoque_saldos s
    full join (select loja_id, codigo_local_estoque, codigo_produto, sum(saldo) as saldo
                 from public.estoque_lotes group by 1, 2, 3) l
      on l.loja_id = s.loja_id and l.codigo_local_estoque = s.codigo_local_estoque and l.codigo_produto = s.codigo_produto
   where round(coalesce(s.saldo, 0), 6) <> round(coalesce(l.saldo, 0), 6);
grant select on public.estoque_lotes_divergencia to authenticated, service_role;

-- Acerta a diferença no "saldo sem lote" (nunca mexe em lote com validade). Devolve quantos acertou.
create or replace function public.reconciliar_lotes(p_loja bigint) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v bigint;
begin
  for r in select * from estoque_lotes_divergencia where loja_id = p_loja loop
    v := _lote_sem_lote(r.loja_id, r.codigo_local_estoque, r.codigo_produto);
    update estoque_lotes set saldo = saldo + (r.saldo_ledger - r.saldo_lotes), updated_at = now() where id = v;
    n := n + 1;
  end loop;
  return n;
end $$;

-- 7) Entrada com lote (entrada manual) e baixa de lote (vencimento) --------------------------------------------------
create or replace function public.registrar_entrada_lote(
  p_loja bigint, p_local bigint, p_produto bigint, p_quantidade numeric, p_custo numeric, p_origem text, p_ref text,
  p_lote text default null, p_validade date default null, p_user text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  perform set_config('estoque.lote', coalesce(nullif(btrim(p_lote), ''), ''), true);
  perform set_config('estoque.validade', coalesce(p_validade::text, ''), true);
  r := registrar_movimento(p_loja, p_local, p_produto, 'ENT', p_origem, p_ref, abs(p_quantidade), p_custo, p_user, p_obs);
  perform set_config('estoque.lote', '', true);
  perform set_config('estoque.validade', '', true);
  return r;
end $$;


-- Compra criada e lançada na mesma chamada (compra manual): leva lote/validade de cada item (p_compra.itens[].lote/validade)
-- até o gatilho por um mapa da transação, e grava nos itens para consulta.
create or replace function public.lancar_compra_com_lotes(p_compra jsonb, p_local bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_map jsonb := '{}'::jsonb; d record; r jsonb;
begin
  for d in select value as item, ordinality::int as ord from jsonb_array_elements(coalesce(p_compra->'itens', '[]'::jsonb)) with ordinality loop
    if nullif(btrim(d.item->>'lote'), '') is not null or nullif(d.item->>'validade', '') is not null then
      v_map := v_map || jsonb_build_object(coalesce((d.item->>'linha')::int, d.ord)::text,
                 jsonb_build_object('lote', nullif(btrim(d.item->>'lote'), ''), 'validade', nullif(d.item->>'validade', '')));
    end if;
  end loop;
  perform set_config('estoque.lotes_compra', v_map::text, true);
  r := lancar_compra(p_compra, p_local, p_user);
  perform set_config('estoque.lotes_compra', '', true);
  update compras_proprio_itens i
     set lote = nullif(v_map -> i.linha::text ->> 'lote', ''), validade = nullif(v_map -> i.linha::text ->> 'validade', '')::date
   where i.compra_id = (r->>'compra_id')::bigint and v_map ? i.linha::text;
  return r;
end $$;

-- Baixa por vencimento/perda de UM lote: saída com origem PERDA dirigida àquele lote. Idempotente pela ref.
create or replace function public.baixar_lote(
  p_loja bigint, p_lote_id bigint, p_quantidade numeric, p_motivo text, p_ref text, p_user text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l estoque_lotes%rowtype; r jsonb; v_q numeric;
begin
  select * into l from estoque_lotes where id = p_lote_id and loja_id = p_loja;
  if not found then raise exception 'Lote % não existe nesta loja', p_lote_id using errcode = '22023'; end if;
  if p_motivo is null or length(btrim(p_motivo)) < 3 then raise exception 'Informe o motivo da baixa' using errcode = '22023'; end if;
  v_q := coalesce(p_quantidade, l.saldo);
  if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  if v_q > l.saldo then raise exception 'O lote só tem % em saldo', l.saldo using errcode = '22023'; end if;
  perform set_config('estoque.lote_id', l.id::text, true);
  r := registrar_movimento(p_loja, l.codigo_local_estoque, l.codigo_produto, 'SAI', 'PERDA', p_ref, v_q, null, p_user,
                           'Baixa por vencimento' || coalesce(' · lote ' || l.lote, '') || coalesce(' · val. ' || to_char(l.validade, 'DD/MM/YYYY'), '')
                           || ' · ' || btrim(p_motivo));
  perform set_config('estoque.lote_id', '', true);
  return r;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    '_lote_sem_lote(bigint,bigint,bigint)',
    '_lote_entrar(bigint,bigint,bigint,bigint,numeric,text,date,text,text)',
    '_lote_sair(bigint,bigint,bigint,bigint,numeric,bigint)',
    '_lote_da_entrada(public.estoque_movimentos)',
    'reconciliar_lotes(bigint)',
    'registrar_entrada_lote(bigint,bigint,bigint,numeric,numeric,text,text,text,date,text,text)',
    'baixar_lote(bigint,bigint,numeric,text,text,text)',
    'lancar_compra_com_lotes(jsonb,bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
