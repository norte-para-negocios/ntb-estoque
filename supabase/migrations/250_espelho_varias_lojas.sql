-- 250 — D5 (20/10/2026): espelho completo em várias lojas (2, 3, 6), sem ligar junto o que pesa no Omie.
-- NÃO aplicada automaticamente (migrations manuais, ver AGENTS.md). Depende da 160 e da 201.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 250_espelho_varias_lojas.sql
-- Depois: NOTIFY pgrst (está no fim), desktop/scripts/gerar-schema.sh + versão nova do desktop.
--
-- 1. lojas.omie_op_tempo_real: até aqui o webhook (ConsultarOrdemProducao a cada aviso de OP) e o cron de OPs
--    fantasmas usavam `espelho_completo` como "loja fora de faxina" (16/10). Como a flag é false em todas as lojas,
--    os dois estão parados em TODAS desde 16/10; ligar o espelho numa loja religaria os dois junto, somando chamadas
--    ao mesmo método que bloqueou a loja 5 (MISUSE em ConsultarOrdemProducao). Coluna própria, padrão false = mantém
--    exatamente o comportamento atual. Religar é decisão separada (UPDATE por loja).
-- 2. _sugestao_ops_abertas: loja recém-ligada ainda não tem `aberta_omie` preenchido; só usa o espelho de OPs abertas
--    depois que o cron sync-ops-abertas leu a lista inteira pelo menos uma vez (estado com `lido_em`).
set lock_timeout = '5s';

alter table public.lojas add column if not exists omie_op_tempo_real boolean not null default false;
comment on column public.lojas.omie_op_tempo_real is
  'true = webhook consulta a OP no Omie a cada aviso e o cron sync-reconciliar-op confere OPs fantasmas (D5, 250). Independe de espelho_completo.';

create or replace function public._sugestao_ops_abertas(p_loja bigint, p_proj_fim date)
returns table (produto bigint, quantidade numeric, itens jsonb)
language sql stable security invoker set search_path = public as $$
  select o.identificacao_n_cod_produto, coalesce(o.identificacao_n_qtde, o.quantidade, 0),
         case when jsonb_typeof(o.full_object->'itensDetalhes') = 'array' then o.full_object->'itensDetalhes' else '[]'::jsonb end
    from ordens_producao o join lojas l on l.id = o.loja_id
   where o.loja_id = p_loja
     and case when coalesce(l.espelho_completo, false)
                   and exists (select 1 from espelho_sync_estado s
                                where s.loja_id = l.id and s.frente = 'ops-abertas' and s.estado ? 'lido_em')
              then coalesce(o.aberta_omie, false)
              else not coalesce(o.concluida, false) end
     and (o.identificacao_d_dt_previsao is null or o.identificacao_d_dt_previsao <= p_proj_fim)
$$;

notify pgrst, 'reload schema';
