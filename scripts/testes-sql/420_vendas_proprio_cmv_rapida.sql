-- Prova da migration 420 (vendas_proprio_cmv sem a junção por LIKE). Só LEITURA: tudo dentro de BEGIN ... ROLLBACK,
-- comparações em tabelas temporárias. Rodar como dono da view (supabase_admin):
--   docker exec -i supabase-db psql -U supabase_admin -d postgres -X -v ON_ERROR_STOP=1 < scripts/testes-sql/420_vendas_proprio_cmv_rapida.sql
-- Esperado: as três linhas "difs" com 0 e a view de volta à definição da 315 depois do ROLLBACK.
-- Resultado em produção (06/11/2026, ODARA): difs view 0 (1.154 linhas), difs mes 0, difs produto 0;
-- lucro_proprio(15, out–nov, 'mes') 231–390 ms com a 420 aplicada dentro da transação (antes: 2,1 a 6,6 s).
-- Trava a view (AccessExclusive) só enquanto a transação dura (menos de 1 s): rodar fora do horário de pico.
set statement_timeout='60s';
create temp table a1 as select * from lucro_proprio(15,'2026-10-01','2026-11-30','mes');
create temp table a2 as select * from lucro_proprio(15,'2026-11-01','2026-11-30','produto');
create temp table a3 as select * from vendas_proprio_cmv;
begin;
set local lock_timeout='1s';

-- (corpo copiado de supabase/migrations/420_vendas_proprio_cmv_rapida.sql)
create or replace view public.vendas_proprio_cmv with (security_invoker = true) as
WITH vendas AS (
         SELECT v.id, v.loja_id, v.pedido_ref, split_part(v.pedido_ref, '|'::text, 1) AS chave
           FROM vendas_proprio v
        ), movs AS (
         -- caminho normal: pedido_ref sem curinga do LIKE (%, _ ou \); a chave (texto antes do 1º '|') vira igualdade (hash/índice)
         SELECT v.id AS venda_id,
            v.loja_id,
                CASE
                    WHEN m_1.ref = v.pedido_ref THEN m_1.codigo_produto
                    ELSE NULLIF(split_part(m_1.ref, '|'::text, 2), ''::text)::bigint
                END AS produto_vendido,
            m_1.id,
            m_1.quantidade,
            m_1.custo_unitario
           FROM vendas v
             JOIN estoque_movimentos_efetivo m_1 ON m_1.loja_id = v.loja_id AND m_1.origem = 'VENDA'::text
              AND split_part(m_1.ref, '|'::text, 1) = v.chave
              AND (m_1.ref = v.pedido_ref OR m_1.ref ~~ (v.pedido_ref || '|%'::text))
          WHERE v.pedido_ref !~ '[%_\\]'::text
        UNION ALL
         -- pedido_ref com curinga do LIKE (nenhum hoje): a regra de antes, sem atalho
         SELECT v.id AS venda_id,
            v.loja_id,
                CASE
                    WHEN m_1.ref = v.pedido_ref THEN m_1.codigo_produto
                    ELSE NULLIF(split_part(m_1.ref, '|'::text, 2), ''::text)::bigint
                END AS produto_vendido,
            m_1.id,
            m_1.quantidade,
            m_1.custo_unitario
           FROM vendas v
             JOIN estoque_movimentos_efetivo m_1 ON m_1.loja_id = v.loja_id AND m_1.origem = 'VENDA'::text
              AND (m_1.ref = v.pedido_ref OR m_1.ref ~~ (v.pedido_ref || '|%'::text))
          WHERE v.pedido_ref ~ '[%_\\]'::text
        ), est AS (
         SELECT estoque_movimentos.reverses_id,
            sum(estoque_movimentos.quantidade * COALESCE(estoque_movimentos.custo_unitario, 0::numeric)) AS valor
           FROM estoque_movimentos_efetivo estoque_movimentos
          WHERE estoque_movimentos.reverses_id IS NOT NULL
          GROUP BY estoque_movimentos.reverses_id
        )
 SELECT m.venda_id,
    m.loja_id,
    m.produto_vendido AS codigo_produto,
    round(- (sum(m.quantidade * COALESCE(m.custo_unitario, 0::numeric)) + COALESCE(sum(e.valor), 0::numeric)), 4) AS cmv,
    count(*) FILTER (WHERE COALESCE(m.custo_unitario, 0::numeric) = 0::numeric) AS movimentos_sem_custo,
    count(*) AS movimentos
   FROM movs m
     LEFT JOIN est e ON e.reverses_id = m.id
  GROUP BY m.venda_id, m.loja_id, m.produto_vendido
;
create temp table b1 as select * from lucro_proprio(15,'2026-10-01','2026-11-30','mes');
create temp table b2 as select * from lucro_proprio(15,'2026-11-01','2026-11-30','produto');
select 'difs view', count(*) from ((select * from a3 except all select * from vendas_proprio_cmv) union all (select * from vendas_proprio_cmv except all select * from a3)) d;
select 'difs mes', count(*) from ((select * from a1 except all select * from b1) union all (select * from b1 except all select * from a1)) d;
select 'difs produto', count(*) from ((select * from a2 except all select * from b2) union all (select * from b2 except all select * from a2)) d;
rollback;
select 'versao nova ainda ativa? (esperado f)', pg_get_viewdef('vendas_proprio_cmv') like '%chave%';
