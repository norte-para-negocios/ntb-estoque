-- Reuniao 09/07: "frente de loja" / PDV -- ao cadastrar um produto, poder
-- marcar se ele vai pra frente de loja (PDV). So esses produtos vao pro
-- cardapio do NTB Vendas. Puramente local: o Omie nao tem esse conceito,
-- entao nunca e enviado por IncluirProduto/AlterarProduto (mesmo padrao do
-- estoque_minimo, que ja e override so-local).

alter table produtos
  add column if not exists pdv boolean not null default false;
