-- Edicao manual de produto no NTB (fonte da verdade = banco, visao de substituir o Omie).
-- O sync de produtos (ListarProdutos -> upsert) sobrescreve descricao, familia, tipo,
-- unidade, valor, ncm e inativo a cada rodada. Para a edicao manual NAO ser apagada,
-- guardamos aqui a lista de campos que o usuario editou a mao; o sync passa a ignorar
-- esses campos por produto (mesma filosofia do override de estoque_minimo).
--
-- Formato: array de nomes de coluna, ex.: ["descricao", "valor_unitario", "inativo"].
-- Default [] = nada editado a mao (sync sobrescreve tudo, comportamento atual).
alter table produtos
  add column if not exists campos_editados jsonb not null default '[]'::jsonb;
