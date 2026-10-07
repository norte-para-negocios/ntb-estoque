-- 153 — Nota de entrada: depois da ciência o sistema busca o XML completo pela chave (consChNFe). Guarda quando tentou,
-- para no máximo 1 tentativa por nota por hora (evita o consumo indevido 656 da SEFAZ). Aditiva.
alter table public.sefaz_documentos add column if not exists busca_chave_em timestamptz;
