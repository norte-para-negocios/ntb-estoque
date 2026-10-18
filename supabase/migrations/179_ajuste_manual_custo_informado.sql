-- 179: entrada manual no Omie com o custo unitário digitado (Fase A, Task 11; matriz L3 / G2.6). Até aqui toda
-- entrada manual ia pelo custo médio lido na hora; o Omie aceita o valor digitado e faz a média com ele (regra E9).
-- Guardado na linha para o retry reenviar com o mesmo custo. Vazio = comportamento de sempre (a Central não usa).
alter table movimentos add column if not exists custo_informado numeric
  check (custo_informado is null or (custo_informado > 0 and custo_informado < 10000000));

notify pgrst, 'reload schema';
