-- Fase 2b (2026-08-12), parte 2 -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2b-tabelas-restantes-design.md. Aplicada só depois
-- de profiles (migration 113) validada isoladamente em produção.

alter table lojas enable row level security;
create policy lojas_select_por_loja on lojas for select using (
  usuario_tem_acesso_loja(id) or usuario_e_admin()
);

alter table permissoes enable row level security;
create policy permissoes_select_auth on permissoes for select using (
  role() = 'authenticated'
);

-- outbox e arquivos_mortos: RLS ligada, ZERO policy de SELECT --
-- bloqueio total intencional pra anon/authenticated. service_role
-- continua com acesso total (roles administrativas não são afetadas
-- por RLS).
alter table outbox enable row level security;
alter table arquivos_mortos enable row level security;
