-- RBAC: cargos configuráveis (Gerente, Estoquista, Conferente...). Hoje cada usuário
-- 'Usuario' é configurado permissão a permissão (permissao_user). Agora pode-se definir
-- CARGOS reutilizáveis (globais, iguais em todas as lojas) com um conjunto de permissões,
-- e atribuir um cargo ao funcionário POR LOJA (loja_user.cargo_id). A pessoa pode ser
-- Gerente numa loja e Conferente noutra. O permissao_user continua valendo como EXTRA
-- por cima do cargo (nada quebra; usuários atuais seguem funcionando).

create table if not exists cargos (
  id         bigserial primary key,
  nome       varchar(40) not null unique,
  descricao  varchar(160),
  created_at timestamptz not null default now()
);

create table if not exists cargo_permissao (
  cargo_id     bigint not null references cargos(id) on delete cascade,
  permissao_id bigint not null references permissoes(id) on delete cascade,
  primary key (cargo_id, permissao_id)
);

-- Cargo do funcionário NAQUELA loja (nullable: vínculo sem cargo = só permissões avulsas).
alter table loja_user add column if not exists cargo_id bigint references cargos(id) on delete set null;

-- RLS: leitura liberada (a UI precisa listar cargos no dropdown); escrita só pelo
-- service client (as actions já checam getAtorGestao no servidor).
alter table cargos enable row level security;
alter table cargo_permissao enable row level security;
create policy "cargos_select_auth" on cargos for select using (auth.role() = 'authenticated');
create policy "cargo_permissao_select_auth" on cargo_permissao for select using (auth.role() = 'authenticated');

-- Cargos-semente (o cliente edita depois). Permissões atribuídas por NOME.
insert into cargos (nome, descricao) values
  ('Gerente', 'Operação completa da loja, sem a parte de cadastro'),
  ('Estoquista', 'Contagens, transferências e movimentações do dia a dia'),
  ('Conferente', 'Só leitura: conferir movimentações, validade e impressões')
on conflict (nome) do nothing;

-- Gerente = tudo MENOS os módulos de cadastro (Produtos/Famílias/Fornecedores/Locais).
insert into cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from cargos c, permissoes p
where c.nome = 'Gerente'
  and p.nome not like 'Produtos%' and p.nome not like 'Familias%'
  and p.nome not like 'Fornecedores%' and p.nome not like 'Locais de Estoque%'
on conflict do nothing;

-- Estoquista = transferências + inventários (ver/criar/editar) + movimentações/validade/impressões.
insert into cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from cargos c, permissoes p
where c.nome = 'Estoquista'
  and p.nome in (
    'Transferencias - Ver','Transferencias - Criar','Transferencias - Editar',
    'Inventarios - Ver','Inventarios - Criar','Inventarios - Editar',
    'Movimentacoes','Validade','Impressoes'
  )
on conflict do nothing;

-- Conferente = só leitura/conferência.
insert into cargo_permissao (cargo_id, permissao_id)
select c.id, p.id from cargos c, permissoes p
where c.nome = 'Conferente'
  and p.nome in ('Transferencias - Ver','Inventarios - Ver','Movimentacoes','Validade','Impressoes')
on conflict do nothing;
