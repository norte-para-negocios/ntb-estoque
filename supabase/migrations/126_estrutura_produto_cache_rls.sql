-- Fecha o mesmo gap que a migration 122 já fechou pras 3 tabelas irmãs de
-- estoque local: a tabela nova da migration 125 (estrutura_produto_cache,
-- ficha técnica em cache pras lojas REAIS) nasceu sem RLS e com grant de
-- escrita pra anon/authenticated -- padrão de contenção já documentado no
-- AGENTS.md ("Contenção de RLS", migrations 109-116 e 122). Toda escrita
-- nesta tabela vem de código server-side com createServiceClient (service
-- role, ignora RLS/grants) -- revogar escrita de anon/authenticated não
-- quebra nada do app.
--
-- APLICAÇÃO (2026-08-18): aplicada INTEIRA no Postgres self-hosted do
-- Contabo (produção de verdade) -- ALTER TABLE / CREATE POLICY / REVOKE ok,
-- conferido em pg_class.relrowsecurity + pg_policies. No Supabase Cloud
-- (projeto waubqgkftwrufepwhctc, descontinuado, hoje só serve o .env.local
-- de dev -- ver AGENTS.md ".env.local local aponta pro Supabase cloud
-- descontinuado") só o REVOKE foi aplicado: as functions
-- usuario_tem_acesso_loja/usuario_e_admin NÃO existem lá (todo o programa
-- de contenção de RLS, migrations 109-116 e 122, nunca foi aplicado
-- naquele banco -- nem `lojas` tem RLS ligada). Ligar RLS lá sem policy
-- funcional só bloquearia leitura sem ganho de segurança real, então o
-- ALTER TABLE/CREATE POLICY fica pendente até (se algum dia) a contenção
-- de RLS ser replicada no Cloud.

alter table estrutura_produto_cache enable row level security;
create policy estrutura_produto_cache_select_por_loja on estrutura_produto_cache for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on estrutura_produto_cache from anon, authenticated;
