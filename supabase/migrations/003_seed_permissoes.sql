-- Seed das 16 permissoes fixas (do PermissaoSeeder do Laravel)
insert into permissoes (nome) values
  ('Notas Fiscais'),
  ('Notas Fiscais - Sincronizar'),
  ('Ordens de Producao'),
  ('Ordens de Producao - Sincronizar'),
  ('Inventarios - Ver'),
  ('Inventarios - Criar'),
  ('Inventarios - Editar'),
  ('Inventarios - Excluir'),
  ('Transferencias - Ver'),
  ('Transferencias - Criar'),
  ('Transferencias - Editar'),
  ('Transferencias - Excluir'),
  ('Produtos'),
  ('Produtos - Sincronizar'),
  ('Locais de Estoque'),
  ('Locais de Estoque - Sincronizar')
on conflict (nome) do nothing;
