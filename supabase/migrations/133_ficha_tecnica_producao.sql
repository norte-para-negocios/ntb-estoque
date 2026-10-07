-- 133 — Fichas técnicas (receitas), produção e consumo por receita no Estoque próprio (Fase 2, 06/10/2026)
-- Aditivo: só lojas com modo_estoque='proprio' usam estas tabelas/funções (as funções recusam outras lojas).
-- Aplicar: docker exec -i supabase-db psql -U supabase_admin -d postgres < 133_ficha_tecnica_producao.sql
--
-- Regras:
--  * Quantidades SEMPRE na unidade base do produto (g, ml, un). A ficha diz quanto de insumo rende `rendimento` do produto.
--  * quantidade_bruta = líquida × fator de correção × (1 + perda%/100). É o que sai do estoque.
--  * Ficha é versionada: editar = nova versão ativa, a anterior fica (histórico). Itens são imutáveis.
--  * Sub-receita: insumo que tem ficha ativa com `expandir_na_venda = true` é aberto até os insumos finais na venda/produção;
--    com false (padrão) é consumido do estoque como produto pronto (ex.: molho produzido em lote).
--  * Ciclo (A usa B que usa A) é recusado ao gravar o item.

-- 1) Tabelas ----------------------------------------------------------------------------------------
create table if not exists public.fichas_tecnicas (
  id                 bigint generated always as identity primary key,
  loja_id            bigint not null references public.lojas(id),
  codigo_produto     bigint not null,
  versao             int    not null,
  rendimento         numeric(18,6) not null check (rendimento > 0),
  expandir_na_venda  boolean not null default false,
  ativa              boolean not null default true,
  obs                text,
  criada_por         text,
  created_at         timestamptz not null default now(),
  foreign key (codigo_produto, loja_id) references public.produtos (codigo_produto, loja_id),
  unique (loja_id, codigo_produto, versao)
);
create unique index if not exists fichas_tecnicas_uma_ativa on public.fichas_tecnicas (loja_id, codigo_produto) where ativa;

create table if not exists public.ficha_tecnica_itens (
  id                bigint generated always as identity primary key,
  ficha_id          bigint not null references public.fichas_tecnicas(id),
  loja_id           bigint not null,
  codigo_insumo     bigint not null,
  quantidade_liquida numeric(18,6) not null check (quantidade_liquida > 0),
  fator_correcao    numeric(9,4)  not null default 1 check (fator_correcao > 0),
  perda_pct         numeric(6,3)  not null default 0 check (perda_pct >= 0 and perda_pct <= 100),
  quantidade_bruta  numeric(18,6) generated always as (round(quantidade_liquida * fator_correcao * (1 + perda_pct / 100), 6)) stored,
  ordem             int not null default 0,
  foreign key (codigo_insumo, loja_id) references public.produtos (codigo_produto, loja_id),
  unique (ficha_id, codigo_insumo)
);
create index if not exists ficha_tecnica_itens_insumo on public.ficha_tecnica_itens (loja_id, codigo_insumo);

create table if not exists public.ordens_producao_proprio (
  id                 bigint generated always as identity primary key,
  loja_id            bigint not null references public.lojas(id),
  ref                text not null,
  codigo_produto     bigint not null,
  ficha_id           bigint not null references public.fichas_tecnicas(id),
  quantidade         numeric(18,6) not null check (quantidade > 0),
  local_consumo      bigint not null,
  local_destino      bigint not null,
  custo_total        numeric(18,6) not null default 0,
  custo_unitario     numeric(18,6) not null default 0,
  status             text not null default 'concluida',
  user_id            text,
  obs                text,
  created_at         timestamptz not null default now(),
  unique (loja_id, ref)
);

create table if not exists public.ordens_producao_proprio_itens (
  id                 bigint generated always as identity primary key,
  ordem_id           bigint not null references public.ordens_producao_proprio(id),
  codigo_insumo      bigint not null,
  quantidade         numeric(18,6) not null,
  custo_unitario     numeric(18,6) not null default 0,
  movimento_id       bigint
);

-- Liga cada movimento de consumo por receita à ficha/versão usada (estoque_movimentos continua imutável).
create table if not exists public.estoque_receita_consumos (
  movimento_id       bigint primary key references public.estoque_movimentos(id),
  loja_id            bigint not null,
  ficha_id           bigint not null references public.fichas_tecnicas(id),
  versao             int not null,
  produto_vendido    bigint not null,
  quantidade_vendida numeric(18,6) not null,
  created_at         timestamptz not null default now()
);
create index if not exists estoque_receita_consumos_ficha on public.estoque_receita_consumos (ficha_id);

-- 2) Imutabilidade dos itens e proteção contra ciclo ---------------------------------------------------
create or replace function public.trg_ficha_itens_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'Itens de ficha técnica são imutáveis: grave uma nova versão' using errcode = '55000';
end $$;
drop trigger if exists ficha_itens_imutavel on public.ficha_tecnica_itens;
create trigger ficha_itens_imutavel before update or delete on public.ficha_tecnica_itens
  for each row execute function public.trg_ficha_itens_imutavel();

-- Existe caminho do insumo de volta ao produto (usando as fichas ATIVAS)? Então gravar o item criaria ciclo.
create or replace function public.ficha_tem_ciclo(p_loja bigint, p_produto bigint, p_insumo bigint) returns boolean
language sql stable set search_path = public as $$
  with recursive descendentes(codigo_produto, nivel) as (
    select p_insumo, 0
    union
    select i.codigo_insumo, d.nivel + 1
      from descendentes d
      join fichas_tecnicas f on f.loja_id = p_loja and f.codigo_produto = d.codigo_produto and f.ativa
      join ficha_tecnica_itens i on i.ficha_id = f.id
     where d.nivel < 12
  )
  select exists (select 1 from descendentes where codigo_produto = p_produto)
$$;

create or replace function public.trg_ficha_itens_ciclo() returns trigger
language plpgsql set search_path = public as $$
declare v_produto bigint;
begin
  select codigo_produto into v_produto from fichas_tecnicas where id = new.ficha_id;
  if new.codigo_insumo = v_produto or ficha_tem_ciclo(new.loja_id, v_produto, new.codigo_insumo) then
    raise exception 'Receita circular: o insumo % já usa este produto', new.codigo_insumo using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists ficha_itens_ciclo on public.ficha_tecnica_itens;
create trigger ficha_itens_ciclo before insert on public.ficha_tecnica_itens
  for each row execute function public.trg_ficha_itens_ciclo();

-- 3) RLS e grants ----------------------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['fichas_tecnicas', 'ficha_tecnica_itens', 'ordens_producao_proprio', 'estoque_receita_consumos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  -- itens da ordem: acesso por loja da ordem
  alter table public.ordens_producao_proprio_itens enable row level security;
  drop policy if exists ordens_producao_proprio_itens_select on public.ordens_producao_proprio_itens;
  create policy ordens_producao_proprio_itens_select on public.ordens_producao_proprio_itens for select using (
    exists (select 1 from public.ordens_producao_proprio o where o.id = ordem_id and (usuario_tem_acesso_loja(o.loja_id) or usuario_e_admin())));
  revoke all on public.ordens_producao_proprio_itens from anon, authenticated;
  grant select on public.ordens_producao_proprio_itens to authenticated;
  grant all on public.ordens_producao_proprio_itens to service_role;
end $$;

-- 4) Salvar ficha (nova versão, atômica) ------------------------------------------------------------------
-- p_itens: [{"codigo_insumo": 123, "quantidade_liquida": 2.5, "fator_correcao": 1.15, "perda_pct": 0}, ...]
create or replace function public.salvar_ficha(
  p_loja bigint, p_produto bigint, p_rendimento numeric, p_itens jsonb,
  p_expandir_na_venda boolean default false, p_user text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_modo text; v_versao int; v_id bigint; v_item jsonb; v_ordem int := 0;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_rendimento is null or p_rendimento <= 0 then raise exception 'Rendimento deve ser maior que zero' using errcode = '22023'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'A ficha precisa de pelo menos um insumo' using errcode = '22023';
  end if;
  if not exists (select 1 from produtos where loja_id = p_loja and codigo_produto = p_produto) then
    raise exception 'Produto % não existe nesta loja', p_produto using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('ficha:' || p_loja || ':' || p_produto));
  update fichas_tecnicas set ativa = false where loja_id = p_loja and codigo_produto = p_produto and ativa;
  select coalesce(max(versao), 0) + 1 into v_versao from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto;
  insert into fichas_tecnicas (loja_id, codigo_produto, versao, rendimento, expandir_na_venda, ativa, obs, criada_por)
  values (p_loja, p_produto, v_versao, p_rendimento, coalesce(p_expandir_na_venda, false), true, p_obs, p_user)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_ordem := v_ordem + 1;
    insert into ficha_tecnica_itens (ficha_id, loja_id, codigo_insumo, quantidade_liquida, fator_correcao, perda_pct, ordem)
    values (v_id, p_loja, (v_item ->> 'codigo_insumo')::bigint, (v_item ->> 'quantidade_liquida')::numeric,
            coalesce((v_item ->> 'fator_correcao')::numeric, 1), coalesce((v_item ->> 'perda_pct')::numeric, 0), v_ordem);
  end loop;
  return jsonb_build_object('ok', true, 'ficha_id', v_id, 'versao', v_versao);
end $$;

-- Desativa a ficha (o produto volta a baixar a si mesmo na venda). A versão fica no histórico.
create or replace function public.desativar_ficha(p_loja bigint, p_produto bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update fichas_tecnicas set ativa = false where loja_id = p_loja and codigo_produto = p_produto and ativa;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'desativadas', n);
end $$;

-- 5) Expansão de receita (sub-receitas, ciclo e profundidade protegidos) -----------------------------------
-- Devolve os insumos FINAIS (somados por insumo) para `p_quantidade` do produto, e a ficha do topo.
create or replace function public._expandir_receita(
  p_loja bigint, p_produto bigint, p_quantidade numeric, p_nivel int, p_caminho bigint[]
) returns table (codigo_insumo bigint, quantidade numeric)
language plpgsql stable set search_path = public as $$
declare f fichas_tecnicas%rowtype; i record; filha fichas_tecnicas%rowtype; fator numeric;
begin
  if p_nivel > 10 then raise exception 'Receita com profundidade excessiva (ciclo?)' using errcode = '23514'; end if;
  select * into f from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then return; end if;
  fator := p_quantidade / f.rendimento;
  for i in select * from ficha_tecnica_itens where ficha_id = f.id order by ordem loop
    if i.codigo_insumo = any (p_caminho) then raise exception 'Receita circular em %', i.codigo_insumo using errcode = '23514'; end if;
    select * into filha from fichas_tecnicas where loja_id = p_loja and codigo_produto = i.codigo_insumo and ativa and expandir_na_venda;
    if found then
      return query select * from _expandir_receita(p_loja, i.codigo_insumo, i.quantidade_bruta * fator, p_nivel + 1, p_caminho || i.codigo_insumo);
    else
      codigo_insumo := i.codigo_insumo; quantidade := i.quantidade_bruta * fator; return next;
    end if;
  end loop;
end $$;

create or replace function public.expandir_receita(p_loja bigint, p_produto bigint, p_quantidade numeric) returns table (codigo_insumo bigint, quantidade numeric)
language sql stable set search_path = public as $$
  select e.codigo_insumo, round(sum(e.quantidade), 6)
    from _expandir_receita(p_loja, p_produto, p_quantidade, 0, array[p_produto]) e
   group by e.codigo_insumo
   order by e.codigo_insumo
$$;

-- Custo de uma unidade do produto pela receita ativa (insumos ao CMC atual; sub-receita expandida recursivamente).
create or replace function public.custo_unitario_ficha(p_loja bigint, p_produto bigint) returns numeric
language sql stable set search_path = public as $$
  select case when count(*) = 0 then null else round(sum(e.quantidade * coalesce(c.cmc, 0)), 6) end
    from expandir_receita(p_loja, p_produto, 1) e
    left join estoque_custos c on c.loja_id = p_loja and c.codigo_produto = e.codigo_insumo
$$;

-- 6) Trava de custos em ordem fixa (evita deadlock entre venda por receita e produção) ---------------------
create or replace function public._travar_custos(p_loja bigint, p_produtos bigint[]) returns void
language plpgsql set search_path = public as $$
declare p bigint;
begin
  for p in select distinct x from unnest(p_produtos) x order by x loop
    insert into estoque_custos (loja_id, codigo_produto) values (p_loja, p) on conflict do nothing;
    perform 1 from estoque_custos where loja_id = p_loja and codigo_produto = p for update;
  end loop;
end $$;

-- 7) Consumo por receita (usado na venda) -----------------------------------------------------------------
-- Idempotente por (ref, produto vendido, linha_base). Produto sem ficha ativa => {"tem_receita": false} e NADA é gravado
-- (quem chama baixa o próprio produto).
create or replace function public.consumo_por_receita(
  p_loja bigint, p_produto bigint, p_quantidade numeric, p_local bigint, p_ref text,
  p_user text default null, p_linha_base int default 0, p_origem text default 'VENDA'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ref text; r record; v_res jsonb; v_itens jsonb := '[]'::jsonb;
  v_negativo boolean := false; v_ids bigint[];
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade inválida' using errcode = '22023'; end if;
  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then return jsonb_build_object('ok', true, 'tem_receita', false); end if;

  v_ref := p_ref || '|' || p_produto || '|' || p_linha_base;
  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  if v_ids is null then return jsonb_build_object('ok', true, 'tem_receita', false); end if;
  perform _travar_custos(p_loja, v_ids);

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local, r.codigo_insumo, 'SAI', p_origem, v_ref, r.quantidade, null, p_user,
                                 'Receita ' || p_produto || ' v' || v_ficha.versao, 0, null, null, null);
    if not coalesce((v_res ->> 'duplicado')::boolean, false) then
      insert into estoque_receita_consumos (movimento_id, loja_id, ficha_id, versao, produto_vendido, quantidade_vendida)
      values ((v_res ->> 'id')::bigint, p_loja, v_ficha.id, v_ficha.versao, p_produto, p_quantidade) on conflict do nothing;
    end if;
    if coalesce((v_res ->> 'negativo')::boolean, false) then v_negativo := true; end if;
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric, 'duplicado', coalesce((v_res ->> 'duplicado')::boolean, false)));
  end loop;
  return jsonb_build_object('ok', true, 'tem_receita', true, 'ficha_id', v_ficha.id, 'versao', v_ficha.versao, 'negativo', v_negativo, 'itens', v_itens);
end $$;

-- 8) Produzir lote ----------------------------------------------------------------------------------------
-- Consome os insumos (saída PRD no local de consumo) e entrega o produto (entrada PRD no local de destino) com
-- custo = custo consumido ÷ quantidade produzida. Idempotente por (loja, ref).
create or replace function public.produzir(
  p_loja bigint, p_produto bigint, p_quantidade numeric, p_local_consumo bigint, p_local_destino bigint,
  p_ref text, p_user text default null, p_obs text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; v_ficha fichas_tecnicas%rowtype; v_ex ordens_producao_proprio%rowtype; v_ids bigint[]; r record; v_res jsonb;
  v_total numeric := 0; v_custo_un numeric; v_ordem bigint; v_out jsonb; v_itens jsonb := '[]'::jsonb;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  if p_quantidade is null or p_quantidade <= 0 then raise exception 'Quantidade a produzir deve ser maior que zero' using errcode = '22023'; end if;
  if p_ref is null or btrim(p_ref) = '' then raise exception 'ref é obrigatório (idempotência)' using errcode = '22023'; end if;

  select * into v_ex from ordens_producao_proprio where loja_id = p_loja and ref = p_ref;
  if found then
    return jsonb_build_object('ok', true, 'duplicado', true, 'ordem_id', v_ex.id, 'custo_unitario', v_ex.custo_unitario, 'custo_total', v_ex.custo_total);
  end if;

  select * into v_ficha from fichas_tecnicas where loja_id = p_loja and codigo_produto = p_produto and ativa;
  if not found then raise exception 'O produto % não tem ficha técnica ativa', p_produto using errcode = '22023'; end if;
  if not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_consumo)
     or not exists (select 1 from local_estoques where loja_id = p_loja and codigo_local_estoque = p_local_destino) then
    raise exception 'Local de consumo ou de destino inexistente' using errcode = '22023';
  end if;

  select array_agg(e.codigo_insumo) into v_ids from expandir_receita(p_loja, p_produto, p_quantidade) e;
  perform _travar_custos(p_loja, coalesce(v_ids, '{}') || p_produto);

  insert into ordens_producao_proprio (loja_id, ref, codigo_produto, ficha_id, quantidade, local_consumo, local_destino, user_id, obs)
  values (p_loja, p_ref, p_produto, v_ficha.id, p_quantidade, p_local_consumo, p_local_destino, p_user, p_obs) returning id into v_ordem;

  for r in select * from expandir_receita(p_loja, p_produto, p_quantidade) order by 1 loop
    v_res := registrar_movimento(p_loja, p_local_consumo, r.codigo_insumo, 'PRD', 'PRODUCAO', p_ref, -r.quantidade, null, p_user,
                                 'Produção de ' || p_produto, 0, null, null, null);
    v_total := v_total + r.quantidade * coalesce((v_res ->> 'cmc')::numeric, 0);
    insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario, movimento_id)
    values (v_ordem, r.codigo_insumo, r.quantidade, coalesce((v_res ->> 'cmc')::numeric, 0), (v_res ->> 'id')::bigint);
    v_itens := v_itens || jsonb_build_array(jsonb_build_object('insumo', r.codigo_insumo, 'quantidade', r.quantidade, 'saldo', (v_res ->> 'saldo')::numeric));
  end loop;

  v_custo_un := round(v_total / p_quantidade, 6);
  v_out := registrar_movimento(p_loja, p_local_destino, p_produto, 'PRD', 'PRODUCAO', p_ref, p_quantidade,
                               case when v_custo_un > 0 then v_custo_un else null end, p_user, coalesce(p_obs, 'Produção de lote'), 0, null, null, null);
  update ordens_producao_proprio set custo_total = round(v_total, 6), custo_unitario = v_custo_un where id = v_ordem;
  return jsonb_build_object('ok', true, 'duplicado', false, 'ordem_id', v_ordem, 'custo_total', round(v_total, 6), 'custo_unitario', v_custo_un,
                            'saldo_produto', (v_out ->> 'saldo')::numeric, 'cmc_produto', (v_out ->> 'cmc')::numeric, 'itens', v_itens);
end $$;

-- 9) Só o servidor chama --------------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'salvar_ficha(bigint,bigint,numeric,jsonb,boolean,text,text)',
    'desativar_ficha(bigint,bigint)',
    'consumo_por_receita(bigint,bigint,numeric,bigint,text,text,int,text)',
    'produzir(bigint,bigint,numeric,bigint,bigint,text,text,text)',
    'expandir_receita(bigint,bigint,numeric)',
    'custo_unitario_ficha(bigint,bigint)',
    '_expandir_receita(bigint,bigint,numeric,int,bigint[])',
    '_travar_custos(bigint,bigint[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
