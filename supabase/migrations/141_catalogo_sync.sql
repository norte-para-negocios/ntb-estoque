-- 141 — Catálogo unificado (grupos em árvore, produto mãe/variações) + sincronização automática com o Norte Vendas.
-- Aditiva. Só age em lojas modo_estoque='proprio' com vendas_store_id preenchido; lojas 'omie' e 'nenhum' não mudam.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 141_catalogo_sync.sql
-- Depende de: 132 (modo_estoque, proximo_codigo_produto, novo_id_*), RLS helpers usuario_tem_acesso_loja/usuario_e_admin.

-- 1) Ligação da loja com o Vendas ---------------------------------------------------------------------
alter table public.lojas add column if not exists vendas_store_id uuid;
grant select (vendas_store_id) on public.lojas to authenticated;

-- 2) Grupos e subgrupos (árvore por loja) ----------------------------------------------------------------
create table if not exists public.grupos_produto (
  id          bigint generated always as identity primary key,
  loja_id     bigint not null references public.lojas(id),
  pai_id      bigint references public.grupos_produto(id) on delete restrict,
  nome        text   not null check (btrim(nome) <> ''),
  ordem       int    not null default 0,
  ativo       boolean not null default true,
  vendas_ref  uuid,                         -- category_groups.id / categories.id do Vendas
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists grupos_produto_nome_uq on public.grupos_produto (loja_id, coalesce(pai_id, 0), lower(nome));
create unique index if not exists grupos_produto_vendas_ref_uq on public.grupos_produto (loja_id, vendas_ref) where vendas_ref is not null;
create index if not exists grupos_produto_pai on public.grupos_produto (loja_id, pai_id);

-- Sem laço, mesma loja do pai e no máximo 5 níveis.
create or replace function public.trg_grupos_produto_arvore() returns trigger
language plpgsql set search_path = public as $$
declare v_pai grupos_produto%rowtype; v_prof int := 1; v_atual bigint;
begin
  new.updated_at := now();
  if new.pai_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.pai_id = new.id then raise exception 'Um grupo não pode ser pai de si mesmo' using errcode = '23514'; end if;
  select * into v_pai from grupos_produto where id = new.pai_id;
  if not found or v_pai.loja_id <> new.loja_id then raise exception 'Grupo pai inválido' using errcode = '23514'; end if;
  v_atual := v_pai.pai_id;
  while v_atual is not null loop
    v_prof := v_prof + 1;
    if tg_op = 'UPDATE' and v_atual = new.id then raise exception 'A árvore de grupos não pode ter ciclo' using errcode = '23514'; end if;
    if v_prof > 5 then raise exception 'No máximo 5 níveis de grupos' using errcode = '23514'; end if;
    select pai_id into v_atual from grupos_produto where id = v_atual;
  end loop;
  return new;
end $$;
drop trigger if exists grupos_produto_arvore on public.grupos_produto;
create trigger grupos_produto_arvore before insert or update of pai_id on public.grupos_produto
  for each row execute function public.trg_grupos_produto_arvore();

-- 3) Produto mãe, variações, atributos, grupo ----------------------------------------------------------------
alter table public.produtos add column if not exists grupo_id bigint references public.grupos_produto(id) on delete set null;
alter table public.produtos add column if not exists eh_mae boolean not null default false;
alter table public.produtos add column if not exists produto_pai_codigo bigint;
alter table public.produtos add column if not exists atributos jsonb not null default '{}'::jsonb;
alter table public.produtos add column if not exists vendas_ref uuid;
alter table public.produtos add column if not exists sync_atualizado_em timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_pai_fk') then
    alter table public.produtos add constraint produtos_pai_fk
      foreign key (produto_pai_codigo, loja_id) references public.produtos (codigo_produto, loja_id) on delete restrict;
  end if;
end $$;
create index if not exists produtos_pai_idx on public.produtos (loja_id, produto_pai_codigo) where produto_pai_codigo is not null;
create index if not exists produtos_grupo_idx on public.produtos (loja_id, grupo_id) where grupo_id is not null;
create unique index if not exists produtos_vendas_ref_uq on public.produtos (loja_id, vendas_ref) where vendas_ref is not null;

-- Regras de mãe/variação: a mãe não tem pai e não tem movimento; variação aponta para uma mãe da mesma loja.
create or replace function public.trg_produtos_mae_variacao() returns trigger
language plpgsql set search_path = public as $$
declare v_pai produtos%rowtype;
begin
  if new.eh_mae and new.produto_pai_codigo is not null then
    raise exception 'Um produto mãe não pode ser variação de outro' using errcode = '23514';
  end if;
  if new.produto_pai_codigo is not null then
    select * into v_pai from produtos where loja_id = new.loja_id and codigo_produto = new.produto_pai_codigo;
    if not found then raise exception 'Produto mãe não encontrado' using errcode = '23514'; end if;
    if not v_pai.eh_mae then raise exception 'O produto % não é um produto mãe', v_pai.codigo using errcode = '23514'; end if;
  end if;
  if new.eh_mae and (tg_op = 'INSERT' or old.eh_mae is distinct from true)
     and exists (select 1 from estoque_movimentos where loja_id = new.loja_id and codigo_produto = new.codigo_produto) then
    raise exception 'O produto já tem movimentos de estoque e não pode virar mãe' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists produtos_mae_variacao on public.produtos;
create trigger produtos_mae_variacao before insert or update of eh_mae, produto_pai_codigo on public.produtos
  for each row execute function public.trg_produtos_mae_variacao();

create or replace function public.trg_movimento_nao_mae() returns trigger
language plpgsql set search_path = public as $$
begin
  if exists (select 1 from produtos where loja_id = new.loja_id and codigo_produto = new.codigo_produto and eh_mae) then
    raise exception 'Produto mãe não tem estoque: lance o movimento em uma variação' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists estoque_movimentos_nao_mae on public.estoque_movimentos;
create trigger estoque_movimentos_nao_mae before insert on public.estoque_movimentos
  for each row execute function public.trg_movimento_nao_mae();

-- 4) Outbox de sincronização e divergências -------------------------------------------------------------------
create table if not exists public.sync_outbox (
  id                bigint generated always as identity primary key,
  loja_id           bigint not null references public.lojas(id),
  entidade          text   not null check (entidade in ('produto', 'grupo')),
  ref               text   not null,                       -- produtos.codigo | grupos_produto.id
  operacao          text   not null default 'upsert' check (operacao in ('upsert', 'delete')),
  status            text   not null default 'pending' check (status in ('pending', 'ok', 'erro')),
  tentativas        int    not null default 0,
  erro              text,
  proxima_tentativa timestamptz not null default now(),
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
-- Uma linha pendente por entidade: várias edições seguidas viram uma entrega só.
create unique index if not exists sync_outbox_pendente_uq on public.sync_outbox (loja_id, entidade, ref) where status = 'pending';
create index if not exists sync_outbox_fila on public.sync_outbox (status, proxima_tentativa);

create table if not exists public.sync_divergencias (
  id           bigint generated always as identity primary key,
  loja_id      bigint not null references public.lojas(id),
  entidade     text   not null,
  ref          text   not null,
  tipo         text   not null,                -- so_estoque | so_vendas | conflito | erro_entrega
  detalhe      text,
  detectado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create unique index if not exists sync_divergencias_aberta_uq on public.sync_divergencias (loja_id, entidade, ref, tipo) where resolvido_em is null;

do $$ declare t text; begin
  foreach t in array array['grupos_produto', 'sync_outbox', 'sync_divergencias'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin())', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Gatilho: toda mudança de catálogo numa loja 'proprio' ligada ao Vendas entra no outbox,
-- exceto as que chegam DO Vendas (ntb.sync_skip=1 na transação).
create or replace function public.trg_sync_outbox_catalogo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loja bigint; v_modo text; v_vendas uuid; v_ref text; v_ent text; v_op text := 'upsert'; r record;
begin
  if coalesce(current_setting('ntb.sync_skip', true), '') = '1' then return null; end if;
  if tg_op = 'DELETE' then r := old; v_op := 'delete'; else r := new; end if;
  v_loja := r.loja_id;
  select modo_estoque, vendas_store_id into v_modo, v_vendas from lojas where id = v_loja;
  if v_modo is distinct from 'proprio' or v_vendas is null then return null; end if;
  if tg_table_name = 'produtos' then
    v_ent := 'produto'; v_ref := r.codigo;
    if v_ref is null then return null; end if;
  else
    v_ent := 'grupo'; v_ref := r.id::text;
  end if;
  insert into sync_outbox (loja_id, entidade, ref, operacao) values (v_loja, v_ent, v_ref, v_op)
  on conflict (loja_id, entidade, ref) where status = 'pending'
  do update set operacao = excluded.operacao, atualizado_em = now(), proxima_tentativa = least(sync_outbox.proxima_tentativa, now());
  return null;
exception when others then
  return null;   -- sincronização nunca derruba o cadastro
end $$;
drop trigger if exists produtos_sync_outbox on public.produtos;
create trigger produtos_sync_outbox after insert or update or delete on public.produtos
  for each row execute function public.trg_sync_outbox_catalogo();
drop trigger if exists grupos_produto_sync_outbox on public.grupos_produto;
create trigger grupos_produto_sync_outbox after insert or update on public.grupos_produto
  for each row execute function public.trg_sync_outbox_catalogo();

-- 5) Aplicar catálogo vindo do Vendas (idempotente, sem eco) ------------------------------------------------------
-- payload: { grupos:[{vendas_ref, nome, pai_vendas_ref, ordem, ativo, updated_at}],
--            produtos:[{vendas_ref, codigo, nome, preco, ativo, grupo_vendas_ref, pai_codigo, mae, atributos, updated_at, tipo_item, ncm, unidade}] }
-- Regras: preço de venda = Vendas manda; código/unidade/tipo/NCM/custo = Estoque manda; nome/ativo/grupo = vence updated_at mais novo.
create or replace function public.aplicar_catalogo_vendas(p_loja bigint, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_modo text; g jsonb; p jsonb; v_id bigint; v_pai bigint; v_ts timestamptz; v_atual produtos%rowtype; v_gatual grupos_produto%rowtype;
  v_codigo text; v_cp bigint; v_grupo bigint; v_paicp bigint; v_ativo boolean; v_novo boolean; v_nome text;
  r_g jsonb := '[]'::jsonb; r_p jsonb := '[]'::jsonb; v_tipo text; v_un text;
begin
  select modo_estoque into v_modo from lojas where id = p_loja;
  if v_modo is distinct from 'proprio' then raise exception 'A loja % não usa estoque próprio', p_loja using errcode = '22023'; end if;
  perform set_config('ntb.sync_skip', '1', true);

  for g in select * from jsonb_array_elements(coalesce(p_payload -> 'grupos', '[]'::jsonb)) loop
    v_ts := coalesce((g ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(g ->> 'nome');
    if v_nome is null or v_nome = '' then continue; end if;
    v_pai := null;
    if nullif(g ->> 'pai_vendas_ref', '') is not null then
      select id into v_pai from grupos_produto where loja_id = p_loja and vendas_ref = (g ->> 'pai_vendas_ref')::uuid;
    end if;
    select * into v_gatual from grupos_produto where loja_id = p_loja and vendas_ref = (g ->> 'vendas_ref')::uuid;
    if not found then
      -- tenta ligar a um grupo de mesmo nome e mesmo pai que ainda não tem vínculo
      select * into v_gatual from grupos_produto where loja_id = p_loja and vendas_ref is null
         and coalesce(pai_id, 0) = coalesce(v_pai, 0) and lower(nome) = lower(v_nome) limit 1;
      if found then
        update grupos_produto set vendas_ref = (g ->> 'vendas_ref')::uuid where id = v_gatual.id;
      end if;
    end if;
    if not found then
      insert into grupos_produto (loja_id, pai_id, nome, ordem, ativo, vendas_ref)
      values (p_loja, v_pai, v_nome, coalesce((g ->> 'ordem')::int, 0), coalesce((g ->> 'ativo')::boolean, true), (g ->> 'vendas_ref')::uuid)
      returning id into v_id;
    else
      v_id := v_gatual.id;
      if v_ts > v_gatual.updated_at then
        update grupos_produto set nome = v_nome, ordem = coalesce((g ->> 'ordem')::int, ordem),
               ativo = coalesce((g ->> 'ativo')::boolean, ativo), pai_id = coalesce(v_pai, pai_id)
         where id = v_id;
      end if;
    end if;
    r_g := r_g || jsonb_build_object('vendas_ref', g ->> 'vendas_ref', 'grupo_id', v_id);
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_payload -> 'produtos', '[]'::jsonb)) loop
    v_ts := coalesce((p ->> 'updated_at')::timestamptz, now());
    v_nome := btrim(p ->> 'nome');
    v_ativo := coalesce((p ->> 'ativo')::boolean, true);
    v_novo := false;
    v_grupo := null;
    if nullif(p ->> 'grupo_vendas_ref', '') is not null then
      select id into v_grupo from grupos_produto where loja_id = p_loja and vendas_ref = (p ->> 'grupo_vendas_ref')::uuid;
    end if;
    v_paicp := null;
    if nullif(p ->> 'pai_codigo', '') is not null then
      select codigo_produto into v_paicp from produtos where loja_id = p_loja and codigo = p ->> 'pai_codigo';
    end if;

    v_atual := null;
    if nullif(p ->> 'codigo', '') is not null then
      select * into v_atual from produtos where loja_id = p_loja and codigo = p ->> 'codigo';
    end if;
    if v_atual.id is null and nullif(p ->> 'vendas_ref', '') is not null then
      select * into v_atual from produtos where loja_id = p_loja and vendas_ref = (p ->> 'vendas_ref')::uuid;
    end if;

    if v_atual.id is null then
      if v_nome is null or v_nome = '' then continue; end if;
      v_tipo := coalesce(nullif(p ->> 'tipo_item', ''), '04');
      v_un := coalesce(nullif(p ->> 'unidade', ''), 'UN');
      v_codigo := proximo_codigo_produto(p_loja, v_tipo);
      v_cp := novo_id_produto_proprio();
      insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, ncm, valor_unitario, pdv, inativo,
                            grupo_id, eh_mae, produto_pai_codigo, atributos, vendas_ref, sync_atualizado_em, updated_at)
      values (p_loja, v_cp, v_codigo, v_nome, v_un, v_tipo, nullif(regexp_replace(coalesce(p ->> 'ncm', ''), '\D', '', 'g'), ''),
              coalesce((p ->> 'preco')::numeric, 0), true, not v_ativo,
              v_grupo, coalesce((p ->> 'mae')::boolean, false), v_paicp, coalesce(p -> 'atributos', '{}'::jsonb),
              nullif(p ->> 'vendas_ref', '')::uuid, now(), v_ts);
      v_novo := true;
    else
      v_codigo := v_atual.codigo;
      v_cp := v_atual.codigo_produto;
      -- preço: o Vendas manda, sempre
      if nullif(p ->> 'preco', '') is not null then
        update produtos set valor_unitario = (p ->> 'preco')::numeric where id = v_atual.id and valor_unitario is distinct from (p ->> 'preco')::numeric;
      end if;
      if nullif(p ->> 'vendas_ref', '') is not null and v_atual.vendas_ref is null then
        update produtos set vendas_ref = (p ->> 'vendas_ref')::uuid where id = v_atual.id;
      end if;
      -- nome, ativo, grupo, atributos: vence o mais novo
      if v_ts > v_atual.updated_at then
        update produtos set descricao = coalesce(nullif(v_nome, ''), descricao), inativo = not v_ativo,
               grupo_id = coalesce(v_grupo, grupo_id), atributos = coalesce(p -> 'atributos', atributos), updated_at = v_ts
         where id = v_atual.id;
      end if;
      -- vínculo mãe/variação (só quando ainda não existe; o Estoque manda na estrutura depois)
      if v_paicp is not null and v_atual.produto_pai_codigo is null and not v_atual.eh_mae then
        update produtos set produto_pai_codigo = v_paicp where id = v_atual.id;
      end if;
      if coalesce((p ->> 'mae')::boolean, false) and not v_atual.eh_mae and v_atual.produto_pai_codigo is null
         and not exists (select 1 from estoque_movimentos where loja_id = p_loja and codigo_produto = v_atual.codigo_produto) then
        update produtos set eh_mae = true where id = v_atual.id;
      end if;
      update produtos set sync_atualizado_em = now() where id = v_atual.id;
    end if;
    r_p := r_p || jsonb_build_object('vendas_ref', p ->> 'vendas_ref', 'codigo', v_codigo, 'codigo_produto', v_cp, 'criado', v_novo);
  end loop;

  return jsonb_build_object('ok', true, 'grupos', r_g, 'produtos', r_p);
end $$;

-- Grava no Estoque os ids do Vendas devolvidos depois de uma entrega (sem eco).
create or replace function public.registrar_mapa_vendas(p_loja bigint, p_mapa jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare m jsonb;
begin
  perform set_config('ntb.sync_skip', '1', true);
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'grupos', '[]'::jsonb)) loop
    update grupos_produto set vendas_ref = (m ->> 'vendas_ref')::uuid where loja_id = p_loja and id = (m ->> 'estoque_id')::bigint and vendas_ref is null;
  end loop;
  for m in select * from jsonb_array_elements(coalesce(p_mapa -> 'produtos', '[]'::jsonb)) loop
    update produtos set vendas_ref = (m ->> 'vendas_ref')::uuid, sync_atualizado_em = now()
     where loja_id = p_loja and codigo = m ->> 'codigo' and vendas_ref is null;
  end loop;
end $$;

-- Só o servidor chama.
do $$ declare f text; begin
  foreach f in array array['aplicar_catalogo_vendas(bigint,jsonb)', 'registrar_mapa_vendas(bigint,jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
