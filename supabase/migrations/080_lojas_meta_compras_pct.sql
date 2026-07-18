alter table lojas
  add column if not exists meta_compras_pct numeric check (meta_compras_pct between 0 and 100);
