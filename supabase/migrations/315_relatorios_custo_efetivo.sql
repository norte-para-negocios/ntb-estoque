-- 315 — Relatórios do estoque próprio leem o custo efetivo (Norte ERP, custo certo, Task 5, 04/11/2026). Depende da 311.
--
-- vendas_proprio_cmv (CMV por venda × produto, base do lucro_proprio e do /relatorio-cmv da loja própria) e kardex_proprio
-- (/movimentacoes da loja própria) passam a ler estoque_movimentos_efetivo: custo e data da ÚLTIMA revisão quando houver.
-- Sem revisão a saída é idêntica à de hoje (provado na cópia: scripts/testes-sql/315_relatorios_custo_efetivo.sql compara
-- antes × depois). lucro_proprio não precisa ser recriado: só lê vendas_proprio_cmv.
-- Definições copiadas de pg_get_viewdef / pg_get_functiondef em PRODUÇÃO (04/11/2026); mudou só a fonte (e o kardex
-- devolve também revisado, revisado_em, custo_original, data_ref_original para a tela mostrar "custo revisado em dd/mm").
-- Modo Omie: nada muda (nenhuma das duas é lida por loja Omie).
--
-- Aplicar com -1 depois de 01:00: node scripts/aplicar-migration.mjs supabase/migrations/315_relatorios_custo_efetivo.sql
-- Conferir: select pg_get_viewdef('vendas_proprio_cmv') like '%estoque_movimentos_efetivo%'; \df kardex_proprio (1 overload).

create or replace view public.vendas_proprio_cmv with (security_invoker = true) as
WITH movs AS (
         SELECT v.id AS venda_id,
            v.loja_id,
                CASE
                    WHEN m_1.ref = v.pedido_ref THEN m_1.codigo_produto
                    ELSE NULLIF(split_part(m_1.ref, '|'::text, 2), ''::text)::bigint
                END AS produto_vendido,
            m_1.id,
            m_1.quantidade,
            m_1.custo_unitario
           FROM vendas_proprio v
             JOIN estoque_movimentos_efetivo m_1 ON m_1.loja_id = v.loja_id AND m_1.origem = 'VENDA'::text AND (m_1.ref = v.pedido_ref OR m_1.ref ~~ (v.pedido_ref || '|%'::text))
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
  GROUP BY m.venda_id, m.loja_id, m.produto_vendido;

CREATE OR REPLACE FUNCTION public.kardex_proprio(p_loja bigint, p_ini date, p_fim date, p_texto text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_origem text DEFAULT NULL::text, p_local bigint DEFAULT NULL::bigint, p_familia text DEFAULT NULL::text, p_usuario text DEFAULT NULL::text, p_so_negativos boolean DEFAULT false, p_so_estornos boolean DEFAULT false, p_ord text DEFAULT 'data'::text, p_dir text DEFAULT 'desc'::text, p_limite integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_t text := nullif(btrim(coalesce(p_texto, '')), ''); v_u text := nullif(btrim(coalesce(p_usuario, '')), '');
        v_res jsonb; v_asc boolean := lower(coalesce(p_dir, 'desc')) = 'asc';
begin
  with base as (
    select m.*, pr.codigo as p_codigo, pr.descricao as p_descricao, pr.unidade as p_unidade, pr.descricao_familia as p_familia,
           l.descricao as l_nome, pf.name as u_nome
      from estoque_movimentos_efetivo m -- 315: custo e data efetivos (última revisão)
      left join produtos pr on pr.loja_id = m.loja_id and pr.codigo_produto = m.codigo_produto
      left join local_estoques l on l.loja_id = m.loja_id and l.codigo_local_estoque = m.codigo_local_estoque
      left join profiles pf on pf.id::text = m.user_id
     where m.loja_id = p_loja
       and (p_ini is null or m.data_ref >= p_ini) and (p_fim is null or m.data_ref <= p_fim)
       and (p_tipo is null or p_tipo = '' or m.tipo = p_tipo)
       and (p_origem is null or p_origem = '' or
            case p_origem
              when 'AJUSTE' then m.origem in ('MANUAL', 'SALDO_INICIAL')
              else m.origem = p_origem end)
       and (p_local is null or m.codigo_local_estoque = p_local)
       and (p_familia is null or p_familia = '' or pr.descricao_familia = p_familia)
       and (not p_so_negativos or m.saldo_apos < 0)
       and (not p_so_estornos or m.tipo = 'EST' or m.reverses_id is not null
            or exists (select 1 from estoque_movimentos e where e.reverses_id = m.id))
       and (v_u is null or coalesce(m.user_id, '') ilike '%' || v_u || '%' or coalesce(pf.name, '') ilike '%' || v_u || '%')
       and (v_t is null or pr.descricao ilike '%' || v_t || '%' or pr.codigo ilike '%' || v_t || '%'
            or m.ref ilike '%' || v_t || '%' or coalesce(m.obs, '') ilike '%' || v_t || '%'
            or coalesce(m.user_id, '') ilike '%' || v_t || '%' or coalesce(pf.name, '') ilike '%' || v_t || '%'
            or coalesce(m.transferencia_ref, '') ilike '%' || v_t || '%')
  ), tot as (
    select count(*) as total,
           coalesce(sum(case when tipo <> 'TRF' and quantidade > 0 then quantidade end), 0) as entradas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade < 0 then -quantidade end), 0) as saidas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade > 0 then quantidade * coalesce(custo_unitario, 0) end), 0) as valor_entradas,
           coalesce(sum(case when tipo <> 'TRF' and quantidade < 0 then -quantidade * coalesce(custo_unitario, 0) end), 0) as valor_saidas
      from base
  ), pag as (
    select b.*, (select e.id from estoque_movimentos e where e.reverses_id = b.id limit 1) as estornado_por
      from base b
     order by
       case when p_ord = 'data' and v_asc then b.id end asc, case when p_ord = 'data' and not v_asc then b.id end desc,
       case when p_ord = 'produto' and v_asc then b.p_descricao end asc, case when p_ord = 'produto' and not v_asc then b.p_descricao end desc,
       case when p_ord = 'quantidade' and v_asc then b.quantidade end asc, case when p_ord = 'quantidade' and not v_asc then b.quantidade end desc,
       case when p_ord = 'saldo' and v_asc then b.saldo_apos end asc, case when p_ord = 'saldo' and not v_asc then b.saldo_apos end desc,
       case when p_ord = 'custo' and v_asc then b.custo_unitario end asc, case when p_ord = 'custo' and not v_asc then b.custo_unitario end desc,
       case when p_ord = 'local' and v_asc then b.l_nome end asc, case when p_ord = 'local' and not v_asc then b.l_nome end desc,
       case when p_ord = 'tipo' and v_asc then b.tipo end asc, case when p_ord = 'tipo' and not v_asc then b.tipo end desc,
       case when p_ord = 'origem' and v_asc then b.origem end asc, case when p_ord = 'origem' and not v_asc then b.origem end desc,
       b.id desc
     limit greatest(1, least(coalesce(p_limite, 50), 20000)) offset greatest(0, coalesce(p_offset, 0))
  )
  select jsonb_build_object(
    'total', (select total from tot), 'entradas', (select entradas from tot), 'saidas', (select saidas from tot),
    'valor_entradas', (select valor_entradas from tot), 'valor_saidas', (select valor_saidas from tot),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'quando', created_at, 'data_ref', data_ref, 'tipo', tipo, 'origem', origem, 'ref', ref, 'linha', linha,
        'quantidade', quantidade, 'custo', custo_unitario, 'saldo_apos', saldo_apos, 'user_id', user_id, 'user_nome', u_nome,
        'obs', obs, 'codigo_local', codigo_local_estoque, 'local_nome', l_nome, 'codigo_produto', codigo_produto,
        'codigo', p_codigo, 'descricao', p_descricao, 'unidade', p_unidade, 'reverses_id', reverses_id,
        'estornado_por', estornado_por, 'transferencia_ref', transferencia_ref, 'custo_estimado', custo_estimado,
        'revisado', revisado, 'revisado_em', revisado_em, 'custo_original', custo_original, 'data_ref_original', data_ref_original)
        order by ord) from (select pag.*, row_number() over () as ord from pag) pag), '[]'::jsonb))
  into v_res;
  return v_res;
end $function$;

notify pgrst, 'reload schema';
