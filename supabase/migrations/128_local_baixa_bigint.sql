-- Códigos de local de estoque do Omie passam de 2,1 bilhões (ex.: BAR = 2354627389): coluna integer não cabe.
alter table lojas
  alter column local_estoque_cozinha_codigo type bigint,
  alter column local_estoque_bar_codigo type bigint;
