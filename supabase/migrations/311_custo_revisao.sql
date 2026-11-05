-- 311 — Revisões de custo do estoque próprio + visão efetiva (Norte ERP, custo certo, Task 1, 04/11/2026).
--
-- O ledger (estoque_movimentos) continua append-only. Quando o custo de um movimento muda depois (nota lançada com a data
-- dela, cascata de OP, estorno que sai da cadeia), a correção vira uma linha em estoque_mov_revisao (insert-only). A visão
-- estoque_movimentos_efetivo devolve cada movimento com a ÚLTIMA revisão aplicada; é a fonte de custo dos relatórios
-- (lucro_proprio, vendas_proprio_cmv, kardex). Sem revisão, a linha da visão é idêntica à do ledger.
--
-- Escrita só pela função interna _revisar_movimento (security definer, dona supabase_admin, sem EXECUTE para a API),
-- chamada por reprocessar_custo (312), produzir/consumo_por_receita (314). Mês fechado: a revisão é recusada (PF001)
-- se a data nova OU a data efetiva atual do movimento cai num mês fechado.
--
-- Teste: scripts/testes-sql/311_custo_revisao.sql (cópia local, BEGIN … ROLLBACK). Aplicar com -1, depois de 01:00:
--   node scripts/aplicar-migration.mjs supabase/migrations/311_custo_revisao.sql
-- Conferir: \d estoque_mov_revisao; \d+ estoque_movimentos_efetivo; select count(*) from estoque_movimentos_efetivo; (= ledger)
-- Desktop offline: a tabela NÃO entra em offline_tabelas nesta versão (o desktop mostra o custo original, sem revisão).

create table if not exists public.estoque_mov_revisao (
  id               bigserial primary key,
  movimento_id     bigint not null references public.estoque_movimentos(id),
  lote             uuid not null,
  data_efetiva     date not null,
  custo_unitario   numeric(18,6),
  cmc_apos         numeric(18,6),
  saldo_apos       numeric(18,6),
  saldo_total_apos numeric(18,6),
  custo_estimado   boolean not null,
  motivo           text not null check (btrim(motivo) <> ''),
  criado_em        timestamptz default now()
);
create index if not exists estoque_mov_revisao_mov on public.estoque_mov_revisao (movimento_id, id desc);
create index if not exists estoque_mov_revisao_lote on public.estoque_mov_revisao (lote);

comment on table public.estoque_mov_revisao is
  'Revisões de custo/data do ledger do estoque próprio (insert-only). A última por movimento vale; ver estoque_movimentos_efetivo.';

-- append-only: UPDATE/DELETE/TRUNCATE recusados
create or replace function public.trg_estoque_mov_revisao_imutavel() returns trigger
language plpgsql as $$
begin
  raise exception 'estoque_mov_revisao é append-only: grave uma revisão nova' using errcode = '55000';
end $$;
drop trigger if exists estoque_mov_revisao_imutavel on public.estoque_mov_revisao;
create trigger estoque_mov_revisao_imutavel before update or delete on public.estoque_mov_revisao
  for each row execute function public.trg_estoque_mov_revisao_imutavel();
drop trigger if exists estoque_mov_revisao_sem_truncate on public.estoque_mov_revisao;
create trigger estoque_mov_revisao_sem_truncate before truncate on public.estoque_mov_revisao
  for each statement execute function public.trg_ledger_sem_truncate();

-- mês fechado: nem a data nova nem a data efetiva atual podem estar num mês fechado
create or replace function public.trg_estoque_mov_revisao_periodo() returns trigger
language plpgsql security definer set search_path = public as $$
declare m estoque_movimentos%rowtype; v_atual date;
begin
  select * into m from estoque_movimentos where id = new.movimento_id;
  select coalesce((select r.data_efetiva from estoque_mov_revisao r where r.movimento_id = m.id order by r.id desc limit 1), m.data_ref)
    into v_atual;
  perform _exigir_periodo_aberto(m.loja_id, v_atual, 'revisão de custo');
  perform _exigir_periodo_aberto(m.loja_id, new.data_efetiva, 'revisão de custo');
  return new;
end $$;
drop trigger if exists estoque_mov_revisao_periodo on public.estoque_mov_revisao;
create trigger estoque_mov_revisao_periodo before insert on public.estoque_mov_revisao
  for each row execute function public.trg_estoque_mov_revisao_periodo();

-- RLS no padrão initplan da 156, pela loja do movimento
alter table public.estoque_mov_revisao enable row level security;
drop policy if exists estoque_mov_revisao_select_por_loja on public.estoque_mov_revisao;
create policy estoque_mov_revisao_select_por_loja on public.estoque_mov_revisao for select
  using (exists (select 1 from public.estoque_movimentos m
                  where m.id = estoque_mov_revisao.movimento_id
                    and ((select usuario_e_admin()) or m.loja_id in (select usuario_lojas()))));

revoke all on public.estoque_mov_revisao from anon, authenticated, service_role;
grant select on public.estoque_mov_revisao to authenticated, service_role;
revoke all on sequence public.estoque_mov_revisao_id_seq from anon, authenticated, service_role;

-- Escrita única ------------------------------------------------------------------------------------------------------
create or replace function public._revisar_movimento(p_mov bigint, p_lote uuid, p_data date, p_custo numeric, p_cmc numeric,
    p_saldo numeric, p_saldo_total numeric, p_estimado boolean, p_motivo text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Revisão de custo sem motivo' using errcode = '22023';
  end if;
  if p_data is null or p_lote is null then
    raise exception 'Revisão de custo sem data ou sem lote' using errcode = '22023';
  end if;
  insert into estoque_mov_revisao (movimento_id, lote, data_efetiva, custo_unitario, cmc_apos, saldo_apos, saldo_total_apos,
                                   custo_estimado, motivo)
  values (p_mov, p_lote, p_data, round(p_custo, 6), round(p_cmc, 6), round(p_saldo, 6), round(p_saldo_total, 6),
          coalesce(p_estimado, false), p_motivo)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._revisar_movimento(bigint, uuid, date, numeric, numeric, numeric, numeric, boolean, text)
  from public, anon, authenticated, service_role;

-- Visão efetiva ------------------------------------------------------------------------------------------------------
-- Mesmas colunas de estoque_movimentos, na mesma ordem (data_ref = data efetiva), mais: revisado, custo_original,
-- data_ref_original, revisado_em, motivo_revisao.
create or replace view public.estoque_movimentos_efetivo with (security_invoker = true) as
select m.id, m.loja_id, m.codigo_local_estoque, m.codigo_produto, m.tipo, m.origem, m.ref, m.linha, m.quantidade,
       case when r.id is null then m.custo_unitario else r.custo_unitario end as custo_unitario,
       case when r.id is null then m.saldo_apos else r.saldo_apos end as saldo_apos,
       case when r.id is null then m.saldo_total_apos else r.saldo_total_apos end as saldo_total_apos,
       case when r.id is null then m.cmc_apos else r.cmc_apos end as cmc_apos,
       case when r.id is null then m.custo_estimado else r.custo_estimado end as custo_estimado,
       m.reverses_id, m.transferencia_ref, m.user_id, m.obs,
       coalesce(r.data_efetiva, m.data_ref) as data_ref,
       m.created_at,
       r.id is not null as revisado,
       m.custo_unitario as custo_original,
       m.data_ref as data_ref_original,
       r.criado_em as revisado_em,
       r.motivo as motivo_revisao
  from public.estoque_movimentos m
  left join lateral (
    select x.id, x.data_efetiva, x.custo_unitario, x.cmc_apos, x.saldo_apos, x.saldo_total_apos, x.custo_estimado,
           x.criado_em, x.motivo
      from public.estoque_mov_revisao x
     where x.movimento_id = m.id
     order by x.id desc
     limit 1
  ) r on true;

comment on view public.estoque_movimentos_efetivo is
  'Ledger do estoque próprio com a última revisão de custo/data aplicada (311). Fonte de custo dos relatórios.';

revoke all on public.estoque_movimentos_efetivo from anon, authenticated, service_role;
grant select on public.estoque_movimentos_efetivo to authenticated, service_role;

notify pgrst, 'reload schema';
