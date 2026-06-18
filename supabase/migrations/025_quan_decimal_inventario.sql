-- 025: alinha a escala decimal da quantidade do inventario com a da transferencia.
-- inventario_items.quan era numeric(10,2) (so 2 casas), o que arredondava valores
-- como 3,009 para 3,01. Produtos vendidos por peso (KG/L) precisam de mais casas.
-- movimentos.quan ja e numeric(20,6); aqui igualamos o inventario. Ampliar a
-- precisao nao perde dados existentes.
ALTER TABLE inventario_items
  ALTER COLUMN quan TYPE numeric(20, 6);
