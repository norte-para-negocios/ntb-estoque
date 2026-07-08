-- Prepara notas_fiscais para uma futura origem além do Omie (consulta direta à SEFAZ,
-- quando o certificado digital de teste/produção estiver disponível). O dedup de hoje
-- (onConflict loja_id,n_id_receb) só funciona pra registros vindos do Omie -- um insert
-- futuro vindo da SEFAZ não vai ter n_id_receb, então o dedup real entre as duas origens
-- passa a ser pela chave de acesso da NFe/NFCe (c_chave_nfe), que é a mesma
-- independentemente de quem consultou.

alter table notas_fiscais
  add column if not exists origem varchar(10) not null default 'omie'
  check (origem in ('omie', 'sefaz'));

create unique index if not exists notas_fiscais_loja_chave_nfe_unique
  on public.notas_fiscais (loja_id, c_chave_nfe)
  where c_chave_nfe is not null and deleted_at is null;
