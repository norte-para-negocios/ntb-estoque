-- 172 — Refazer inventário pela Central de correções (15/10/2026, pedidos do Ramon).
--  1. estoque_refazer_inventario: cada "refazer o inventário na data dele" (contagem lançada errada, ou inventário que
--     não ficou no fim do dia). O Omie não tem AlterarAjusteEstoque: exclui as correções posteriores e o inventário e
--     lança o ajuste certo (ENT/SAI, motivo INV) na mesma data. A linha é a trava (um refazer em andamento por
--     inventário) e o registro da intenção antes de cada escrita (`pendente`): resposta perdida nunca duplica.
--  2. central_inventarios_fora_do_fim(loja, desde): inventários seguidos, no mesmo dia, por vendas/produção que o Omie
--     registrou DEPOIS deles (regra do dono: o inventário é feito com a casa fechada, fica sempre no fim do dia).
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 159 (kardex_omie),
-- 160 (movimentos.cod_int_ajuste) e da 156 remota (usuario_lojas).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 172_refazer_inventario.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.

begin;

-- 1. Refazer inventário --------------------------------------------------------------------------------------------
create table if not exists public.estoque_refazer_inventario (
  id                   bigserial primary key,
  loja_id              bigint not null references public.lojas(id) on delete cascade,
  modo                 text not null check (modo in ('contagem', 'fim_do_dia')),
  id_ajuste_inventario bigint not null,              -- ajuste do inventário errado (excluído no Omie)
  id_prod              bigint not null,
  codigo_local_estoque bigint not null,
  data_inventario      date not null,
  contagem_lancada     numeric,                      -- saldo logo depois do inventário (o que ficou no Omie)
  contagem_certa       numeric not null,
  saldo_antes          numeric not null,             -- saldo logo antes do inventário (kardex)
  vendas_depois        numeric not null default 0,   -- vendas/produção do dia que o Omie registrou depois dele
  quan                 numeric not null,             -- saldo antes + vendas depois − contagem certa (>0 SAI, <0 ENT, 0 nada)
  cmc                  numeric,
  excluir              bigint[] not null,            -- na ordem: correções posteriores, depois o inventário
  excluidos            bigint[] not null default '{}',
  pendente             jsonb,                        -- intenção gravada ANTES da escrita: {acao, id_ajuste?, em}
  id_ajuste_novo       bigint,
  cod_int_ajuste       text,                         -- INVR-<id>: acha o ajuste novo no Omie se a resposta se perder
  obs                  text,
  passos               jsonb,                        -- o passo a passo mostrado na tela e confirmado
  apagados_local       jsonb,                        -- linhas de movimentos apagadas aqui (ajustes que saíram do Omie)
  mes_fechado          boolean not null default false,
  status               text not null check (status in ('andamento', 'parado', 'concluido', 'cancelado')),
  erro                 text,
  user_id              uuid,
  user_nome            text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Um refazer em andamento (ou parado esperando "Continuar") por inventário: o 2º insert falha com 23505.
create unique index if not exists estoque_refazer_inventario_aberto
  on public.estoque_refazer_inventario (loja_id, id_ajuste_inventario)
  where status in ('andamento', 'parado', 'concluido');
create index if not exists estoque_refazer_inventario_loja on public.estoque_refazer_inventario (loja_id, id desc);

alter table public.estoque_refazer_inventario enable row level security;
drop policy if exists estoque_refazer_inventario_select_por_loja on public.estoque_refazer_inventario;
create policy estoque_refazer_inventario_select_por_loja on public.estoque_refazer_inventario for select using (
  (select usuario_e_admin()) or loja_id in (select usuario_lojas())
);
revoke all on public.estoque_refazer_inventario from anon;
revoke insert, update, delete, truncate on public.estoque_refazer_inventario from authenticated;
grant select on public.estoque_refazer_inventario to authenticated;

-- 2. Inventários que não ficaram no fim do dia ---------------------------------------------------------------------
-- Dia de um timestamp: meia-noite UTC exata = aquele dia (sync-ajustes grava só a data); o resto = dia da Bahia
-- (mesma regra de diaDoMovimento, lib/estoque/quem-mexeu-puro.ts).
create or replace function public.dia_do_movimento(p timestamptz)
returns date language sql stable set search_path = public as $fn$
  select case when (p at time zone 'UTC')::time = '00:00' then (p at time zone 'UTC')::date
              else (p at time zone 'America/Bahia')::date end
$fn$;

-- Inventário = item de inventário do app (inventario_items com ajuste) ou contagem SLD em movimentos (sync-ajustes) ou
-- inventário refeito pela Central (cod_int_ajuste INVR-). Por produto/local/dia vale só o último. "Depois" = venda ou
-- produção do mesmo dia que o Omie registrou depois dele:
--   loja com kardex do dia (kardex_omie): linhas com id_mov maior que o do inventário (inventário sem linha no kardex
--     porque a contagem bateu: id_mov maior que o id do ajuste), origem PDV/OPS/OPE ou ajuste de venda (motivo PDV);
--   sem kardex: movimentos de venda (motivo PDV) concluídos com id_ajuste maior que o do inventário.
-- Notas de compra e ajustes manuais lançados depois NÃO contam (podem ter chegado depois da contagem).
create or replace function public.central_inventarios_fora_do_fim(p_loja_id bigint, p_ini date)
returns table (id_ajuste bigint, produto bigint, local bigint, dia date, contagem numeric, n integer, soma numeric, fonte text)
language sql stable security invoker set search_path = public as $fn$
  with inv_raw as (
    select ii.id_ajuste, ii.produto_codigo_produto as produto, i.codigo_local_estoque as local, dia_do_movimento(i.data) as dia, ii.quan as contagem
    from inventario_items ii join inventarios i on i.id = ii.inventario_id
    where ii.loja_id = p_loja_id and i.loja_id = p_loja_id and i.data >= p_ini - 1 and ii.id_ajuste > 0 and ii.status = 'Concluido'
      and ii.produto_codigo_produto is not null
    union all
    select m.id_ajuste, m.id_prod, m.codigo_local_estoque, dia_do_movimento(m.data), case when m.tipo = 'SLD' then m.quan end
    from movimentos m
    where m.loja_id = p_loja_id and m.data >= p_ini - 1 and m.status = 'Concluido' and m.id_ajuste > 0
      and (m.tipo = 'SLD' or m.cod_int_ajuste like 'INVR-%')
  ),
  inv_ids as (select distinct r.id_ajuste from inv_raw r),
  inv as (
    select distinct on (r.produto, r.local, r.dia) r.id_ajuste, r.produto, r.local, r.dia, r.contagem
    from inv_raw r where r.dia >= p_ini
    order by r.produto, r.local, r.dia, r.id_ajuste desc
  ),
  venda_aju as (
    select m.id_ajuste from movimentos m
    where m.loja_id = p_loja_id and m.motivo = 'PDV' and m.id_ajuste > 0 and m.data >= p_ini - 1
  ),
  com_kardex as (
    select inv.id_ajuste,
      coalesce((select k.id_mov from kardex_omie k where k.loja_id = p_loja_id and k.id_ajuste = inv.id_ajuste
                  and k.n_cod_prod = inv.produto and k.codigo_local_estoque = inv.local and not k.cancelado limit 1), inv.id_ajuste) as ancora
    from inv
    where exists (select 1 from kardex_omie k where k.loja_id = p_loja_id and k.n_cod_prod = inv.produto
                    and k.codigo_local_estoque = inv.local and k.data_mov = inv.dia)
  ),
  depois_k as (
    select inv.id_ajuste, count(*)::int as n, sum(k.quantidade) as soma
    from com_kardex ck join inv on inv.id_ajuste = ck.id_ajuste
    join kardex_omie k on k.loja_id = p_loja_id and k.n_cod_prod = inv.produto and k.codigo_local_estoque = inv.local
      and k.data_mov = inv.dia and k.id_mov > ck.ancora and not k.cancelado
      and (k.id_ajuste is null or k.id_ajuste not in (select x.id_ajuste from inv_ids x))
      and (k.cod_origem in ('PDV', 'OPS', 'OPE') or k.id_ajuste in (select v.id_ajuste from venda_aju v))
    group by 1
  ),
  depois_m as (
    select inv.id_ajuste, count(*)::int as n, sum(m.quan) as soma
    from inv join movimentos m on m.loja_id = p_loja_id and m.id_prod = inv.produto and m.codigo_local_estoque = inv.local
      and m.status = 'Concluido' and m.motivo = 'PDV' and m.id_ajuste > inv.id_ajuste
      and m.data >= (inv.dia::timestamp at time zone 'UTC') - interval '1 day'
      and m.data < (inv.dia::timestamp at time zone 'UTC') + interval '2 day'
      and dia_do_movimento(m.data) = inv.dia
    where not exists (select 1 from com_kardex ck where ck.id_ajuste = inv.id_ajuste)
    group by 1
  )
  select inv.id_ajuste, inv.produto, inv.local, inv.dia, inv.contagem,
    coalesce(dk.n, dm.n) as n, coalesce(dk.soma, dm.soma) as soma, case when dk.n is not null then 'kardex' else 'movimentos' end as fonte
  from inv left join depois_k dk on dk.id_ajuste = inv.id_ajuste left join depois_m dm on dm.id_ajuste = inv.id_ajuste
  where coalesce(dk.n, dm.n, 0) > 0
  order by inv.dia desc, inv.produto
  limit 2000
$fn$;
revoke all on function public.central_inventarios_fora_do_fim(bigint, date) from public, anon;
grant execute on function public.central_inventarios_fora_do_fim(bigint, date) to authenticated;

commit;
