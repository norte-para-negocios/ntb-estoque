-- 134 — Inventário (contagem cega), curva ABC e sugestão de compra do Estoque próprio (06/10/2026)
-- Aditiva: só toca lojas em modo 'proprio'. Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 134_inventario_proprio.sql
--
-- REGRA DA CONTAGEM CEGA (documentada e testada em scripts/testes-sql/inventario_proprio.sql):
--   * A tela de contagem nunca recebe o saldo do sistema (a coluna saldo_snapshot não tem SELECT para anon/authenticated).
--   * Cada item contado guarda `contado_em` (o instante da contagem).
--   * ESPERADO na contagem = saldo do local/produto NAQUELE instante = `saldo_apos` do último movimento com created_at <= contado_em
--     (0 se não havia movimento). Vendas/entradas depois da contagem não contaminam a diferença.
--   * DELTA = contado − esperado. Fechar aplica o delta como movimento AJU (ao custo médio, sem alterar o CMC) sobre o saldo ATUAL.
--     Ex.: sistema 10, contou 8 (falta 2), depois venderam 2 -> delta -2 -> saldo 8 - 2 = 6 = estoque físico real agora.
--   * Item não contado não é ajustado. Fechar é idempotente (repetir devolve o mesmo resultado, sem ajustar de novo).
--   * Motivo é obrigatório quando |delta| × CMC passa o limite da loja (estoque_config.limite_motivo_inventario, padrão R$ 50,00).

-- 1) Configuração por loja ----------------------------------------------------------------------------
create table if not exists public.estoque_config (
  loja_id                    bigint primary key references public.lojas(id),
  limite_motivo_inventario   numeric(14,2) not null default 50.00,
  dias_curva_abc             int not null default 90 check (dias_curva_abc between 7 and 730),
  updated_at                 timestamptz not null default now()
);

-- 2) Inventário -----------------------------------------------------------------------------------------
create table if not exists public.inventarios_proprio (
  id                    bigint generated always as identity primary key,
  loja_id               bigint not null references public.lojas(id),
  codigo_local_estoque  bigint not null,
  status                text not null default 'aberto' check (status in ('aberto', 'fechado', 'cancelado')),
  tipo                  text not null default 'geral' check (tipo in ('geral', 'ciclica')),
  classe                text check (classe in ('A', 'B', 'C')),
  descricao             text,
  aberto_por            text,
  aberto_em             timestamptz not null default now(),
  fechado_por           text,
  fechado_em            timestamptz,
  total_itens           int,
  total_contados        int,
  total_ajustes_valor   numeric(18,4),
  obs                   text
);
create index if not exists inventarios_proprio_loja on public.inventarios_proprio (loja_id, aberto_em desc);
-- Um inventário aberto por local.
create unique index if not exists inventarios_proprio_um_aberto on public.inventarios_proprio (loja_id, codigo_local_estoque) where status = 'aberto';

create table if not exists public.inventario_proprio_itens (
  id               bigint generated always as identity primary key,
  inventario_id    bigint not null references public.inventarios_proprio(id) on delete cascade,
  loja_id          bigint not null references public.lojas(id),
  codigo_produto   bigint not null,
  saldo_snapshot   numeric(18,6) not null default 0,   -- sistema na abertura (NUNCA exposto à tela de contagem)
  contado          numeric(18,6) check (contado is null or contado >= 0),
  contado_em       timestamptz,
  contado_por      text,
  motivo           text,
  delta_aplicado   numeric(18,6),
  movimento_id     bigint,
  unique (inventario_id, codigo_produto)
);
create index if not exists inventario_proprio_itens_inv on public.inventario_proprio_itens (inventario_id);

-- 3) RLS e grants (leitura por loja; saldo_snapshot fica de fora = contagem cega de verdade) ------------
do $$ declare t text; begin
  foreach t in array array['estoque_config', 'inventarios_proprio', 'inventario_proprio_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.estoque_config, public.inventarios_proprio to authenticated;
grant select (id, inventario_id, loja_id, codigo_produto, contado, contado_em, contado_por, motivo, delta_aplicado, movimento_id)
  on public.inventario_proprio_itens to authenticated;

-- 4) Esperado no instante da contagem --------------------------------------------------------------------
create or replace function public.estoque_saldo_em(p_loja bigint, p_local bigint, p_produto bigint, p_ate timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select saldo_apos from estoque_movimentos
     where loja_id = p_loja and codigo_local_estoque = p_local and codigo_produto = p_produto and created_at <= p_ate
     order by id desc limit 1), 0)
$$;

-- 5) Curva ABC (valor consumido por saída nos últimos N dias) -----------------------------------------------
create or replace function public.curva_abc(p_loja bigint, p_dias int default null)
returns table (codigo_produto bigint, valor_movimentado numeric, percentual_acumulado numeric, classe text)
language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce(p_dias, (select dias_curva_abc from estoque_config where loja_id = p_loja), 90) as dias),
  base as (
    select m.codigo_produto, sum(abs(m.quantidade) * coalesce(m.custo_unitario, 0)) as v
      from estoque_movimentos m, cfg
     where m.loja_id = p_loja and m.tipo = 'SAI' and m.created_at >= now() - make_interval(days => cfg.dias)
     group by m.codigo_produto
  ),
  rot as (select b.codigo_produto, b.v, sum(b.v) over (order by b.v desc, b.codigo_produto) as acum, sum(b.v) over () as total from base b),
  todos as (
    select pr.codigo_produto, coalesce(r.v, 0) as v, r.acum, r.total
      from produtos pr left join rot r on r.codigo_produto = pr.codigo_produto
     where pr.loja_id = p_loja and coalesce(pr.inativo, false) = false
  )
  select t.codigo_produto, t.v,
         case when t.total > 0 then round(coalesce(t.acum, t.total) / t.total * 100, 2) else 100 end,
         case when t.v <= 0 or t.total is null or t.total <= 0 then 'C'
              when (t.acum - t.v) / t.total < 0.80 then 'A'
              when (t.acum - t.v) / t.total < 0.95 then 'B'
              else 'C' end
    from todos t
$$;

-- 6) Abrir -------------------------------------------------------------------------------------------------
create or replace function public.abrir_inventario(
  p_loja bigint, p_local bigint, p_user text default null, p_tipo text default 'geral', p_classe text default null, p_descricao text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_modo text; v_id bigint; v_n int;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local) then
    raise exception 'Local inexistente' using errcode = '22023';
  end if;
  if p_tipo = 'ciclica' and p_classe is null then raise exception 'Contagem cíclica exige a classe (A, B ou C)' using errcode = '22023'; end if;
  begin
    insert into inventarios_proprio (loja_id, codigo_local_estoque, tipo, classe, descricao, aberto_por)
    values (p_loja, p_local, coalesce(p_tipo, 'geral'), case when p_tipo = 'ciclica' then p_classe end, p_descricao, p_user)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe um inventário aberto neste local' using errcode = '23505';
  end;
  -- Itens: tudo que o sistema acredita haver no local (saldo <> 0). Em contagem cíclica, só os da classe.
  insert into inventario_proprio_itens (inventario_id, loja_id, codigo_produto, saldo_snapshot)
  select v_id, p_loja, s.codigo_produto, s.saldo
    from estoque_saldos s
    join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto and coalesce(pr.inativo, false) = false
   where s.loja_id = p_loja and s.codigo_local_estoque = p_local and s.saldo <> 0
     and (p_tipo is distinct from 'ciclica' or exists (select 1 from curva_abc(p_loja) c where c.codigo_produto = s.codigo_produto and c.classe = p_classe));
  get diagnostics v_n = row_count;
  update inventarios_proprio set total_itens = v_n where id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'itens', v_n);
end $$;

-- 7) Contar (cego: devolve só ok, nunca o saldo) --------------------------------------------------------------
create or replace function public.contar_item(
  p_inventario bigint, p_produto bigint, p_contado numeric, p_user text default null, p_motivo text default null, p_em timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare inv inventarios_proprio%rowtype; v_saldo numeric;
begin
  select * into inv from inventarios_proprio where id = p_inventario for share;
  if not found then raise exception 'Inventário inexistente' using errcode = '22023'; end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário não está aberto' using errcode = '55000'; end if;
  if p_contado is null or p_contado < 0 then raise exception 'Quantidade contada inválida' using errcode = '22023'; end if;
  if not exists (select 1 from produtos where loja_id = inv.loja_id and codigo_produto = p_produto) then
    raise exception 'Produto inexistente' using errcode = '22023';
  end if;
  select coalesce((select saldo from estoque_saldos where loja_id = inv.loja_id and codigo_local_estoque = inv.codigo_local_estoque and codigo_produto = p_produto), 0) into v_saldo;
  insert into inventario_proprio_itens (inventario_id, loja_id, codigo_produto, saldo_snapshot, contado, contado_em, contado_por, motivo)
  values (p_inventario, inv.loja_id, p_produto, v_saldo, p_contado, coalesce(p_em, clock_timestamp()), p_user, nullif(btrim(p_motivo), ''))
  on conflict (inventario_id, codigo_produto) do update
    set contado = excluded.contado, contado_em = excluded.contado_em, contado_por = excluded.contado_por,
        motivo = coalesce(nullif(btrim(p_motivo), ''), inventario_proprio_itens.motivo);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.motivo_item_inventario(p_inventario bigint, p_produto bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update inventario_proprio_itens set motivo = nullif(btrim(p_motivo), '')
   where inventario_id = p_inventario and codigo_produto = p_produto
     and exists (select 1 from inventarios_proprio i where i.id = p_inventario and i.status = 'aberto');
  if not found then raise exception 'Item não encontrado em inventário aberto' using errcode = '22023'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 8) Variância (revisão antes de fechar; só o gerente vê o esperado) --------------------------------------------
create or replace function public.inventario_variancia(p_inventario bigint)
returns table (codigo_produto bigint, saldo_snapshot numeric, esperado numeric, contado numeric, contado_em timestamptz,
               delta numeric, cmc numeric, valor_delta numeric, motivo text, exige_motivo boolean)
language sql stable security definer set search_path = public as $$
  with inv as (select i.* from inventarios_proprio i where i.id = p_inventario),
  lim as (select coalesce((select limite_motivo_inventario from estoque_config c where c.loja_id = (select loja_id from inv)), 50.00) as v)
  select it.codigo_produto, it.saldo_snapshot,
         estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em) as esperado,
         it.contado, it.contado_em,
         it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em) as delta,
         coalesce(c.cmc, 0),
         round((it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em)) * coalesce(c.cmc, 0), 4),
         it.motivo,
         abs((it.contado - estoque_saldo_em(it.loja_id, (select codigo_local_estoque from inv), it.codigo_produto, it.contado_em)) * coalesce(c.cmc, 0)) > (select v from lim)
    from inventario_proprio_itens it
    left join estoque_custos c on c.loja_id = it.loja_id and c.codigo_produto = it.codigo_produto
   where it.inventario_id = p_inventario and it.contado is not null
$$;

-- 9) Fechar (idempotente) ---------------------------------------------------------------------------------------
create or replace function public.fechar_inventario(p_inventario bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  inv inventarios_proprio%rowtype; v record; n_ajustes int := 0; n_contados int := 0; v_valor numeric := 0; v_sem_motivo int; r jsonb;
begin
  select * into inv from inventarios_proprio where id = p_inventario for update;
  if not found then raise exception 'Inventário inexistente' using errcode = '22023'; end if;
  if inv.status = 'fechado' then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ajustes', inv.total_contados, 'valor_ajustes', inv.total_ajustes_valor);
  end if;
  if inv.status <> 'aberto' then raise exception 'Este inventário não está aberto' using errcode = '55000'; end if;

  select count(*) into v_sem_motivo from inventario_variancia(p_inventario) x where x.delta <> 0 and x.exige_motivo and (x.motivo is null or btrim(x.motivo) = '');
  if v_sem_motivo > 0 then
    raise exception 'Faltam motivos em % item(ns) com diferença acima do limite', v_sem_motivo using errcode = '23514';
  end if;

  -- Ordem fixa por produto (evita deadlock com vendas em paralelo).
  for v in select * from inventario_variancia(p_inventario) order by codigo_produto loop
    n_contados := n_contados + 1;
    if v.delta <> 0 then
      r := registrar_movimento(inv.loja_id, inv.codigo_local_estoque, v.codigo_produto, 'AJU', 'INVENTARIO', 'inv-' || inv.id,
                               v.delta, null, p_user, 'Inventário #' || inv.id || coalesce(' — ' || nullif(btrim(v.motivo), ''), ''), 0, null, null, null);
      update inventario_proprio_itens set delta_aplicado = v.delta, movimento_id = (r->>'id')::bigint
       where inventario_id = inv.id and codigo_produto = v.codigo_produto;
      n_ajustes := n_ajustes + 1;
      v_valor := v_valor + v.valor_delta;
    else
      update inventario_proprio_itens set delta_aplicado = 0 where inventario_id = inv.id and codigo_produto = v.codigo_produto;
    end if;
  end loop;

  update inventarios_proprio set status = 'fechado', fechado_por = p_user, fechado_em = now(),
         total_contados = n_contados, total_ajustes_valor = v_valor
   where id = inv.id;
  return jsonb_build_object('ok', true, 'duplicado', false, 'contados', n_contados, 'ajustes', n_ajustes, 'valor_ajustes', v_valor);
end $$;

create or replace function public.cancelar_inventario(p_inventario bigint, p_user text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update inventarios_proprio set status = 'cancelado', fechado_por = p_user, fechado_em = now()
   where id = p_inventario and status = 'aberto';
  if not found then raise exception 'Inventário não está aberto' using errcode = '55000'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- 10) Reposição: mínimo (por local) − saldo, com família ------------------------------------------------------------
create or replace view public.sugestao_compra with (security_invoker = true) as
  select s.loja_id, s.codigo_local_estoque, s.codigo_produto, pr.codigo, pr.descricao, pr.unidade,
         pr.codigo_familia, coalesce(f.nome, 'Sem família') as familia,
         s.saldo, s.minimo, (s.minimo - s.saldo) as falta,
         coalesce(c.cmc, 0) as cmc, c.ultimo_custo,
         round((s.minimo - s.saldo) * coalesce(c.ultimo_custo, c.cmc, 0), 2) as valor_estimado
    from estoque_saldos s
    join produtos pr on pr.loja_id = s.loja_id and pr.codigo_produto = s.codigo_produto and coalesce(pr.inativo, false) = false
    left join familias f on f.loja_id = pr.loja_id and f.codigo_familia = pr.codigo_familia
    left join estoque_custos c on c.loja_id = s.loja_id and c.codigo_produto = s.codigo_produto
   where s.minimo is not null and s.minimo > 0 and s.saldo < s.minimo;
grant select on public.sugestao_compra to authenticated, service_role;

-- 11) Só o servidor chama as funções que escrevem ou expõem o esperado -----------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'estoque_saldo_em(bigint,bigint,bigint,timestamptz)',
    'curva_abc(bigint,int)',
    'abrir_inventario(bigint,bigint,text,text,text,text)',
    'contar_item(bigint,bigint,numeric,text,text,timestamptz)',
    'motivo_item_inventario(bigint,bigint,text)',
    'inventario_variancia(bigint)',
    'fechar_inventario(bigint,text)',
    'cancelar_inventario(bigint,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
