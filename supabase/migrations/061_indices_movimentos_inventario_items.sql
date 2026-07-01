-- Corrige timeout real na listagem de Transferencias/Inventarios: o Postgrest
-- monta 2 subselects embutidos (count + status) em movimentos/inventario_items
-- por linha listada, e essas tabelas nao tinham indice nas colunas de FK usadas
-- no filtro (transferencia_id / inventario_id) -- so pk(id).
--
-- Sintoma real observado: loja 6 (103k linhas em movimentos, sem indice) dava
-- "canceling statement due to statement timeout" (57014) na pagina
-- /transferencia, que a UI mostrava como lista vazia (sem erro visivel).
-- Lojas com muitas linhas em movimentos (2, 3, 5, 6 -- todas com backfill de
-- ajustes historicos recente) sao as candidatas a esse sintoma.
--
-- CONCURRENTLY: nao bloqueia leitura/escrita durante a criacao (tabelas em uso
-- real). Precisa rodar FORA de uma transacao (nao entra no aplicar-migration.mjs
-- padrao, que executa tudo como uma unica query/transacao implicita).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimentos_transferencia_id
  ON movimentos (transferencia_id)
  WHERE transferencia_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventario_items_inventario_id
  ON inventario_items (inventario_id);
