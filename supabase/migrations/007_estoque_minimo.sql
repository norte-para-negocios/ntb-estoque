-- Estoque minimo definido no NTB Estoque. No Omie o campo vem 0 em todos os
-- produtos, entao o minimo passa a ser definido aqui, por produto/loja.
-- Base da sugestao de compra: alerta quando o saldo atual <= estoque_minimo.

alter table produtos add column if not exists estoque_minimo numeric(20,6);
