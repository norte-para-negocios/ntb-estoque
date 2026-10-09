-- Controle local do desktop (nunca existe no servidor). Carregado depois de estoque.sql.
create schema if not exists ntb_local;

create table if not exists ntb_local.meta (
  chave text primary key,
  valor jsonb not null
);

-- Toda linha mexida por uma ação rodando no banco local (sem internet). O pull aplica com
-- session_replication_role = replica, então o trigger não dispara para o que veio do servidor.
create table if not exists ntb_local.alteracoes (
  seq bigserial primary key,
  tabela text not null,
  pk jsonb not null,
  op text not null,
  intent_id text,
  em timestamptz not null default now()
);
create index if not exists alteracoes_intent on ntb_local.alteracoes (intent_id, seq);

create or replace function ntb_local.rastrear() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  r record;
  chave jsonb := '{}'::jsonb;
  c text;
  intent text;
begin
  if current_setting('ntb.aplicando', true) = '1' then
    return null;
  end if;
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  foreach c in array tg_argv loop
    chave := chave || jsonb_build_object(c, to_jsonb(r) -> c);
  end loop;
  begin
    intent := nullif(current_setting('request.headers', true), '')::json ->> 'x-ntb-intent';
  exception when others then
    intent := null;
  end;
  insert into ntb_local.alteracoes (tabela, pk, op, intent_id) values (tg_table_name, chave, tg_op, intent);
  return null;
end $$;

-- Instala o rastreio em todas as tabelas do public que têm chave primária.
create or replace function ntb_local.instalar_rastreio() returns int
language plpgsql as $$
declare
  t record;
  n int := 0;
begin
  for t in
    select c.relname as tabela,
           array_agg(a.attname order by array_position(i.indkey::int2[], a.attnum)) as cols
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    join pg_namespace ns on ns.oid = c.relnamespace and ns.nspname = 'public'
    join pg_attribute a on a.attrelid = c.oid and a.attnum = any(i.indkey)
    where i.indisprimary and c.relkind = 'r'
    group by c.relname
  loop
    execute format('drop trigger if exists ntb_rastro on public.%I', t.tabela);
    execute format(
      'create trigger ntb_rastro after insert or update or delete on public.%I for each row execute function ntb_local.rastrear(%s)',
      t.tabela,
      (select string_agg(quote_literal(x), ',') from unnest(t.cols) x)
    );
    n := n + 1;
  end loop;
  return n;
end $$;

-- Coloca cada sequência de chave primária numa faixa própria e alta, para que uma linha criada
-- sem internet nunca use um id que o servidor vá usar. Faixa por tabela (índice = ordem
-- alfabética das tabelas com sequência): int4 = 2e9 + i*1e6; int8 = 5e15 + i*1e10.
-- Devolve {tabela: {"base": n, "tipo": "int4"|"int8"}} para o motor de sincronização.
create or replace function ntb_local.ajustar_sequencias() returns jsonb
language plpgsql as $$
declare
  s record;
  i int := 0;
  base bigint;
  saida jsonb := '{}'::jsonb;
begin
  for s in
    with pks as materialized (
      select c.relname as tabela, a.attname as coluna, format_type(a.atttypid, a.atttypmod) as tipo
      from pg_class c
      join pg_index ix on ix.indrelid = c.oid and ix.indisprimary and array_length(ix.indkey::int2[], 1) = 1
      join pg_attribute a on a.attrelid = c.oid and a.attnum = ix.indkey[0]
      where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
    ), comseq as materialized (
      select tabela, coluna, tipo, pg_get_serial_sequence(format('public.%I', tabela), coluna) as seq from pks
    )
    select * from comseq where seq is not null order by tabela
  loop
    if s.tipo = 'integer' then
      base := 2000000000 + i::bigint * 1000000;
    else
      base := 5000000000000000 + i::bigint * 10000000000;
    end if;
    execute format('alter sequence %s maxvalue %s', s.seq, case when s.tipo = 'integer' then 2147483647 else 9223372036854775807 end);
    perform setval(s.seq, base, false);
    saida := saida || jsonb_build_object(s.tabela, jsonb_build_object('base', base, 'tipo', case when s.tipo = 'integer' then 'int4' else 'int8' end));
    i := i + 1;
  end loop;
  return saida;
end $$;

-- O PostgREST local escuta em 127.0.0.1 e qualquer programa do computador alcança a porta. No
-- servidor o papel anon tem grants herdados do Supabase (funções SECURITY DEFINER sem checagem
-- de usuário, tabelas sem RLS); aqui ele não precisa de nada: o app sempre fala com JWT de usuário
-- ou de serviço assinados com o segredo desta instalação.
do $$
begin
  execute 'revoke all on all tables in schema public from anon';
  execute 'revoke all on all sequences in schema public from anon';
  execute 'revoke execute on all functions in schema public from anon, public';
  execute 'grant execute on all functions in schema public to authenticated, service_role';
  execute 'alter default privileges in schema public revoke all on tables from anon';
  execute 'alter default privileges in schema public revoke execute on functions from anon, public';
end $$;
