-- 132 — Modo de estoque por loja + ledger próprio (Estoque próprio, 06/10/2026)
-- Aditivo: lojas existentes ficam em 'omie' e nada muda para elas.
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 132_modo_estoque_e_ledger.sql

-- 1) Modo da loja -------------------------------------------------------------------------------
alter table public.lojas add column if not exists modo_estoque text not null default 'omie';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'lojas_modo_estoque_chk') then
    alter table public.lojas add constraint lojas_modo_estoque_chk check (modo_estoque in ('omie', 'proprio', 'nenhum'));
  end if;
end $$;
grant select (modo_estoque) on public.lojas to anon, authenticated;

-- Depois do primeiro movimento a loja não troca mais de modo.
create or replace function public.trg_lojas_modo_estoque() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.modo_estoque is distinct from old.modo_estoque
     and exists (select 1 from estoque_movimentos where loja_id = old.id) then
    raise exception 'A loja já tem movimentos de estoque próprio: o modo não pode mais ser trocado' using errcode = '23514';
  end if;
  return new;
end $$;

-- 2) Tabelas do ledger ----------------------------------------------------------------------------
create table if not exists public.estoque_custos (
  loja_id        bigint not null references public.lojas(id),
  codigo_produto bigint not null,
  cmc            numeric(18,6) not null default 0,
  ultimo_custo   numeric(18,6),
  saldo_total    numeric(18,6) not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (loja_id, codigo_produto)
);

create table if not exists public.estoque_saldos (
  loja_id              bigint not null references public.lojas(id),
  codigo_local_estoque bigint not null,
  codigo_produto       bigint not null,
  saldo                numeric(18,6) not null default 0,
  minimo               numeric(18,6),
  updated_at           timestamptz not null default now(),
  primary key (loja_id, codigo_local_estoque, codigo_produto)
);
create index if not exists estoque_saldos_produto on public.estoque_saldos (loja_id, codigo_produto);

create table if not exists public.estoque_movimentos (
  id                   bigint generated always as identity primary key,
  loja_id              bigint not null references public.lojas(id),
  codigo_local_estoque bigint not null,
  codigo_produto       bigint not null,
  tipo                 text not null check (tipo in ('ENT', 'SAI', 'AJU', 'TRF', 'PRD', 'EST')),
  origem               text not null,
  ref                  text not null,
  linha                int  not null default 0,
  quantidade           numeric(18,6) not null check (quantidade <> 0),  -- com sinal
  custo_unitario       numeric(18,6),
  saldo_apos           numeric(18,6) not null,
  saldo_total_apos     numeric(18,6) not null,
  cmc_apos             numeric(18,6),
  custo_estimado       boolean not null default false,
  reverses_id          bigint unique references public.estoque_movimentos(id),
  transferencia_ref    text,
  user_id              text,
  obs                  text,
  data_ref             date not null default current_date,
  created_at           timestamptz not null default now(),
  unique (loja_id, origem, ref, codigo_produto, codigo_local_estoque, linha)
);
create index if not exists estoque_movimentos_produto on public.estoque_movimentos (loja_id, codigo_produto, created_at desc);
create index if not exists estoque_movimentos_local   on public.estoque_movimentos (loja_id, codigo_local_estoque, created_at desc);
create index if not exists estoque_movimentos_data    on public.estoque_movimentos (loja_id, data_ref);

-- Append-only: nunca UPDATE nem DELETE. Correção = movimento de estorno.
create or replace function public.trg_estoque_movimentos_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'estoque_movimentos é append-only: use estorno' using errcode = '55000';
end $$;
drop trigger if exists estoque_movimentos_imutavel on public.estoque_movimentos;
create trigger estoque_movimentos_imutavel before update or delete on public.estoque_movimentos
  for each row execute function public.trg_estoque_movimentos_imutavel();

drop trigger if exists lojas_modo_estoque on public.lojas;
create trigger lojas_modo_estoque before update of modo_estoque on public.lojas
  for each row execute function public.trg_lojas_modo_estoque();

-- 3) RLS e grants ---------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['estoque_custos', 'estoque_saldos', 'estoque_movimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- 4) IDs e códigos próprios -------------------------------------------------------------------------
create sequence if not exists public.seq_id_produto_proprio start 8000000000001;
create sequence if not exists public.seq_id_local_proprio   start 8000000000001;

create table if not exists public.estoque_codigo_seq (
  loja_id bigint not null references public.lojas(id),
  prefixo text   not null,
  ultimo  int    not null default 0,
  primary key (loja_id, prefixo)
);
alter table public.estoque_codigo_seq enable row level security;
revoke all on public.estoque_codigo_seq from anon, authenticated;
grant all on public.estoque_codigo_seq to service_role;

create or replace function public.novo_id_produto_proprio() returns bigint
language sql security definer set search_path = public as $$ select nextval('public.seq_id_produto_proprio') $$;
create or replace function public.novo_id_local_proprio() returns bigint
language sql security definer set search_path = public as $$ select nextval('public.seq_id_local_proprio') $$;

-- Prefixo pelo tipo do item (SPED), mesmo padrão do Omie do Sertão.
create or replace function public.prefixo_codigo_por_tipo(p_tipo_item text) returns text
language sql immutable as $$
  select case coalesce(p_tipo_item, '04')
    when '04' then '90' when '00' then '90'
    when '01' then '80'
    when '03' then '70' when '06' then '70' when '05' then '70'
    when '07' then '60' when '10' then '60'
    else '50' end
$$;

create or replace function public.proximo_codigo_produto(p_loja bigint, p_tipo_item text) returns text
language plpgsql security definer set search_path = public as $$
declare v_pref text := prefixo_codigo_por_tipo(p_tipo_item); v_n int; v_cod text;
begin
  loop
    insert into estoque_codigo_seq (loja_id, prefixo, ultimo) values (p_loja, v_pref, 1)
      on conflict (loja_id, prefixo) do update set ultimo = estoque_codigo_seq.ultimo + 1
      returning ultimo into v_n;
    v_cod := v_pref || lpad(v_n::text, 3, '0');
    exit when not exists (select 1 from produtos where loja_id = p_loja and codigo = v_cod);
  end loop;
  return v_cod;
end $$;

-- Código único e imutável por loja em modo 'proprio'.
create or replace function public.trg_produtos_codigo_proprio() returns trigger
language plpgsql set search_path = public as $$
declare v_modo text;
begin
  select modo_estoque into v_modo from lojas where id = new.loja_id;
  if v_modo is distinct from 'proprio' then return new; end if;
  if new.codigo is null or btrim(new.codigo) = '' then
    raise exception 'Produto sem código' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.codigo is distinct from old.codigo then
    raise exception 'O código do produto não pode ser alterado' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and exists (select 1 from produtos where loja_id = new.loja_id and codigo = new.codigo) then
    raise exception 'Código % já existe nesta loja', new.codigo using errcode = '23505';
  end if;
  return new;
end $$;
drop trigger if exists produtos_codigo_proprio on public.produtos;
create trigger produtos_codigo_proprio before insert or update of codigo on public.produtos
  for each row execute function public.trg_produtos_codigo_proprio();

-- 5) Movimento atômico ------------------------------------------------------------------------------
create or replace function public.registrar_movimento(
  p_loja bigint, p_local bigint, p_produto bigint, p_tipo text, p_origem text, p_ref text,
  p_quantidade numeric, p_custo numeric default null, p_user text default null, p_obs text default null,
  p_linha int default 0, p_reverses bigint default null, p_transferencia_ref text default null,
  p_data date default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_delta numeric; v_custos estoque_custos%rowtype; v_saldo_ant numeric; v_saldo_novo numeric;
  v_total_novo numeric; v_cmc_novo numeric; v_custo_mov numeric; v_estimado boolean := false;
  v_exist estoque_movimentos%rowtype; v_id bigint; v_cons text;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then
    raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023';
  end if;
  if p_tipo not in ('ENT', 'SAI', 'AJU', 'TRF', 'PRD', 'EST') then
    raise exception 'Tipo de movimento inválido: %', p_tipo using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade = 0 then
    raise exception 'Quantidade zero ou ausente' using errcode = '22023';
  end if;
  if p_origem is null or p_ref is null then
    raise exception 'origem e ref são obrigatórios (idempotência)' using errcode = '22023';
  end if;

  select * into v_exist from estoque_movimentos
   where loja_id = p_loja and origem = p_origem and ref = p_ref
     and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end if;

  v_delta := case p_tipo when 'ENT' then abs(p_quantidade) when 'SAI' then -abs(p_quantidade) else p_quantidade end;

  -- Trava SEMPRE na mesma ordem: custo do produto, depois saldo do local (evita deadlock).
  insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p_produto) on conflict do nothing;
  select * into v_custos from estoque_custos where loja_id = p_loja and codigo_produto = p_produto for update;
  insert into estoque_saldos (loja_id, codigo_local_estoque, codigo_produto) values (p_loja, p_local, p_produto) on conflict do nothing;
  select saldo into v_saldo_ant from estoque_saldos
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto for update;

  if p_tipo = 'TRF' then
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- transferência não muda custo
  elsif v_delta > 0 then
    if p_custo is not null and p_custo > 0 then
      v_custo_mov := p_custo;
      if v_custos.saldo_total <= 0 then v_cmc_novo := p_custo;               -- saldo negativo/zero: o custo da entrada assume
      else v_cmc_novo := round((v_custos.saldo_total * v_custos.cmc + v_delta * p_custo) / (v_custos.saldo_total + v_delta), 6);
      end if;
    else
      v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc; v_estimado := true;  -- sem custo: não dilui nem zera o CMC
    end if;
  else
    v_custo_mov := v_custos.cmc; v_cmc_novo := v_custos.cmc;                 -- saída ao CMC vigente (não recalcula)
  end if;

  v_saldo_novo := v_saldo_ant + v_delta;
  v_total_novo := v_custos.saldo_total + v_delta;

  begin
    insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade,
        custo_unitario, saldo_apos, saldo_total_apos, cmc_apos, custo_estimado, reverses_id, transferencia_ref, user_id, obs, data_ref)
    values (p_loja, p_local, p_produto, p_tipo, p_origem, p_ref, p_linha, v_delta,
        v_custo_mov, v_saldo_novo, v_total_novo, v_cmc_novo, v_estimado, p_reverses, p_transferencia_ref, p_user, p_obs,
        coalesce(p_data, (now() at time zone 'America/Sao_Paulo')::date))
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_cons = constraint_name;
    if v_cons like '%reverses_id%' then
      raise exception 'Este movimento já foi estornado' using errcode = '23505';
    end if;
    select * into v_exist from estoque_movimentos
     where loja_id = p_loja and origem = p_origem and ref = p_ref
       and codigo_produto = p_produto and codigo_local_estoque = p_local and linha = p_linha;
    return jsonb_build_object('ok', true, 'duplicado', true, 'id', v_exist.id, 'saldo', v_exist.saldo_apos, 'cmc', v_exist.cmc_apos);
  end;

  update estoque_saldos set saldo = v_saldo_novo, updated_at = now()
   where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto;
  update estoque_custos set cmc = v_cmc_novo, saldo_total = v_total_novo,
         ultimo_custo = case when p_custo is not null and p_custo > 0 and v_delta > 0 and p_tipo <> 'TRF' then p_custo else ultimo_custo end,
         updated_at = now()
   where loja_id = p_loja and codigo_produto = p_produto;

  -- Projeção para os relatórios atuais (posição do dia).
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select p_loja, p_local, p_produto, (now() at time zone 'America/Sao_Paulo')::date, pr.codigo, pr.descricao,
         v_saldo_novo, v_saldo_novo, v_cmc_novo, pr.estoque_minimo
    from (select 1) x left join produtos pr on pr.loja_id = p_loja and pr.codigo_produto = p_produto
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
  do update set n_saldo = excluded.n_saldo, fisico = excluded.fisico, n_cmc = excluded.n_cmc, updated_at = now();

  return jsonb_build_object('ok', true, 'duplicado', false, 'id', v_id, 'saldo', v_saldo_novo, 'saldo_total', v_total_novo,
                            'cmc', v_cmc_novo, 'negativo', v_saldo_novo < 0, 'custo_estimado', v_estimado);
end $$;

-- Estorno: movimento inverso ao custo original, nunca apaga nada.
create or replace function public.estornar_movimento(p_id bigint, p_user text default null, p_obs text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m estoque_movimentos%rowtype;
begin
  select * into m from estoque_movimentos where id = p_id;
  if not found then raise exception 'Movimento % não existe', p_id using errcode = '22023'; end if;
  if m.tipo = 'EST' or m.reverses_id is not null then raise exception 'Estorno não se estorna' using errcode = '22023'; end if;
  return registrar_movimento(m.loja_id, m.codigo_local_estoque, m.codigo_produto, 'EST', 'ESTORNO', 'mov:' || m.id,
                             -m.quantidade, m.custo_unitario, p_user, coalesce(p_obs, 'Estorno do movimento ' || m.id),
                             0, m.id, m.transferencia_ref, null);
end $$;

-- Transferência entre locais: duas pernas na mesma transação, custo inalterado.
create or replace function public.transferir_estoque(
  p_loja bigint, p_de bigint, p_para bigint, p_produto bigint, p_quantidade numeric, p_ref text,
  p_user text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a jsonb; b jsonb;
begin
  if p_de = p_para then raise exception 'Origem e destino iguais' using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  a := registrar_movimento(p_loja, p_de,   p_produto, 'TRF', 'TRANSFERENCIA', p_ref, -abs(p_quantidade), null, p_user, p_obs, 0, null, p_ref, null);
  b := registrar_movimento(p_loja, p_para, p_produto, 'TRF', 'TRANSFERENCIA', p_ref,  abs(p_quantidade), null, p_user, p_obs, 1, null, p_ref, null);
  return jsonb_build_object('ok', true, 'saida', a, 'entrada', b);
end $$;

-- Carrega os saldos de hoje na posição diária (cron noturno, para os relatórios acharem todos os itens).
create or replace function public.projetar_posicao_dia(p_loja bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, c_codigo, c_descricao, n_saldo, fisico, n_cmc, estoque_minimo)
  select s.loja_id, s.codigo_local_estoque, s.codigo_produto, (now() at time zone 'America/Sao_Paulo')::date,
         pr.codigo, pr.descricao, s.saldo, s.saldo, c.cmc, coalesce(s.minimo, pr.estoque_minimo)
    from estoque_saldos s
    left join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto
    left join estoque_custos c on c.loja_id = s.loja_id and c.codigo_produto = s.codigo_produto
   where s.loja_id = p_loja
  on conflict (loja_id, codigo_local_estoque, n_cod_prod, data_posicao) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Painel de itens negativos.
create or replace view public.estoque_negativos with (security_invoker = true) as
  select s.loja_id, s.codigo_local_estoque, s.codigo_produto, s.saldo, pr.codigo, pr.descricao, pr.unidade
    from estoque_saldos s
    left join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto
   where s.saldo < 0;
grant select on public.estoque_negativos to authenticated, service_role;

-- Só o servidor (service_role) chama as funções que escrevem.
do $$ declare f text; begin
  foreach f in array array[
    'registrar_movimento(bigint,bigint,bigint,text,text,text,numeric,numeric,text,text,int,bigint,text,date)',
    'estornar_movimento(bigint,text,text)',
    'transferir_estoque(bigint,bigint,bigint,bigint,numeric,text,text,text)',
    'projetar_posicao_dia(bigint)',
    'proximo_codigo_produto(bigint,text)',
    'novo_id_produto_proprio()', 'novo_id_local_proprio()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
