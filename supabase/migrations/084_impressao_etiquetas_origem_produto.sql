-- 084_impressao_etiquetas_origem_produto.sql
-- Etiqueta de produto (nome+QR+logo, sem NF/OP de origem) precisa de um
-- terceiro valor de origem pro historico de impressoes.
alter table impressao_etiquetas drop constraint impressao_etiquetas_origem_check;
alter table impressao_etiquetas add constraint impressao_etiquetas_origem_check
  check (origem in ('NF', 'OP', 'PRODUTO'));
