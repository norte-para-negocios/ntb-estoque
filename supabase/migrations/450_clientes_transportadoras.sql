-- 450 (Fase 6): cadastro de clientes e transportadoras no Estoque próprio. Transportadora é um cliente com papel
-- 'transportadora' (ou 'ambos'), como no Omie (cliente com tag). Lojas Omie não mudam (tela só no estoque próprio).
alter table public.clientes add column if not exists papel text not null default 'cliente';
alter table public.clientes drop constraint if exists clientes_papel_check;
alter table public.clientes add constraint clientes_papel_check check (papel in ('cliente', 'transportadora', 'ambos'));
alter table public.clientes add column if not exists rntrc varchar(20);
grant select (papel, rntrc) on public.clientes to authenticated;

insert into public.permissoes (nome) values ('Clientes - Criar'), ('Clientes - Editar'), ('Clientes - Excluir')
on conflict (nome) do nothing;

-- Histórico de alterações (migration 220): 'ignorar' = só grava mudança feita por alguém (o cadastro de clientes das lojas
-- Omie vem do sync e não deve encher a tabela).
drop trigger if exists historico on public.clientes;
create trigger historico after insert or update or delete on public.clientes for each row execute function public.historico_registrar(
  'cliente', 'id', '', 'ignorar',
  'papel', 'razao_social', 'nome_fantasia', 'cnpj_cpf', 'pessoa_fisica', 'inscricao_estadual', 'email', 'telefone',
  'cep', 'uf', 'cidade', 'bairro', 'logradouro', 'numero', 'complemento', 'rntrc', 'inativo');

-- As permissões novas entram no cargo Gerente (que já tem "Clientes"); Admin/AdminLoja passam em tudo.
insert into public.cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from public.cargos c join public.permissoes p on p.nome in ('Clientes - Criar', 'Clientes - Editar', 'Clientes - Excluir')
where c.nome = 'Gerente'
on conflict do nothing;
