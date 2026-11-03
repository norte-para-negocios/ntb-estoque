-- 310: toda permissão chega a pelo menos um cargo padrão.
-- Auditoria 2026-11: 56 das 79 permissões não estavam em nenhum cargo (Compras, Financeiro, Notas - Reverter,
-- Fechamento, Transferencias - Entre lojas...), então funcionário com cargo padrão nunca recebia essas telas.
-- Proposta e motivo de cada linha: docs/auditoria/2026-11-norte-erp/05-proposta-permissoes.md.
-- Só os 3 cargos padrão, por nome; cargo criado pelo cliente não é tocado. Idempotente. Não remove nada.
-- Fica de fora de propósito (só Admin/AdminLoja): cadastros (Produtos, Locais, Familias, Fornecedores e as
-- importações), Notas Fiscais - Excluir, Estoque - Corrigir custo, Fechamento - Reabrir mes,
-- Financeiro - Pagar e Categorias, Categorias Contabeis - Criar/Editar/Excluir.
begin;
set lock_timeout = '5s';

with desejo(cargo, permissao) as (values
  -- Gerente (+27)
  ('Gerente','Movimentacoes - Criar'),
  ('Gerente','Categorias Contabeis'),
  ('Gerente','Produto Substituicoes'),
  ('Gerente','Produto Substituicoes - Criar'),
  ('Gerente','Produto Substituicoes - Excluir'),
  ('Gerente','Notas Fiscais - Manifestar'),
  ('Gerente','Notas Fiscais - Manifestar na SEFAZ'),
  ('Gerente','Notas Fiscais - Reverter'),
  ('Gerente','Compras'),
  ('Gerente','Compras - Criar'),
  ('Gerente','Compras - Pedidos'),
  ('Gerente','Compras - Aprovar pedidos'),
  ('Gerente','Compras - Sugestao'),
  ('Gerente','Compras - Requisicoes'),
  ('Gerente','Compras - Devolucao ao fornecedor'),
  ('Gerente','Compras - Emitir NF-e'),
  ('Gerente','Estoque - Lancar no Omie'),
  ('Gerente','Fichas - Trocar insumo'),
  ('Gerente','OP - Acoes em lote'),
  ('Gerente','Correcoes - Executar'),
  ('Gerente','Fechamento - Fechar mes'),
  ('Gerente','Contador - Pacote'),
  ('Gerente','Anexos - Enviar'),
  ('Gerente','Anexos - Excluir'),
  ('Gerente','Transferencias - Entre lojas'),
  ('Gerente','Financeiro - Contas a pagar'),
  ('Gerente','Financeiro - Contas correntes'),
  -- Estoquista (+8)
  ('Estoquista','Movimentacoes - Criar'),
  ('Estoquista','Ordens de Producao'),
  ('Estoquista','Ordens de Producao - Criar'),
  ('Estoquista','Ordens de Producao - Editar'),
  ('Estoquista','Ordens de Producao - Concluir'),
  ('Estoquista','Estoque - Lancar no Omie'),
  ('Estoquista','Transferencias - Entre lojas'),
  ('Estoquista','Anexos - Enviar'),
  -- Conferente (+3)
  ('Conferente','Notas Fiscais'),
  ('Conferente','Compras'),
  ('Conferente','Anexos - Enviar')
)
insert into public.cargo_permissao (cargo_id, permissao_id)
select c.id, p.id
from desejo d
join public.cargos c on c.nome = d.cargo
join public.permissoes p on p.nome = d.permissao
on conflict do nothing;

notify pgrst, 'reload schema';
commit;
