-- NTB Estoque - Schema inicial (migrado de MariaDB/Laravel)

-- Lojas (raiz multi-tenancy)
create table if not exists lojas (
  id bigserial primary key,
  cnpj varchar(18) not null,
  nome varchar(120) not null,
  nome_fantasia varchar(80),
  cep varchar(10),
  uf varchar(2),
  cidade varchar(100),
  bairro varchar(100),
  logradouro varchar(200),
  numero varchar(20),
  omie_app_key text,
  omie_app_secret text,
  ativo boolean not null default true,
  local_estoque_ultima_atualizacao timestamptz,
  local_estoque_status varchar(20),
  produto_ultima_atualizacao timestamptz,
  produto_status varchar(20),
  posicao_estoque_ultima_atualizacao timestamptz,
  posicao_estoque_status varchar(20),
  nota_fiscal_ultima_atualizacao timestamptz,
  nota_fiscal_status varchar(20),
  ordem_producao_ultima_atualizacao timestamptz,
  ordem_producao_status varchar(20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Profiles (estende auth.users do Supabase)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name varchar(255) not null,
  current_loja_id bigint references lojas(id) on delete set null,
  perfil varchar(20) default 'Usuario',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pivot loja_user
create table if not exists loja_user (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(loja_id, user_id)
);

-- Permissoes (16 fixas)
create table if not exists permissoes (
  id bigserial primary key,
  nome varchar(60) not null unique,
  created_at timestamptz not null default now()
);

-- Pivot permissao_user (por loja)
create table if not exists permissao_user (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  permissao_id bigint not null references permissoes(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  unique(loja_id, permissao_id, user_id)
);

-- Locais de Estoque
create table if not exists local_estoques (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_local_estoque bigint not null,
  codigo varchar(50),
  descricao varchar(250),
  tipo varchar(1),
  padrao varchar(1),
  inativo varchar(1),
  codigo_cliente bigint,
  disp_ordem_producao varchar(1),
  disp_consumo_op varchar(1),
  disp_remessa varchar(1),
  disp_venda varchar(1),
  d_inc varchar(10), h_inc varchar(8), u_inc varchar(50),
  d_alt varchar(10), h_alt varchar(8), u_alt varchar(50),
  full_object jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists local_estoque_user (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  local_estoque_id bigint not null references local_estoques(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  unique(loja_id, local_estoque_id, user_id)
);

-- Produtos
create table if not exists produtos (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  codigo varchar(60),
  descricao varchar(120),
  codigo_familia bigint,
  descricao_familia varchar(50),
  tipo_item varchar(2),
  unidade varchar(6),
  valor_unitario numeric(10,2),
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(codigo_produto, loja_id)
);

-- Posicao de Estoque
create table if not exists posicao_estoques (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_local_estoque bigint not null,
  n_cod_prod bigint not null,
  data_posicao date not null,
  c_cod_int varchar(60),
  c_codigo varchar(60),
  c_descricao varchar(120),
  n_preco_unitario numeric(20,6),
  n_saldo numeric(20,6),
  n_cmc numeric(20,6),
  n_pendente numeric(20,6),
  estoque_minimo numeric(20,6),
  reservado numeric(20,6),
  fisico numeric(20,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(loja_id, codigo_local_estoque, n_cod_prod, data_posicao)
);

-- Ordens de Producao
create table if not exists ordens_producao (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  num_ordem varchar(60),
  validade date,
  quantidade numeric(20,6),
  identificacao_n_cod_op bigint,
  identificacao_c_cod_int_op varchar(20),
  identificacao_c_num_op varchar(15),
  identificacao_n_cod_produto bigint,
  identificacao_c_cod_int_prod varchar(60),
  identificacao_d_dt_previsao date,
  identificacao_n_qtde numeric(10,2),
  identificacao_codigo_local_estoque bigint,
  adicionais_c_etapa varchar(2),
  adicionais_n_cod_projeto bigint,
  adicionais_d_dt_inicio date,
  adicionais_d_dt_conclusao date,
  produto_codigo varchar(60),
  produto_descricao varchar(120),
  produto_tipo_item varchar(2),
  produto_unidade varchar(6),
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_op_loja_cod on ordens_producao(loja_id, identificacao_n_cod_op, identificacao_c_num_op);

-- Notas Fiscais
create table if not exists notas_fiscais (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  n_id_receb varchar(20),
  n_id_fornecedor bigint,
  c_pessoa_fisica varchar(1),
  c_nome varchar(100),
  c_razao_social varchar(60),
  c_inscricao varchar(20),
  c_cnpj_cpf varchar(20),
  c_chave_nfe varchar(44),
  c_etapa varchar(2),
  c_numero_nfe varchar(10),
  c_serie_nfe varchar(3),
  c_modelo_nfe varchar(2),
  d_emissao_nfe date,
  n_valor_nfe numeric(10,2),
  c_ambiente_nfe varchar(1),
  c_natureza_operacao varchar(60),
  full_object jsonb,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Itens de Nota Fiscal
create table if not exists nota_fiscal_items (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  nota_fiscal_id bigint references notas_fiscais(id) on delete cascade,
  n_id_receb varchar(20),
  produto_codigo varchar(20),
  quantidade integer,
  n_sequencia bigint,
  n_id_item bigint,
  n_id_pedido bigint,
  n_id_it_pedido bigint,
  n_id_produto bigint,
  c_codigo_produto varchar(60),
  c_descricao_produto varchar(120),
  c_ignorar_item varchar(1),
  c_adicionar_novo varchar(1),
  c_associar_existente varchar(1),
  c_item_devolvido varchar(1),
  c_ncm varchar(13),
  c_ean varchar(14),
  c_cfop varchar(10),
  n_qtde_nfe numeric(10,2),
  c_unidade_nfe varchar(6),
  n_preco_unit numeric(10,2),
  v_desconto numeric(10,2),
  v_frete numeric(10,2),
  v_total_item numeric(10,2),
  full_object jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Transferencias
create table if not exists transferencias (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_local_origem bigint not null,
  codigo_local_destino bigint not null,
  motivo varchar(50),
  data timestamptz not null default now(),
  status varchar(30) not null default 'Em contagem',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Movimentos
create table if not exists movimentos (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  transferencia_id bigint references transferencias(id) on delete cascade,
  codigo_local_estoque bigint not null,
  id_prod bigint not null,
  data timestamptz not null,
  tipo varchar(3) not null check (tipo in ('ENT','SAI','SLD','TRF')),
  quan numeric(10,2),
  valor numeric(10,2),
  obs text,
  origem varchar(3) default 'AJU' check (origem in ('AJU','PDV')),
  motivo varchar(3),
  codigo_local_estoque_destino bigint,
  codigo_status varchar(20),
  descricao_status text,
  id_movest bigint,
  id_ajuste bigint,
  response text,
  status varchar(20) check (status in ('Iniciado','Processando','Concluido','Erro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Inventarios
create table if not exists inventarios (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_local_estoque bigint not null,
  data timestamptz not null default now(),
  tipo varchar(3) default 'SLD',
  origem varchar(3) default 'AJU',
  motivo varchar(3) default 'INV',
  finalizado timestamptz,
  status varchar(30) not null default 'Em contagem',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Inventario Items
create table if not exists inventario_items (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  inventario_id bigint not null references inventarios(id) on delete cascade,
  produto_codigo_produto bigint,
  produto_codigo varchar(60),
  produto_descricao varchar(120),
  produto_familia varchar(50),
  quan numeric(20,6),
  valor numeric(20,6),
  response text,
  codigo_status varchar(20),
  descricao_status text,
  id_movest bigint,
  id_ajuste bigint,
  status varchar(30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Webhooks (auto-prune 7 dias)
create table if not exists webhooks (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  message_id varchar(40) not null,
  message jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Logs de Integracao
create table if not exists integration_attempts (
  id bigserial primary key,
  loja_id bigint references lojas(id) on delete cascade,
  model varchar(120),
  request text,
  response text,
  code varchar(3),
  error boolean default false,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_integration_loja_created on integration_attempts(loja_id, created_at);
