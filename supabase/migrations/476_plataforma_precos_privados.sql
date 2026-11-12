-- Plataforma Norte: o preço dos planos (plataforma_planos.preco_mensal) não é lido por usuário logado.
-- A 475 deu SELECT na tabela inteira a authenticated; aqui o SELECT vira por coluna, sem preco_mensal.
-- Só o service_role (tela /plataforma/modulos, só dev, e a action plataforma-modulos) lê e grava o preço.
-- Idempotente. Reverter: grant select on public.plataforma_planos to authenticated;

revoke select on public.plataforma_planos from anon, authenticated;
grant select (id, modulo_id, nome, ativo) on public.plataforma_planos to authenticated;
grant all on public.plataforma_planos to service_role;

notify pgrst, 'reload schema';
