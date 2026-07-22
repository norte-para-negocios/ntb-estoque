-- 086_impressao_etiquetas_origem_catalogo.sql
-- Catalogo A4 de QR codes (grade 3x6, impressao em lote) precisa de um
-- quarto valor de origem pro historico de impressoes, distinto da etiqueta
-- avulsa (PRODUTO).
alter table impressao_etiquetas drop constraint impressao_etiquetas_origem_check;
alter table impressao_etiquetas add constraint impressao_etiquetas_origem_check
  check (origem in ('NF', 'OP', 'PRODUTO', 'CATALOGO'));
