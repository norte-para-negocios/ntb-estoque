-- 371 — Cargos padrão das permissões novas da 370 (Fase 4 passo 2 do financeiro). Depende da 370.
-- Separada da 370 de propósito: lib/permissoes-cargos.test.ts lê por ARQUIVO os nomes ligados a cargo, e as permissões que ficam
-- só com Admin/AdminLoja (SO_ADMIN, com o motivo) não podem aparecer num arquivo que insere em cargo_permissao.
--   Gerente: 'Financeiro - Aprovar pagamento' (até a faixa do gerente) e 'Financeiro - Contas recorrentes'.
--   Só Admin/AdminLoja: aprovar alto valor, configurar a aprovação, lançamento avulso e transferência (mexem em dinheiro ou
--   decidem quem aprova; mesmo critério de 'Financeiro - Contas a pagar - Pagar').
-- Só os cargos padrão, por nome; idempotente; não remove nada.
-- Aplicar (manual, com backup e OK do dono), DEPOIS da 370:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 371_financeiro_aprovacao_cargos.sql

begin;
set lock_timeout = '5s';

insert into public.cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from public.cargos c
join public.permissoes p on p.nome in ('Financeiro - Aprovar pagamento', 'Financeiro - Contas recorrentes')
where c.nome = 'Gerente'
on conflict do nothing;

commit;
