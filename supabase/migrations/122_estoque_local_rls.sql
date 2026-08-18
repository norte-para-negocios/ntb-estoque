-- Fecha o gap achado na revisão da Task 1 do plano de estoque local
-- (docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md):
-- as 3 tabelas novas (migration 121) ficaram sem RLS e com grant de
-- escrita pra anon/authenticated -- mesma classe de gap já fechada
-- pras outras tabelas loja_id-escopadas deste repo (ver "Contenção de
-- RLS" no AGENTS.md, migrations 109-116). Toda escrita nestas 3
-- tabelas vem de código server-side com createServiceClient (service
-- role, ignora RLS/grants) -- revogar escrita de anon/authenticated
-- não quebra nada do app.

alter table ficha_tecnica_local enable row level security;
create policy ficha_tecnica_local_select_por_loja on ficha_tecnica_local for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on ficha_tecnica_local from anon, authenticated;

alter table estoque_local_saldos enable row level security;
create policy estoque_local_saldos_select_por_loja on estoque_local_saldos for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on estoque_local_saldos from anon, authenticated;

alter table movimentos_locais enable row level security;
create policy movimentos_locais_select_por_loja on movimentos_locais for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on movimentos_locais from anon, authenticated;
