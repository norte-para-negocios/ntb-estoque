-- Fase 3: cadastros locais (familia, fornecedor, cliente). Banco = fonte da verdade
-- (visao de independencia do Omie). O Omie e LEITURA: "puxar" preenche o banco; criar/
-- editar fica local por enquanto (escrita no Omie so valida com o Ramon). Idempotente.

-- Familia de produto. codigo_familia = codigo do Omie (PesquisarFamilias.codigo); pode
-- ser null em familia criada so localmente (ainda nao subiu pro Omie).
create table if not exists familias (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_familia bigint,
  codigo varchar(60),          -- codInt do Omie (codigo de integracao), opcional
  nome varchar(120) not null,
  inativo boolean not null default false,
  origem varchar(10) not null default 'local',  -- 'omie' (puxado) | 'local' (criado aqui)
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Unico por loja+codigo do Omie quando existe; familia local fica sem codigo_familia.
create unique index if not exists uq_familias_loja_codomie
  on familias(loja_id, codigo_familia) where codigo_familia is not null;
create index if not exists idx_familias_loja_nome on familias(loja_id, nome);

-- Fornecedor (cadastro local; pode ser puxado do Omie ListarClientes com tag Fornecedor).
create table if not exists fornecedores (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_omie bigint,          -- codigo_cliente_omie
  codigo_integracao varchar(60),
  razao_social varchar(150) not null,
  nome_fantasia varchar(120),
  cnpj_cpf varchar(20),
  pessoa_fisica boolean not null default false,
  inscricao_estadual varchar(20),
  inscricao_municipal varchar(20),
  email varchar(120),
  telefone varchar(30),
  cep varchar(10),
  uf varchar(2),
  cidade varchar(100),
  bairro varchar(100),
  logradouro varchar(200),
  numero varchar(20),
  complemento varchar(120),
  inativo boolean not null default false,
  origem varchar(10) not null default 'local',
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_fornecedores_loja_codomie
  on fornecedores(loja_id, codigo_omie) where codigo_omie is not null;
create index if not exists idx_fornecedores_loja_razao on fornecedores(loja_id, razao_social);

-- Cliente (cadastro local; pode ser puxado do Omie ListarClientes). CEST por cliente
-- e raro (CEST e do produto), mas o Ramon pediu o campo aqui no cadastro fiscal.
create table if not exists clientes (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_omie bigint,
  codigo_integracao varchar(60),
  razao_social varchar(150) not null,
  nome_fantasia varchar(120),
  cnpj_cpf varchar(20),
  pessoa_fisica boolean not null default false,
  inscricao_estadual varchar(20),
  inscricao_municipal varchar(20),
  cest varchar(10),
  email varchar(120),
  telefone varchar(30),
  cep varchar(10),
  uf varchar(2),
  cidade varchar(100),
  bairro varchar(100),
  logradouro varchar(200),
  numero varchar(20),
  complemento varchar(120),
  inativo boolean not null default false,
  origem varchar(10) not null default 'local',
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_clientes_loja_codomie
  on clientes(loja_id, codigo_omie) where codigo_omie is not null;
create index if not exists idx_clientes_loja_razao on clientes(loja_id, razao_social);

-- Status de sincronizacao dos novos cadastros, por loja (espelha o padrao de produto/local).
alter table lojas add column if not exists familia_ultima_atualizacao timestamptz;
alter table lojas add column if not exists familia_status varchar(20);
alter table lojas add column if not exists fornecedor_ultima_atualizacao timestamptz;
alter table lojas add column if not exists fornecedor_status varchar(20);
alter table lojas add column if not exists cliente_ultima_atualizacao timestamptz;
alter table lojas add column if not exists cliente_status varchar(20);

-- Permissoes novas (Admin sempre passa; sem acento, regra do banco).
insert into permissoes (nome) values
  ('Familias'),
  ('Familias - Sincronizar'),
  ('Fornecedores'),
  ('Fornecedores - Sincronizar'),
  ('Clientes'),
  ('Clientes - Sincronizar')
on conflict (nome) do nothing;
