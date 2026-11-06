-- 420 — Fase 12 (velocidade): vendas_proprio_cmv sem a junção cara por LIKE. Só LEITURA: muda a forma da consulta,
-- não o resultado. Plano: docs/superpowers/plans/2026-11-03-norte-erp-plano-mestre.md (Fase 12).
-- Depende da 315 (definição atual da view, lendo estoque_movimentos_efetivo).
--
-- POR QUÊ: lucro_proprio (DRE, /relatorio-cmv, home) lê vendas_proprio_cmv, que casava cada venda com a baixa dela por
--   m.ref = v.pedido_ref OR m.ref LIKE v.pedido_ref || '|%'
-- O OR com LIKE de padrão variável não vira hash/merge join: o Postgres fazia, para CADA venda, duas buscas no índice
-- trigram de ref (estoque_movimentos_ref_trgm), ~17 ms por venda. Medido em produção em 06/11/2026 (ODARA, 325 vendas):
--   view inteira 1,8 s; lucro_proprio(15, out–nov, 'mes') 2,1 a 6,6 s (EXPLAIN ANALYZE: 6,6 s, 59 mil buffers só nisso).
--
-- O QUE MUDA: a chave da venda no ref é o texto antes do 1º '|' (ref = pedido_ref, ou pedido_ref|produto). A junção
-- ganha a igualdade split_part(m.ref,'|',1) = split_part(v.pedido_ref,'|',1), que o Postgres resolve por hash/merge, e
-- MANTÉM a condição antiga (=, LIKE) como filtro. A igualdade nova é consequência da antiga sempre que pedido_ref não
-- tem curinga do LIKE (%, _ ou \); para esses (nenhum hoje: 0 de 325) vale a regra antiga sem atalho (2º ramo do
-- UNION ALL). Ou seja: as mesmas linhas, para qualquer pedido_ref.
--
-- PROVA (produção, sem gravar nada, temp view na sessão): view antiga × nova = 1.154 linhas, 0 diferenças (EXCEPT ALL
-- nos dois sentidos); lucro_proprio antigo × novo nas lojas 15 e 19, dimensões mes/produto/familia/tipo/dia, períodos
-- out–nov/2026, 01–05/11/2026 e 2025–2026: 0 diferenças em todos os 30 casos. Tempo: view 1.835 ms → 32 ms;
-- lucro_proprio(15, out–nov, 'mes') 6.659 ms → 138 ms (EXPLAIN ANALYZE). Script: scripts/testes-sql/420_vendas_proprio_cmv_rapida.sql.
--
-- Sem índice novo (a junção por igualdade não precisa: ver o plano no script de prova). lucro_proprio e
-- corrigir_data_entradas_compra só leem a view e não são recriadas. Colunas, tipos, security_invoker e grants iguais.
-- Aplicar: node scripts/aplicar-migration.mjs supabase/migrations/420_vendas_proprio_cmv_rapida.sql
-- Conferir: select pg_get_viewdef('vendas_proprio_cmv') like '%chave%'; e /financeiro/dre da ODARA (mesmos números).
-- Reverter: recriar a view com a definição da 315 (create or replace, mesmas colunas).

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
