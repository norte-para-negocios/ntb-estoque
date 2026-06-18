-- Fix: o ON CONFLICT do upsert NAO infere indice unico PARCIAL (erro 42P10).
-- Troca os indices unicos parciais (where ... is not null) por CONSTRAINTS unicas
-- plenas. Em Postgres NULLs sao distintos numa unique constraint, entao registros
-- locais (codigo_omie/codigo_familia = NULL) nao colidem entre si. Idempotente.

-- Familias
drop index if exists uq_familias_loja_codomie;
alter table familias drop constraint if exists uq_familias_loja_codomie;
alter table familias add constraint uq_familias_loja_codomie unique (loja_id, codigo_familia);

-- Fornecedores
drop index if exists uq_fornecedores_loja_codomie;
alter table fornecedores drop constraint if exists uq_fornecedores_loja_codomie;
alter table fornecedores add constraint uq_fornecedores_loja_codomie unique (loja_id, codigo_omie);

-- Clientes
drop index if exists uq_clientes_loja_codomie;
alter table clientes drop constraint if exists uq_clientes_loja_codomie;
alter table clientes add constraint uq_clientes_loja_codomie unique (loja_id, codigo_omie);
