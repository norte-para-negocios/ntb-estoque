-- Migration 048: adicionar coluna observacao em ordens_producao
-- O UPDATE em massa (zerar full_object em 279k linhas) roda via script de batch:
-- node scripts/limpar-full-object-ops.mjs

ALTER TABLE ordens_producao
  ADD COLUMN IF NOT EXISTS observacao TEXT;
