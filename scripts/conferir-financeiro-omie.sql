-- Financeiro A0: conferência do espelho do financeiro do Omie com as telas do Omie. SÓ LEITURA.
-- Rodar em produção (depois das migrations 305–307 e do deploy):
--   ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
--     "docker exec -i supabase-db psql -U supabase_admin -d postgres -X" < scripts/conferir-financeiro-omie.sql
-- Mês: troque a data em `\set mes` (qualquer dia do mês).
-- Comparar no Omie (mesma loja, mesma hora):
--   * a pagar em aberto  → Finanças › Contas a Pagar, filtro "Em aberto" (todas as datas): total;
--   * pago no mês        → Finanças › Contas a Pagar, "Pagos", período = mês (data do pagamento): total pago;
--   * a receber / recebido no mês → o mesmo em Contas a Receber.
-- Só vale como número final quando a cobertura (2ª consulta) mostra o histórico lido desde 2026-07-01, a varredura de
-- abertos concluída (abertos_em) e nenhum aviso pendente (3ª consulta).
\set mes '2026-10-01'
begin read only;
set local statement_timeout = '60s';

-- 1. Totais por loja: abertos (hoje) e baixas do mês (não canceladas, pela data do pagamento/recebimento).
select loja_id,
       case natureza when 'P' then 'a pagar' else 'a receber' end as tipo,
       abertos_qtd, round(abertos_valor, 2) as em_aberto, round(vencidos_valor, 2) as vencido,
       baixas_mes_qtd, round(baixas_mes_valor, 2) as pago_ou_recebido_no_mes,
       abertos_sem_resumo_atual as abertos_estimados_pelas_baixas, ultima_fonte
from omie_fin_conferencia(:'mes'::date)
order by loja_id, natureza;

-- 2. Cobertura da carga pela API (cursor do cron sync-financeiro).
select loja_id,
       estado->'titulos'->'backfill'->>'coberto_desde' as titulos_desde,
       estado->'baixas'->'backfill'->>'coberto_desde' as baixas_desde,
       estado->'titulos'->'recente'->>'coberto_ate' as lido_ate,
       estado->'abertos'->>'concluido_em' as abertos_em,
       jsonb_array_length(coalesce(estado->'conferir'->'pendentes', '[]')) as a_conferir,
       ultimo_erro, atualizado_em
from espelho_sync_estado where frente = 'financeiro' order by loja_id;

-- 3. Avisos financeiros ainda não processados por loja (cron sync-financeiro-avisos).
select w.loja_id, count(*) as pendentes, min(w.created_at) as mais_antigo
from webhooks w
left join espelho_sync_estado e on e.loja_id = w.loja_id and e.frente = 'fin-avisos'
where w.message->>'topic' like 'Financas.%' and w.id > coalesce((e.estado->>'ultimo_id')::bigint, 0)
  and w.loja_id in (select id from lojas where is_test = false and id <> 4 and modo_estoque = 'omie')
group by 1 order by 1;

-- 4. Pausas/erros da guarda (bloqueio do Omie, erros seguidos).
select loja_id, frente, estado, ultimo_erro, atualizado_em
from espelho_sync_estado where frente in ('guarda-financeiro', 'guarda-loja') order by loja_id, frente;
rollback;
