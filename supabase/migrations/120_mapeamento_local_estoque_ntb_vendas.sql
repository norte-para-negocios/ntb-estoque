-- Ordem de Producao usar o local de estoque certo conforme onde o item foi
-- preparado (2026-08-16, pedido explicito do usuario): pedido feito na
-- Cozinha do ntb-vendas deve gerar/consumir no local de estoque "Cozinha"
-- daqui, pedido feito no Bar no local "Bar" -- em vez de tudo cair sempre no
-- local padrao do Omie (o que a integracao sempre fez ate hoje, por nunca
-- ter passado nenhum codigo_local_estoque pro IncluirOrdemProducao).
--
-- Guarda o CODIGO OMIE do local (local_estoques.codigo_local_estoque), nao
-- o id local -- e o valor que incluirOrdemProducao ja aceita direto
-- (parametro codigoLocalEstoque), sem precisar de join. Cada loja escolhe,
-- entre os locais que ela mesma ja cadastrou (/local-estoque, nome livre --
-- "Cozinha 1", "Bar 2" etc.), qual representa "a" cozinha e "o" bar pra
-- efeito dessa automacao. Loja que nunca configurar continua caindo no
-- comportamento de sempre (local padrao do Omie, sem localizacao explicita).

alter table lojas add column if not exists local_estoque_cozinha_codigo integer;
alter table lojas add column if not exists local_estoque_bar_codigo integer;
