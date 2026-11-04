-- 318 — desktop offline: estoque_mov_revisao DESCE para o app (só leitura), 04/11/2026.
--
-- As revisões de custo/data (311–317) são gravadas SÓ pelo servidor. A ação feita no desktop sem internet é reexecutada
-- no servidor (/api/offline/acao, idempotente por offline_execucoes), que grava as revisões de verdade; elas descem pelo
-- canal como qualquer tabela. No banco local _revisar_movimento e reprocessar_custo são no-op (lib/offline/
-- limpar-esquema-puro.ts, aplicado por desktop/scripts/limpar-schema.mjs): o desktop nunca gera revisão própria.
--
-- O que muda aqui:
--  1. offline_tabelas ganha estoque_mov_revisao, regra 'pai' por estoque_movimentos (movimento_id). offline_filtro,
--     offline_snapshot e offline_buscar_linhas já tratam 'pai' de forma genérica (exists no pai por loja).
--  2. outbox_trigger na tabela (o log do canal vem da outbox). A tabela é insert-only: só INSERT entra na outbox.
--  3. offline_compactar: corpo da 193 (= produção, md5 do prosrc dab846fa91328b304dd604a131989c29 conferido em
--     04/11/2026) + o caso 'pai' de estoque_movimentos, para gravar loja_id em offline_versoes. Sem ele a versão iria
--     com loja_id nulo para todos os desktops (o offline_puxar filtraria a linha, mas cada app receberia a lista toda).
--
-- Desktops já instalados (1.0.4 e anteriores, esquema sem a tabela) NÃO quebram: o pull só aplica tabelas da lista
-- guardada na 1ª carga (meta 'tabelas'), e o aplicar.js devolve 0 para tabela que não existe no banco local (upsert e
-- apagar). Numa carga nova eles baixam o snapshot da tabela e descartam. Nada a filtrar por versão.
-- Revisões já gravadas antes desta migration não precisam de backfill em offline_versoes: o app novo troca de hash,
-- recria o banco local e baixa a tabela inteira pelo snapshot.
--
-- Aplicar (depois de 311–317; o runner embrulha em transação): NORTE_DB_SSH=root@185.193.66.240 NORTE_DB_SSH_KEY=~/.ssh/notebook_contabo_key \
--   node scripts/aplicar-migration.mjs 318_offline_mov_revisao.sql   (antes: o mesmo com --seco)
-- Conferir: select * from offline_tabelas where tabela = 'estoque_mov_revisao';
--           select tgname from pg_trigger where tgrelid = 'public.estoque_mov_revisao'::regclass and tgname = 'outbox_trigger';
-- Teste: scripts/testes-sql/318_offline_mov_revisao.sql (cópia local, BEGIN … ROLLBACK).
-- Reverter: delete from offline_tabelas where tabela = 'estoque_mov_revisao';
--           drop trigger outbox_trigger on public.estoque_mov_revisao;
--           delete from offline_versoes where tabela = 'estoque_mov_revisao';
--           reaplicar o offline_compactar da 193.

-- 1. allowlist ---------------------------------------------------------------------------------------------------
insert into offline_tabelas (tabela, pk_cols, pk_tipos, regra, loja_col, pai_tabela, pai_fk, ocultas, modo)
values ('estoque_mov_revisao', array['id'], array['bigint'], 'pai', null, 'estoque_movimentos', 'movimento_id', '{}', 'log')
on conflict (tabela) do update
  set pk_cols = excluded.pk_cols, pk_tipos = excluded.pk_tipos, regra = excluded.regra, loja_col = excluded.loja_col,
      pai_tabela = excluded.pai_tabela, pai_fk = excluded.pai_fk, ocultas = excluded.ocultas, modo = excluded.modo;

-- 2. outbox ------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estoque_mov_revisao'::regclass and tgname = 'outbox_trigger') then
    create trigger outbox_trigger after insert or delete or update on public.estoque_mov_revisao
      for each row execute function outbox_capture();
    update offline_meta set valor = valor || '["estoque_mov_revisao"]'::jsonb
     where chave = 'triggers_criados' and not valor ? 'estoque_mov_revisao';
  end if;
end $$;

-- 3. offline_compactar -------------------------------------------------------------------------------------------
create or replace function offline_compactar() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ultimo bigint;
  v_max bigint;
  v_inicio bigint;
  v_ult_exec timestamptz;
  n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('offline_compactar')) then
    return 0;
  end if;
  select (valor #>> '{}')::bigint into v_ultimo from offline_meta where chave = 'ultimo_outbox';
  select (valor #>> '{}')::timestamptz into v_ult_exec from offline_meta where chave = 'ultima_compactacao';
  select max(id) into v_max from outbox;
  -- folga: tudo depois do último processado + o que foi gravado até 10 minutos ANTES DA EXECUÇÃO ANTERIOR
  -- (transação que começou antes dela e confirmou depois). Medido a partir da execução anterior, não de agora:
  -- se o cron parar mais de 10 min, a transação atrasada continua dentro da janela (revisão I1, 19/10).
  -- Sem registro da execução anterior (1ª vez depois da 193): a folga antiga de 5.000 ids.
  if v_ult_exec is null then
    v_inicio := greatest(coalesce(v_ultimo, 0) - 5000, 0);
  else
    select least(coalesce(v_ultimo, 0), coalesce(min(id) - 1, coalesce(v_ultimo, 0))) into v_inicio
      from outbox where created_at > v_ult_exec - interval '10 minutes';
  end if;
  insert into offline_meta (chave, valor) values ('ultima_compactacao', to_jsonb(now()))
  on conflict (chave) do update set valor = excluded.valor;
  if v_max is null or v_max <= v_inicio then
    return 0;
  end if;

  with fonte as (
    select o.id, o.table_name, o.operation, o.row_data, t.pk_cols, t.regra, t.loja_col, t.pai_tabela, t.pai_fk
    from outbox o
    join offline_tabelas t on t.tabela = o.table_name and t.modo = 'log'
    where o.id > greatest(v_inicio, 0) and o.id <= v_max
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
        -- 318: revisões de custo pela loja do movimento revisado
        when f.regra = 'pai' and f.pai_tabela = 'estoque_movimentos' then
          (select em.loja_id from estoque_movimentos em where em.id = (f.row_data ->> f.pai_fk)::bigint)
        else null
      end as loja_id
    from fonte f
    cross join lateral (
      select jsonb_object_agg(c, f.row_data -> c) as pk from unnest(f.pk_cols) c
    ) k
    order by f.table_name, k.pk, f.id desc
  )
  insert into offline_versoes as v (tabela, pk, loja_id, versao, apagado, outbox_id, em)
  select c.table_name, c.pk, c.loja_id, nextval('offline_versao_seq'), c.operation = 'DELETE', c.id, now()
  from chaves c
  -- já registrado (reprocessamento da folga): pula sem gastar versão nem escrever
  where not exists (
    select 1 from offline_versoes x where x.tabela = c.table_name and x.pk = c.pk and x.outbox_id >= c.id
  )
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

-- Toda regra 'pai' precisa de um caso no offline_compactar (senão a versão vai com loja_id nulo para todos).
do $$
declare v text;
begin
  select string_agg(tabela || '→' || pai_tabela, ', ') into v from offline_tabelas
   where regra = 'pai' and pai_tabela not in ('vendas_proprio', 'ordens_producao_proprio', 'estoque_movimentos');
  if v is not null then
    raise exception '318: regra pai sem caso no offline_compactar: %', v;
  end if;
end $$;
