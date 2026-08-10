-- Task 19 (auditoria de retry Omie, 2026-08-09): seção "OPs relacionadas" na
-- tela de detalhe de Nota Fiscal -- mesmo cruzamento aproximado da Task 17/18
-- (produto + loja + janela de tempo), direção oposta: produto da NF -> OPs
-- que usam esse produto como insumo (nIdProdutoMalha dentro de
-- full_object->itensDetalhes).
--
-- Por que uma RPC e não um filtro supabase-js direto (mesmo padrão de
-- lib/relatorio-frio-nf.ts e das outras RPCs `relatorio_*` já existentes):
-- ordens_producao não tem índice em full_object nem nas colunas de data
-- (confirmado via \d ordens_producao) e é uma tabela grande por loja (loja 5:
-- 111.520 linhas, ~10.577 só nos últimos 30 dias). Medido ao vivo antes de
-- escrever esta função:
--   - `full_object @> '{"itensDetalhes":[{"nIdProdutoMalha":X}]}'` sozinho
--     (sem filtro de data empurrado pro mesmo scan): ~640ms-1s POR CÓDIGO de
--     produto na loja 5/6 (seq scan completo da tabela) -- uma NF com p90=15
--     itens diferentes exigiria até 15-30 queries desse tipo (2 casos de
--     janela cada) = minutos de carregamento.
--   - Filtrar primeiro por loja_id + coalesce(dt_conclusao_real,
--     identificacao_d_dt_previsao) NO MESMO WHERE do scan principal (antes do
--     jsonb_array_elements rodar), com TODOS os códigos de produto num único
--     `= any(array)`: 154ms na loja 5 (maior tabela), UMA query cobrindo
--     qualquer quantidade de códigos de produto de uma vez. Motivo: o filtro
--     de data (mesmo sem índice) é avaliado como comparação simples por linha
--     ANTES do unnest mais caro do array de insumos, reduzindo de 111k para
--     ~3k linhas antes da parte cara rodar.
--
-- Não existe filtro supabase-js equivalente seguro pra isso sem cair em
-- `.or()` com strings JSON manualmente escapadas (risco de parsing frágil,
-- mesma classe de cautela já documentada pra filtros dot-path em embed --
-- ver components/movimentacoes/MovimentosTab.tsx) ou em N queries por código
-- de produto (o custo medido acima). Uma função SQL simples resolve os dois
-- problemas de uma vez.
--
-- Fix round 1 (revisão desta task, 2026-08-09) -- Important: a versão
-- original não expunha a data de referência (coalesce(dt_conclusao_real,
-- identificacao_d_dt_previsao)) como coluna própria -- o componente cliente
-- dependia do `order by` INTERNO desta função sobreviver ao `.limit(100)`
-- externo do PostgREST, sem garantia formal disso em SQL padrão (funciona
-- hoje porque o `group by`+agregado impede o planner de subir a subquery,
-- mas é frágil, e o corte é ROTINA aqui, não exceção -- medido: 1.402 linhas
-- batendo só com 3 códigos numa loja). Corrigido adicionando `data_ref` ao
-- retorno -- o componente cliente agora ordena explicitamente por ela antes
-- de aplicar `.limit()`, sem depender de nenhuma garantia implícita de
-- planner.
create or replace function ops_relacionadas_por_produto(
  p_loja_id bigint,
  p_produto_codes bigint[],
  p_data_ini date,
  p_data_fim date
)
returns table (
  id bigint,
  identificacao_n_cod_op bigint,
  identificacao_c_num_op text,
  num_ordem text,
  identificacao_n_cod_produto bigint,
  identificacao_n_qtde numeric,
  identificacao_codigo_local_estoque bigint,
  dt_conclusao_real date,
  identificacao_d_dt_previsao date,
  concluida boolean,
  insumos_batidos bigint[],
  data_ref date
)
language sql stable as $$
  select
    op.id,
    op.identificacao_n_cod_op,
    op.identificacao_c_num_op,
    op.num_ordem,
    op.identificacao_n_cod_produto,
    op.identificacao_n_qtde,
    op.identificacao_codigo_local_estoque,
    op.dt_conclusao_real,
    op.identificacao_d_dt_previsao,
    op.concluida,
    array_agg(distinct (item ->> 'nIdProdutoMalha')::bigint) as insumos_batidos,
    coalesce(op.dt_conclusao_real, op.identificacao_d_dt_previsao) as data_ref
  from ordens_producao op,
       jsonb_array_elements(coalesce(op.full_object -> 'itensDetalhes', '[]'::jsonb)) as item
  where op.loja_id = p_loja_id
    and coalesce(op.dt_conclusao_real, op.identificacao_d_dt_previsao) between p_data_ini and p_data_fim
    and (item ->> 'nIdProdutoMalha') ~ '^\d+$'
    and (item ->> 'nIdProdutoMalha')::bigint = any(p_produto_codes)
  group by op.id, op.identificacao_n_cod_op, op.identificacao_c_num_op, op.num_ordem,
           op.identificacao_n_cod_produto, op.identificacao_n_qtde, op.identificacao_codigo_local_estoque,
           op.dt_conclusao_real, op.identificacao_d_dt_previsao, op.concluida
  order by data_ref desc
$$;
