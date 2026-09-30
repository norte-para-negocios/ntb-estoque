-- Local de baixa por produto (2026-09-30): { "<SKU>": <codigo_local_estoque do Omie> }.
-- Vence o setor e o destino. Existe pra separar ONDE O PRODUTO BAIXA de ONDE ELE IMPRIME
-- (ex.: embalagem de pizza baixa na PIZZA, mas não imprime comanda na pizzaria).
alter table lojas add column if not exists local_estoque_por_produto jsonb;
