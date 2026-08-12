-- Fase 2b (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2b-tabelas-restantes-design.md. Só profiles nesta
-- migration -- é a peça de maior risco desta fase (nova function,
-- policy mais complexa que o padrão já usado), testada isoladamente
-- antes de tocar as outras 4 tabelas (lição do incidente de recursão da
-- Fase 2a, ver AGENTS.md). Não referencia profiles dentro da própria
-- policy -- só loja_user (via join), evitando o mesmo padrão recursivo.

create or replace function usuario_compartilha_loja(p_outro_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from loja_user lu1
    join loja_user lu2 on lu1.loja_id = lu2.loja_id
    where lu1.user_id = auth.uid() and lu2.user_id = p_outro_user_id
  );
$$;

revoke all on function usuario_compartilha_loja(uuid) from public;
grant execute on function usuario_compartilha_loja(uuid) to anon, authenticated;

alter table profiles enable row level security;
create policy profiles_select_por_acesso on profiles for select using (
  id = auth.uid()
  or usuario_e_admin()
  or usuario_compartilha_loja(id)
);
