-- Corrige duas constraints da tabela movimentos que estavam impedindo inserts/updates
-- silenciosamente (Supabase devolvia null sem erro visível na UI):
--
-- 1. tipo: a constraint original ('ENT','SAI','SLD','TRF') não incluia 'TPQ'
--    (Transferencia de Perda/Quebra). Todo addMovimento numa TPQ falhava sem avisar.
--
-- 2. status: a constraint original não incluia 'Sem CMC'. O update em processarMovimento
--    tentava gravar 'Sem CMC' e falhava silenciosamente, deixando o status em 'Processando'.
--
-- Solução: dropar as constraints inline e recriar com os valores corretos.
-- O nome das constraints inline em Postgres é <tabela>_<coluna>_check.

ALTER TABLE movimentos
  DROP CONSTRAINT IF EXISTS movimentos_tipo_check;

ALTER TABLE movimentos
  ADD CONSTRAINT movimentos_tipo_check
  CHECK (tipo IN ('ENT','SAI','SLD','TRF','TPQ'));

ALTER TABLE movimentos
  DROP CONSTRAINT IF EXISTS movimentos_status_check;

ALTER TABLE movimentos
  ADD CONSTRAINT movimentos_status_check
  CHECK (status IN ('Iniciado','Processando','Concluido','Erro','Sem CMC'));
