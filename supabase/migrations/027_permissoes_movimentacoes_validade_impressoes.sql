-- Fase 4 (bloco de permissoes, parte 3): permissoes de acesso para os modulos
-- Movimentacoes, Validade e Impressoes.
--
-- Antes esses tres modulos ficavam visiveis a qualquer usuario autenticado (derivavam
-- de outras permissoes ou nao tinham gating proprio). Agora cada um tem sua propria
-- permissao de acesso, permitindo controle granular por usuario.
--
-- Convencao: nome sem acento (como o banco guarda). Sao modulos de LEITURA; nao ha
-- acoes de escrita (nao existe Criar/Editar/Excluir nesses modulos).
-- Idempotente (on conflict do nothing).

insert into permissoes (nome) values
  ('Movimentacoes'),
  ('Validade'),
  ('Impressoes')
on conflict (nome) do nothing;
