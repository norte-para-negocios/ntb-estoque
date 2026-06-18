-- Fase 4.4 - Admin por loja (multi-admin).
-- A coluna profiles.perfil e varchar livre (default 'Usuario'); nao precisa de
-- mudanca de schema para o novo perfil. Esta migration apenas DOCUMENTA e
-- garante (via CHECK) os tres valores validos, sem quebrar dados existentes.
--
-- Perfis:
--   'Admin'     = admin GLOBAL: todas as lojas, todos os modulos, administracao
--                 global (Lojas, Logs, Saude da integracao, Usuarios).
--   'AdminLoja' = admin DA LOJA: acesso total aos modulos das lojas vinculadas
--                 (loja_user), mas NAO e admin global (nao ve outras lojas nem a
--                 administracao global). Pode haver varios, um ou mais por loja.
--   'Usuario'   = restrito por loja + permissoes escolhidas (permissao_user).
--
-- O admin global atual continua intacto (nenhum 'Admin' e alterado).

-- Normaliza qualquer valor inesperado para 'Usuario' antes do CHECK (seguranca).
update profiles
  set perfil = 'Usuario'
  where perfil is null or perfil not in ('Admin', 'AdminLoja', 'Usuario');

alter table profiles
  drop constraint if exists profiles_perfil_check;

alter table profiles
  add constraint profiles_perfil_check
  check (perfil in ('Admin', 'AdminLoja', 'Usuario'));
