-- Reuniao 09/07: Movimentacoes deixa de ser so leitura -- passa a permitir criar
-- um ajuste manual (entrada/saida/perda) direto na tela, alem de so visualizar
-- o historico importado do Omie.
--
-- Convencao: nome sem acento (como o banco guarda). Idempotente (on conflict do
-- nothing).

insert into permissoes (nome) values
  ('Movimentacoes - Criar')
on conflict (nome) do nothing;
