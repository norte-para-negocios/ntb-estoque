-- Preparação dos testes da Fase I no banco local (fi): usuário comum da loja 5, como em produção
-- (set local role authenticated + request.jwt.claims). Só no banco local de teste. Idempotente.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
-- o fb_base vem sem os GRANTs de leitura que produção tem para authenticated (RLS continua valendo)
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on all functions in schema public, auth to authenticated;
insert into lojas (id, nome) select 5, 'LOJA 5 (teste)' where not exists (select 1 from lojas where id = 5);
insert into profiles (id, name, perfil, status)
values ('00000000-0000-4000-8000-000000000005', 'Usuário teste loja 5', 'Usuario', 'aprovado')
on conflict (id) do nothing;
insert into loja_user (loja_id, user_id)
select 5, '00000000-0000-4000-8000-000000000005'
where not exists (select 1 from loja_user where loja_id = 5 and user_id = '00000000-0000-4000-8000-000000000005');
