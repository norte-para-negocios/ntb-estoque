-- Fix da revisão final da Fase 2b (2026-08-12): AdminLoja não conseguia
-- ver usuários pendentes de aprovação (profiles com status='pendente',
-- que nunca têm linha em loja_user por definição -- são cadastros sem
-- loja ainda). A policy de profiles (migration 113) só cobre
-- usuario_e_admin() (Admin global/super_admin) ou usuario_compartilha_loja
-- (que sempre falha pra quem não tem loja nenhuma) -- AdminLoja ficava
-- sem ver a fila de aprovação, quebrando o fluxo já documentado no
-- comentário de app/(app)/usuario/page.tsx. Function nova, mesma
-- assinatura de segurança das outras (security definer, só lê a PRÓPRIA
-- linha do usuário logado -- não introduz recursão, mesmo consultando
-- profiles, porque não itera sobre outras linhas de profiles).

create or replace function usuario_pode_aprovar_pendentes()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from profiles pr
    where pr.id = auth.uid()
      and (pr.perfil = 'Admin' or pr.perfil = 'AdminLoja' or pr.is_super_admin = true)
  );
$$;

revoke all on function usuario_pode_aprovar_pendentes() from public;
grant execute on function usuario_pode_aprovar_pendentes() to anon, authenticated;

alter policy profiles_select_por_acesso on profiles using (
  id = auth.uid()
  or usuario_e_admin()
  or usuario_compartilha_loja(id)
  or (status = 'pendente' and usuario_pode_aprovar_pendentes())
);
