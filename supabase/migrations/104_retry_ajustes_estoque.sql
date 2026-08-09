-- 104_retry_ajustes_estoque.sql
alter table inventario_items
  add column if not exists tentativas integer not null default 0,
  add column if not exists ultima_tentativa_em timestamptz;

alter table movimentos
  add column if not exists tentativas integer not null default 0,
  add column if not exists ultima_tentativa_em timestamptz;
