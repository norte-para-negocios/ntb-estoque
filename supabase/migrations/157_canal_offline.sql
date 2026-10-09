-- 157: canal do app desktop offline (spec docs/superpowers/specs/2026-10-09-estoque-desktop-offline-design.md)
--
-- O que muda no servidor:
--  1. outbox_capture: grava o intent do desktop (header x-ntb-intent que o PostgREST expõe em
--     request.headers) e deixa de registrar UPDATE em que só updated_at mudou (o sync do Omie
--     "toca" ~1 mi linhas/dia sem mudar nada; a outbox não tem outro consumidor hoje).
--  2. offline_tabelas: allowlist do que pode ir para o desktop e a regra de visibilidade de cada
--     tabela. Tabela fora dela nunca sai do servidor. Colunas secretas de lojas ficam de fora.
--  3. offline_versoes: log compactado (uma linha por registro mudado) alimentado pela outbox
--     por offline_compactar(), que roda a cada minuto (crontab) e antes de cada pull.
--  4. Funções de leitura do canal (snapshot, puxar, linhas, criados) e offline_execucoes
--     (idempotência das ações enviadas pelo desktop). Tudo só para service_role.
--
-- Rodar fora de transação (tem CREATE INDEX CONCURRENTLY no fim):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 157_canal_offline.sql
--
-- Reverter: drop das funções offline_*, das tabelas offline_*, do índice outbox_intent_idx,
-- da coluna outbox.intent_id, dos triggers outbox_trigger criados aqui (lista em
-- offline_meta.triggers_criados) e recriar outbox_capture como estava (corpo no fim deste arquivo).

-- 1. outbox --------------------------------------------------------------------------------------
alter table outbox add column if not exists intent_id text;

create or replace function public.outbox_capture() returns trigger
language plpgsql as $function$
declare
  h text;
  v_intent text;
begin
  h := current_setting('request.headers', true);
  if h is not null and h like '%x-ntb-intent%' then
    v_intent := h::json ->> 'x-ntb-intent';
  end if;
  if (tg_op = 'DELETE') then
    insert into outbox (table_name, operation, row_data, intent_id) values (tg_table_name, tg_op, row_to_json(old)::jsonb, v_intent);
    return old;
  end if;
  -- update sem mudança real (sync do Omie reescreve linhas iguais) não precisa de replay
  if (tg_op = 'UPDATE' and old is not distinct from new) then
    return new;
  end if;
  -- update em que só updated_at mudou (sync "tocando" a linha) também não
  if (tg_op = 'UPDATE' and (to_jsonb(old) - 'updated_at') = (to_jsonb(new) - 'updated_at')) then
    return new;
  end if;
  insert into outbox (table_name, operation, row_data, intent_id) values (tg_table_name, tg_op, row_to_json(new)::jsonb, v_intent);
  return new;
end;
$function$;

-- 2. allowlist -----------------------------------------------------------------------------------
create table if not exists offline_meta (
  chave text primary key,
  valor jsonb not null
);

create table if not exists offline_tabelas (
  tabela text primary key,
  pk_cols text[] not null,
  pk_tipos text[] not null,
  regra text not null check (regra in ('loja', 'lojas', 'pai', 'global', 'profiles')),
  loja_col text,
  pai_tabela text,
  pai_fk text,
  ocultas text[] not null default '{}',
  -- 'log' = mudanças pela outbox; 'foto' = o desktop baixa a tabela da loja inteira de tempos em
  -- tempos (tabelas reescritas em massa pelo sync, que encheriam a outbox).
  modo text not null default 'log' check (modo in ('log', 'foto'))
);

do $$
declare
  t record;
  excluidas text[] := array[
    'outbox', 'webhooks', 'integration_attempts', 'convites', 'arquivos_mortos', 'sync_outbox',
    'vendas_integracao_fila', 'audit_log', 'sefaz_nsu', 'sefaz_documentos',
    'offline_meta', 'offline_tabelas', 'offline_versoes', 'offline_execucoes'
  ];
  fotos text[] := array['posicao_estoques', 'previsao_venda', 'produto_preco_recente'];
  globais text[] := array['cargos', 'cargo_permissao', 'permissoes'];
  regra text;
  loja_col text;
  pai_tabela text;
  pai_fk text;
  ocultas text[];
begin
  delete from offline_tabelas;
  for t in
    select c.relname as tabela,
           array_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) as cols,
           array_agg(format_type(a.atttypid, a.atttypmod) order by array_position(i.indkey::int2[], a.attnum)) as tipos,
           exists (select 1 from pg_attribute x where x.attrelid = c.oid and x.attname = 'loja_id' and not x.attisdropped) as tem_loja
    from pg_index i
    join pg_class c on c.oid = i.indrelid and c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary
    group by c.oid, c.relname
  loop
    continue when t.tabela = any(excluidas);
    loja_col := null; pai_tabela := null; pai_fk := null; ocultas := '{}';
    if t.tabela = 'lojas' then
      regra := 'lojas';
      ocultas := array['omie_app_key', 'omie_app_secret', 'certificado_path', 'certificado_nome',
        'certificado_senha_enc', 'certificado_validade', 'certificado_atualizado', 'csc_producao',
        'csc_id_producao', 'integracao_api_key', 'integracao_teste_api_key', 'codigo_onboarding'];
    elsif t.tabela = 'profiles' then
      regra := 'profiles';
    elsif t.tabela = any(globais) then
      regra := 'global';
    elsif t.tabela in ('vendas_proprio_itens', 'vendas_proprio_pagamentos') then
      regra := 'pai'; pai_tabela := 'vendas_proprio'; pai_fk := 'venda_id';
    elsif t.tabela = 'ordens_producao_proprio_itens' then
      regra := 'pai'; pai_tabela := 'ordens_producao_proprio'; pai_fk := 'ordem_id';
    elsif t.tem_loja then
      regra := 'loja'; loja_col := 'loja_id';
    else
      raise notice 'offline: tabela % sem regra de visibilidade, fica fora do desktop', t.tabela;
      continue;
    end if;
    insert into offline_tabelas (tabela, pk_cols, pk_tipos, regra, loja_col, pai_tabela, pai_fk, ocultas, modo)
    values (t.tabela, t.cols, t.tipos, regra, loja_col, pai_tabela, pai_fk, ocultas,
            case when t.tabela = any(fotos) then 'foto' else 'log' end);
  end loop;
end $$;

-- Triggers da outbox nas tabelas 'log' que ainda não tinham (lista guardada para reverter).
do $$
declare
  t record;
  criados text[] := '{}';
begin
  for t in
    select ot.tabela from offline_tabelas ot
    where ot.modo = 'log'
      and not exists (
        select 1 from pg_trigger g where g.tgrelid = format('public.%I', ot.tabela)::regclass and g.tgname = 'outbox_trigger'
      )
  loop
    execute format('create trigger outbox_trigger after insert or delete or update on public.%I for each row execute function outbox_capture()', t.tabela);
    criados := criados || t.tabela;
  end loop;
  insert into offline_meta values ('triggers_criados', to_jsonb(criados))
  on conflict (chave) do update set valor = excluded.valor;
end $$;

-- 3. log compactado -------------------------------------------------------------------------------
create sequence if not exists offline_versao_seq;

create table if not exists offline_versoes (
  tabela text not null,
  pk jsonb not null,
  loja_id bigint,
  versao bigint not null,
  apagado boolean not null default false,
  outbox_id bigint not null,
  em timestamptz not null default now(),
  primary key (tabela, pk)
);
create index if not exists offline_versoes_versao on offline_versoes (versao);

insert into offline_meta values ('ultimo_outbox', to_jsonb((select coalesce(max(id), 0) from outbox)))
on conflict (chave) do nothing;
insert into offline_meta values ('piso_versao', '0'::jsonb) on conflict (chave) do nothing;

-- Lê a outbox desde o último id processado (com 50 mil ids de folga: uma transação que pegou um
-- id antes e commitou depois ainda é vista) e grava a versão mais recente de cada registro.
-- Reprocessar a folga não gera versão nova (só atualiza quando outbox_id é maior).
create or replace function offline_compactar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
  v_max bigint;
  n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('offline_compactar')) then
    return 0;
  end if;
  select (valor #>> '{}')::bigint into v_ultimo from offline_meta where chave = 'ultimo_outbox';
  select max(id) into v_max from outbox;
  if v_max is null or v_max <= coalesce(v_ultimo, 0) - 50000 then
    return 0;
  end if;

  with fonte as (
    select o.id, o.table_name, o.operation, o.row_data, t.pk_cols, t.regra, t.loja_col, t.pai_tabela, t.pai_fk
    from outbox o
    join offline_tabelas t on t.tabela = o.table_name and t.modo = 'log'
    where o.id > greatest(coalesce(v_ultimo, 0) - 50000, 0) and o.id <= v_max
  ), chaves as (
    select distinct on (f.table_name, k.pk)
      f.table_name, k.pk, f.id, f.operation,
      case
        when f.regra = 'loja' then (f.row_data ->> f.loja_col)::bigint
        when f.regra = 'lojas' then (f.row_data ->> 'id')::bigint
        when f.regra = 'pai' and f.pai_tabela = 'vendas_proprio' then
          (select vp.loja_id from vendas_proprio vp where vp.id = (f.row_data ->> f.pai_fk)::bigint)
        when f.regra = 'pai' and f.pai_tabela = 'ordens_producao_proprio' then
          (select op.loja_id from ordens_producao_proprio op where op.id = (f.row_data ->> f.pai_fk)::bigint)
        else null
      end as loja_id
    from fonte f
    cross join lateral (
      select jsonb_object_agg(c, f.row_data -> c) as pk from unnest(f.pk_cols) c
    ) k
    order by f.table_name, k.pk, f.id desc
  )
  insert into offline_versoes as v (tabela, pk, loja_id, versao, apagado, outbox_id, em)
  select table_name, pk, loja_id, nextval('offline_versao_seq'), operation = 'DELETE', id, now()
  from chaves
  on conflict (tabela, pk) do update
    set versao = excluded.versao,
        apagado = excluded.apagado,
        outbox_id = excluded.outbox_id,
        loja_id = coalesce(excluded.loja_id, v.loja_id),
        em = excluded.em
    where excluded.outbox_id > v.outbox_id;
  get diagnostics n = row_count;

  update offline_meta set valor = to_jsonb(v_max) where chave = 'ultimo_outbox';
  return n;
end $$;

-- 4. leitura do canal -----------------------------------------------------------------------------

-- Condição SQL de visibilidade de uma tabela para um conjunto de lojas (alias da tabela = t).
create or replace function offline_filtro(p_tabela text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r offline_tabelas;
begin
  select * into r from offline_tabelas where tabela = p_tabela;
  if not found then
    raise exception 'tabela % não é sincronizada', p_tabela;
  end if;
  return case r.regra
    when 'loja' then format('t.%I = any($2)', r.loja_col)
    when 'lojas' then 't.id = any($2)'
    when 'pai' then format('exists (select 1 from public.%I p where p.id = t.%I and p.loja_id = any($2))', r.pai_tabela, r.pai_fk)
    when 'global' then 'true'
    when 'profiles' then '(t.id = $3 or t.id in (select lu.user_id from public.loja_user lu where lu.loja_id = any($2)))'
  end;
end $$;

-- Expressão que monta o JSON da linha sem as colunas ocultas (e sem e-mail de outros usuários).
create or replace function offline_expr_linha(p_tabela text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  r offline_tabelas;
  e text;
begin
  select * into r from offline_tabelas where tabela = p_tabela;
  e := 'to_jsonb(t)';
  if array_length(r.ocultas, 1) > 0 then
    e := format('(%s - %L::text[])', e, r.ocultas);
  end if;
  if r.regra = 'profiles' then
    e := format('(case when t.id = $3 then %s else %s - ''email'' end)', e, e);
  end if;
  return e;
end $$;

-- Linhas atuais de uma tabela pelos pks pedidos (só as visíveis). p_pks = [{"id": 1}, ...].
create or replace function offline_buscar_linhas(p_tabela text, p_pks jsonb, p_lojas bigint[], p_user uuid)
returns table (pk jsonb, dado jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  r offline_tabelas;
  junta text;
begin
  select * into r from offline_tabelas where tabela = p_tabela;
  if not found then
    raise exception 'tabela % não é sincronizada', p_tabela;
  end if;
  select string_agg(format('t.%I = (k ->> %L)::%s', c, c, tp), ' and ')
    into junta
    from unnest(r.pk_cols, r.pk_tipos) as x(c, tp);
  return query execute format(
    'select k, %s from jsonb_array_elements($1) k join public.%I t on %s where %s',
    offline_expr_linha(p_tabela), p_tabela, junta, offline_filtro(p_tabela)
  ) using p_pks, p_lojas, p_user;
end $$;

-- Página do snapshot de uma tabela (keyset pela chave primária). p_depois = pk da última linha.
create or replace function offline_snapshot(p_tabela text, p_lojas bigint[], p_user uuid, p_depois jsonb, p_limite int)
returns table (pk jsonb, dado jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  r offline_tabelas;
  cols text;
  vals text;
  pkexpr text;
  ordem text;
begin
  select * into r from offline_tabelas where tabela = p_tabela;
  if not found then
    raise exception 'tabela % não é sincronizada', p_tabela;
  end if;
  select string_agg(format('t.%I', c), ', '), string_agg(format('($4 ->> %L)::%s', c, tp), ', '),
         string_agg(format('%L, t.%I', c, c), ', ')
    into cols, vals, pkexpr
    from unnest(r.pk_cols, r.pk_tipos) as x(c, tp);
  ordem := cols;
  return query execute format(
    'select jsonb_build_object(%s), %s from public.%I t where %s and ($4 is null or (%s) > (%s)) order by %s limit $5',
    pkexpr, offline_expr_linha(p_tabela), p_tabela, offline_filtro(p_tabela), cols, vals, ordem
  ) using null::jsonb, p_lojas, p_user, p_depois, least(greatest(p_limite, 1), 5000);
end $$;

-- Mudanças desde o cursor. Linha apagada vai só com o pk (sem dado). Linha que existe mas não é
-- visível para estas lojas (ex.: mudou de loja) também vai como apagada para o desktop.
create or replace function offline_puxar(p_lojas bigint[], p_user uuid, p_cursor bigint, p_limite int)
returns table (versao bigint, tabela text, pk jsonb, apagado boolean, dado jsonb)
language plpgsql volatile security definer set search_path = public as $$
declare
  tb text;
  pks jsonb;
begin
  create temp table if not exists _offline_lote (versao bigint, tabela text, pk jsonb, apagado boolean) on commit drop;
  create temp table if not exists _offline_dados (tabela text, pk jsonb, dado jsonb) on commit drop;
  truncate _offline_lote;
  truncate _offline_dados;
  insert into _offline_lote
    select v.versao, v.tabela, v.pk, v.apagado
    from offline_versoes v
    where v.versao > p_cursor and (v.loja_id is null or v.loja_id = any(p_lojas))
    order by v.versao
    limit least(greatest(p_limite, 1), 5000);

  for tb in select distinct l.tabela from _offline_lote l where not l.apagado loop
    select jsonb_agg(l.pk) into pks from _offline_lote l where l.tabela = tb and not l.apagado;
    insert into _offline_dados select tb, b.pk, b.dado from offline_buscar_linhas(tb, pks, p_lojas, p_user) b;
  end loop;

  -- Linha que existe mas não é visível para estas lojas (perfil de outra loja, por ex.) não vai.
  -- A última versão do lote sempre vai (mesmo invisível, como marcador) para o cursor avançar.
  return query
    select l.versao, l.tabela, l.pk, l.apagado, d.dado
    from _offline_lote l
    left join _offline_dados d on d.tabela = l.tabela and d.pk = l.pk
    where l.apagado or d.dado is not null or l.versao = (select max(x.versao) from _offline_lote x)
    order by l.versao;
end $$;

-- Linhas que uma ação do desktop criou no servidor (pela outbox), na ordem em que foram criadas.
create or replace function offline_criados(p_intent text)
returns table (tabela text, pk jsonb, outbox_id bigint)
language sql stable security definer set search_path = public as $$
  select o.table_name, (select jsonb_object_agg(c, o.row_data -> c) from unnest(t.pk_cols) c), o.id
  from outbox o
  join offline_tabelas t on t.tabela = o.table_name
  where o.intent_id = p_intent and o.operation = 'INSERT'
  order by o.id
$$;

-- Lápides com mais de 60 dias saem; desktop com cursor abaixo do piso refaz o snapshot.
create or replace function offline_podar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_piso bigint;
  n int;
begin
  select max(versao) into v_piso from offline_versoes where apagado and em < now() - interval '60 days';
  if v_piso is null then
    return 0;
  end if;
  delete from offline_versoes where apagado and versao <= v_piso;
  get diagnostics n = row_count;
  update offline_meta set valor = to_jsonb(greatest((valor #>> '{}')::bigint, v_piso)) where chave = 'piso_versao';
  return n;
end $$;

-- 5. idempotência das ações -----------------------------------------------------------------------
create table if not exists offline_execucoes (
  intent_id text primary key,
  user_id uuid not null,
  acao text not null,
  status text not null check (status in ('em_andamento', 'ok', 'erro')),
  resultado jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- RLS ligada e nenhuma policy: só service_role (que ignora RLS) lê e escreve.
alter table offline_meta enable row level security;
alter table offline_tabelas enable row level security;
alter table offline_versoes enable row level security;
alter table offline_execucoes enable row level security;
revoke all on offline_meta, offline_tabelas, offline_versoes, offline_execucoes from anon, authenticated;

revoke execute on function offline_compactar(), offline_filtro(text), offline_expr_linha(text),
  offline_buscar_linhas(text, jsonb, bigint[], uuid), offline_snapshot(text, bigint[], uuid, jsonb, int),
  offline_puxar(bigint[], uuid, bigint, int), offline_criados(text), offline_podar()
  from public, anon, authenticated;
grant execute on function offline_compactar(), offline_buscar_linhas(text, jsonb, bigint[], uuid),
  offline_snapshot(text, bigint[], uuid, jsonb, int), offline_puxar(bigint[], uuid, bigint, int),
  offline_criados(text), offline_podar()
  to service_role;

-- Fora de transação: índice para achar as linhas criadas por um intent sem varrer a outbox.
create index concurrently if not exists outbox_intent_idx on outbox (intent_id) where intent_id is not null;

-- outbox_capture original (para reverter):
-- begin
--   if (tg_op = 'DELETE') then
--     insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(old)::jsonb);
--     return old;
--   end if;
--   if (tg_op = 'UPDATE' and old is not distinct from new) then
--     return new;
--   end if;
--   insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(new)::jsonb);
--   return new;
-- end;
