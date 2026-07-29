-- Item #15 da reuniao 2026-07-27 (pedido do Andrey): dashboard de producao por
-- funcionario. Achado na pesquisa 2026-07-28: nem a Omie nem o app hoje sabem
-- "quem" concluiu uma OP. Decisao validada com o usuario: rastrear a partir de
-- agora quem estava logado no clique de "Concluir OP" (mesmo padrao ja usado em
-- inventarios/transferencias, migration 005). Sem backfill possivel -- OPs
-- concluidas antes desta coluna existir ficam com concluida_por = null pra
-- sempre, tratado como "Nao identificado" no dashboard.
alter table ordens_producao
  add column if not exists concluida_por uuid references profiles(id) on delete set null;

create index if not exists idx_ordens_producao_concluida_por
  on ordens_producao (loja_id, concluida_por)
  where concluida_por is not null;
