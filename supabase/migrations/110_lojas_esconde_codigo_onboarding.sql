-- Fix da revisão final da Contenção de RLS Fase 0 (2026-08-12): a migration
-- 109 deixou codigo_onboarding fora da lista de exclusão -- essa coluna não
-- é metadado, é a credencial de auto-cadastro usada em lib/actions/
-- cadastro.ts (quem lê o valor consegue se auto-aprovar numa loja). Revoga
-- só essa coluna especificamente, sem reconstruir o resto do grant (que já
-- está correto).

revoke select (codigo_onboarding) on lojas from anon, authenticated;
