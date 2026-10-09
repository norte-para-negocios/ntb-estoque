-- 156 — Politicas de RLS em "initplan": o acesso do usuario e' calculado UMA vez por consulta, nao uma vez por linha.
-- Antes: (usuario_tem_acesso_loja(loja_id) OR usuario_e_admin()) -- duas chamadas de funcao SECURITY DEFINER por linha lida;
-- uma leitura de ~60 mil itens de NF como usuario logado levava 3 a 5x mais que como admin do banco.
-- Depois: ((select usuario_e_admin()) OR loja_id IN (select usuario_lojas())) -- subconsultas nao correlacionadas, avaliadas 1 vez.
-- Mesma regra de acesso (admin ve tudo; os demais, so as lojas de loja_user). Conferido em 08/10/2026: 4 usuarios x 8 tabelas,
-- contagens identicas antes e depois. Medido: relatorio_compras_total 667->199 ms, matriz 1087->202 ms, dim 601->177 ms.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 156_rls_policies_initplan.sql
--
-- REVERTER (se preciso): para cada politica reescrita aqui, rodar
--   alter policy <nome> on public.<tabela> using (usuario_tem_acesso_loja(loja_id) or usuario_e_admin());
-- (o bloco DO abaixo, trocando a expressao, faz isso em lote).

create or replace function public.usuario_lojas() returns setof bigint
language sql stable security definer set search_path = public as $$
  select lu.loja_id::bigint from loja_user lu where lu.user_id = auth.uid()
$$;
grant execute on function public.usuario_lojas() to authenticated;

do $$
declare r record; n int := 0;
begin
  for r in
    select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
    where pg_get_expr(p.polqual, p.polrelid) = '(usuario_tem_acesso_loja(loja_id) OR usuario_e_admin())'
  loop
    execute format('alter policy %I on public.%I using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', r.polname, r.relname);
    n := n + 1;
  end loop;
  raise notice 'politicas reescritas: %', n;
end $$;
