-- B.3: Contas a pagar e a receber (espelho do financeiro Omie, somente itens abertos)
-- Estrategia: sync apenas status EMABERTO/ATRASADO/AVENCER/VENCEHOJE/PAGTO_PARCIAL
-- Nao armazenar full_object (economiza espaco); so campos operacionais.

create table if not exists contas_pagar (
  id                          bigserial primary key,
  loja_id                     bigint not null references lojas(id),
  codigo_lancamento_omie      bigint not null,
  codigo_cliente_fornecedor   bigint,
  data_emissao                date,
  data_vencimento             date,
  data_previsao               date,
  data_entrada                date,
  valor_documento             numeric(14,2),
  status_titulo               text,
  codigo_categoria            text,
  codigo_tipo_documento       text,
  numero_documento            text,
  numero_documento_fiscal     text,
  numero_parcela              text,
  id_conta_corrente           bigint,
  synced_at                   timestamptz default now(),
  constraint uq_conta_pagar_omie unique (loja_id, codigo_lancamento_omie)
);

create index if not exists idx_contas_pagar_loja_status
  on contas_pagar (loja_id, status_titulo);
create index if not exists idx_contas_pagar_vencimento
  on contas_pagar (loja_id, data_vencimento);
create index if not exists idx_contas_pagar_fornecedor
  on contas_pagar (codigo_cliente_fornecedor);

create table if not exists contas_receber (
  id                          bigserial primary key,
  loja_id                     bigint not null references lojas(id),
  codigo_lancamento_omie      bigint not null,
  codigo_cliente_fornecedor   bigint,
  data_emissao                date,
  data_vencimento             date,
  data_previsao               date,
  data_registro               date,
  valor_documento             numeric(14,2),
  status_titulo               text,
  codigo_categoria            text,
  codigo_tipo_documento       text,
  numero_documento            text,
  numero_documento_fiscal     text,
  numero_parcela              text,
  numero_pedido               text,
  chave_nfe                   text,
  id_conta_corrente           bigint,
  synced_at                   timestamptz default now(),
  constraint uq_conta_receber_omie unique (loja_id, codigo_lancamento_omie)
);

create index if not exists idx_contas_receber_loja_status
  on contas_receber (loja_id, status_titulo);
create index if not exists idx_contas_receber_vencimento
  on contas_receber (loja_id, data_vencimento);
create index if not exists idx_contas_receber_cliente
  on contas_receber (codigo_cliente_fornecedor);
