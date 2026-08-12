-- Lojas de Teste (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-lojas-teste-design.md. Cada loja ativa ganha uma gêmea de
-- teste: mesmas credenciais Omie (pra leitura trazer dado real), mas
-- todo INSERT/ALTERAR/EXCLUIR/CONCLUIR/REVERTER na Omie é bloqueado
-- pelo gate central em lib/omie/client.ts (ver migration/task
-- seguinte) -- aqui só criamos as linhas, o bloqueio de escrita ainda
-- não existe até a Task 2 estar deployada junto.

alter table lojas add column if not exists is_test boolean not null default false;
alter table lojas add column if not exists loja_origem_id bigint references lojas(id);

insert into lojas (nome, nome_fantasia, cnpj, omie_app_key, omie_app_secret, ativo, is_test, loja_origem_id)
select
  nome,
  '[TESTE] ' || coalesce(nome_fantasia, nome),
  cnpj,
  omie_app_key,
  omie_app_secret,
  true,
  true,
  id
from lojas
where ativo = true and is_test = false;
