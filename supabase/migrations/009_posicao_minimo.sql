-- O ListarPosEstoque do Omie traz estoque_minimo, fisico e reservado por
-- produto/local. Antes a gente so gravava saldo/CMC/preco/pendente, entao o
-- estoque minimo (que o Ramon preenche no Omie) nunca chegava ao sistema e a
-- coluna "Minimo" ficava vazia. Agora a posicao guarda esses tres campos; o
-- campo manual em produtos.estoque_minimo passa a ser apenas override.

alter table posicao_estoques add column if not exists estoque_minimo numeric(20,6);
alter table posicao_estoques add column if not exists fisico numeric(20,6);
alter table posicao_estoques add column if not exists reservado numeric(20,6);
