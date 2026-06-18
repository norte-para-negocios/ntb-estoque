-- Fase 4 (bloco de permissoes, parte 1): completa o modelo de permissoes por modulo.
-- Hoje so Transferencias e Inventarios tinham acoes (Ver/Criar/Editar/Excluir). Os
-- demais modulos so tinham "Acessar" (a permissao com o nome do modulo) e "Sincronizar".
-- O fundador quer permissoes COMPLETAS em todos os modulos, com cada botao de acao
-- atras de sua permissao. Aqui criamos as permissoes de ACAO que faltam.
--
-- Convencao de nomes (sem acento, como o banco guarda): "<Modulo> - <Acao>".
-- As permissoes de ACESSO existentes ("Produtos", "Ordens de Producao", "Familias",
-- "Fornecedores", "Locais de Estoque", "Notas Fiscais") sao mantidas como o "ver/acessar"
-- do modulo e NAO sao renomeadas (o MENU_PERMISSAO depende delas).
-- As permissoes "... - Sincronizar" continuam no banco (inertes), mas saem do catalogo:
-- o sync agora e admin-only (perfil 'Admin'), nao depende mais de permissao por usuario.
-- Idempotente (on conflict do nothing).

insert into permissoes (nome) values
  -- Ordens de Producao
  ('Ordens de Producao - Criar'),
  ('Ordens de Producao - Editar'),
  ('Ordens de Producao - Excluir'),
  ('Ordens de Producao - Concluir'),
  ('Ordens de Producao - Reverter'),
  -- Produtos
  ('Produtos - Criar'),
  ('Produtos - Editar'),
  ('Produtos - Excluir'),
  -- Locais de Estoque
  ('Locais de Estoque - Criar'),
  ('Locais de Estoque - Editar'),
  ('Locais de Estoque - Excluir'),
  -- Familias
  ('Familias - Criar'),
  ('Familias - Editar'),
  ('Familias - Excluir'),
  -- Fornecedores
  ('Fornecedores - Criar'),
  ('Fornecedores - Editar'),
  ('Fornecedores - Excluir')
  -- Notas Fiscais: importada do Omie (nao se cria NF aqui). Mantemos so o acesso
  -- ("Notas Fiscais") ja existente; nao ha acao real de escrita na tela.
on conflict (nome) do nothing;
