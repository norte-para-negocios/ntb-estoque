-- Observação da transferência (2026-09-30, pedido do Ramon): justificar o tipo da
-- avaria. Geral (transferencias.observacao) e por item (movimentos.obs_item);
-- `movimentos.obs` continua sendo o carimbo de quem fez.
alter table transferencias add column if not exists observacao text;
alter table movimentos add column if not exists obs_item text;
