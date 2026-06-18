-- 026: corrige a precisao decimal da quantidade da TRANSFERENCIA (movimentos.quan).
-- O comentario da migration 025 afirmava que movimentos.quan ja era numeric(20,6),
-- mas na verdade ainda estava numeric(10,2): ao digitar 3,009 KG numa transferencia
-- o Omie recebia 3,009 (valor em memoria) mas o banco gravava 3,01 (arredondado),
-- gerando divergencia entre o NTB e o Omie e perdendo precisao ao recarregar a tela.
-- Produtos vendidos por peso (KG/L) precisam de ate 6 casas (gramas/ml).
--
-- Tambem alinhamos os espelhos do sync do Omie (NF e quantidade da OP do cadastro)
-- para guardar a mesma precisao que o Omie envia. Ampliar a escala nao perde dados.
ALTER TABLE movimentos
  ALTER COLUMN quan TYPE numeric(20, 6);

ALTER TABLE nota_fiscal_items
  ALTER COLUMN n_qtde_nfe TYPE numeric(20, 6);

ALTER TABLE ordens_producao
  ALTER COLUMN identificacao_n_qtde TYPE numeric(20, 6);
