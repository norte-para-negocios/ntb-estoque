-- Fix da revisão da Task 2 (Fase 2b, 2026-08-12): a policy de
-- `permissoes` (migration 114) usava `role()` sem qualificar o schema.
-- `authenticated`/`anon` não têm `auth` no search_path por padrão (só
-- `supabase_admin` tem, o que mascarou o bug ao validar via psql como
-- supabase_admin) -- em produção real (PostgREST, role authenticated de
-- verdade) isso falhava com "function role() does not exist" em toda
-- leitura de `permissoes` pelo app. Corrigido pra `auth.role()`, mesmo
-- padrão já usado em cargos/cargo_permissao (migration 046).

alter policy permissoes_select_auth on permissoes using (
  auth.role() = 'authenticated'
);
