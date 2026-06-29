-- Índice único parcial: permite ON CONFLICT (loja_id, id_ajuste) para o sync Omie
CREATE UNIQUE INDEX IF NOT EXISTS movimentos_loja_id_ajuste_unique
  ON public.movimentos (loja_id, id_ajuste)
  WHERE id_ajuste IS NOT NULL;
