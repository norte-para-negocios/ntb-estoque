-- 305 — Financeiro A0: espelho NOVO do financeiro do Omie (lojas em modo Omie), só leitura do Omie.
-- Spec/plano: AGENTS.md, seção "Financeiro A0 — espelho do financeiro do Omie".
--
-- O que guarda (nomes de campo do Omie, para o motor de relatórios da A1):
--   omie_fin_titulos          títulos a pagar (natureza 'P') e a receber ('R'), ABERTOS E PAGOS, com o resumo do Omie
--                             (valor pago/aberto/desconto/juros/multa) e o rateio por categoria.
--   omie_fin_baixas           baixas (pagamento/recebimento) com juros, multa, desconto, tarifa e data de crédito; a
--                             baixa cancelada fica com cancelada = true (nada se apaga).
--   omie_fin_lancamentos_cc   lançamentos e transferências de conta corrente (só pelos avisos do Omie, desde 03/09/2026).
--   omie_fin_categorias       categorias com a conta da DRE (dadosDRE).
--   omie_fin_dre              cadastro da DRE (ListarCadastroDRE).
--   omie_fin_contas_correntes contas correntes com saldo inicial e o saldo lido no extrato.
--
-- Fontes: os avisos `Financas.*` que já chegam na tabela `webhooks` (processados por cron, nunca na resposta do aviso)
-- e a carga/conferência pela API (ListarMovimentos, ListarCategorias, ListarCadastroDRE, ListarContasCorrentes,
-- ListarExtrato). Cada linha guarda `fonte_em` (o instante que ela representa: hora do aviso ou da leitura da API);
-- as funções da 306 só regravam uma linha com dado MAIS NOVO (aviso atrasado nunca desfaz leitura mais nova).
--
-- NÃO mexe no espelho antigo (contas_pagar / contas_receber / contas_correntes, migrations 052–054, morto desde 27/06,
-- só títulos abertos): pode ser descartado depois. NÃO mexe no financeiro do Norte (fin_*, 285/286, loja própria).
--
-- Segurança (padrão das fin_* da 285): RLS ligada com a política de leitura por loja no padrão initplan (156), mas
-- SEM grant para anon/authenticated: só o servidor (service role) lê e grava, depois de conferir a permissão.
--
-- Aplicar (manual, backup + OK do dono), ANTES da 306 e ANTES do código:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 305_omie_fin_espelho.sql
-- Só cria objetos novos (nenhum lock em tabela existente). Teste: scripts/testes-sql/305_306_omie_fin.sql.
-- Reverter (nada depende delas): drop table omie_fin_titulos, omie_fin_baixas, omie_fin_lancamentos_cc,
--   omie_fin_categorias, omie_fin_dre, omie_fin_contas_correntes cascade;
-- Cursores (espelho_sync_estado, frentes 'financeiro' e 'fin-avisos'): nada novo aqui.

begin;
set lock_timeout = '5s';

-- ------------------------------------------------------------------------------------------------------ títulos
create table if not exists public.omie_fin_titulos (
  loja_id                       bigint not null references public.lojas(id) on delete cascade,
  codigo_lancamento_omie        bigint not null,
  natureza                      char(1) not null check (natureza in ('P', 'R')),
  codigo_lancamento_integracao  text,
  codigo_cliente_fornecedor     bigint,
  codigo_categoria              text,
  -- Rateio por categoria [{codigo_categoria, valor, percentual}] (aviso Rateio.Categoria); null = só codigo_categoria.
  categorias                    jsonb,
  categorias_em                 timestamptz,
  id_conta_corrente             bigint,
  data_emissao                  date,
  data_registro                 date,
  data_vencimento               date,
  data_previsao                 date,
  -- Data do pagamento/recebimento (ListarMovimentos dDtPagamento; o aviso do título não traz).
  data_pagamento                date,
  valor_documento               numeric(14,2),
  -- Resumo do Omie (só a API traz; resumo_em = quando foi lido). Ver omie_fin_titulos_atual.
  valor_pago                    numeric(14,2),
  valor_aberto                  numeric(14,2),
  valor_desconto                numeric(14,2),
  valor_juros                   numeric(14,2),
  valor_multa                   numeric(14,2),
  liquidado                     boolean,
  resumo_em                     timestamptz,
  -- Status como o Omie escreve, em maiúsculas sem prefixo ("A VENCER", "ATRASADO", "PAGO", "RECEBIDO PARCIALMENTE"…).
  status_titulo                 text,
  -- Situação canônica: aberto | parcial | liquidado | cancelado (null = desconhecida).
  situacao                      text check (situacao in ('aberto', 'parcial', 'liquidado', 'cancelado')),
  excluido                      boolean not null default false,
  excluido_em                   timestamptz,
  numero_documento              text,
  numero_documento_fiscal       text,
  numero_parcela                text,
  numero_pedido                 text,
  codigo_tipo_documento         text,
  -- Origem do lançamento no Omie (APIP, RPTP, BAXP…) e operação (11 venda, 12 PDV, 21 compra…).
  id_origem                     text,
  operacao                      text,
  chave_nfe                     text,
  nsu                           text,
  codigo_projeto                bigint,
  codigo_vendedor               bigint,
  codigo_titulo_repeticao       bigint,
  incluido_omie_em              timestamp,
  incluido_por                  text,
  alterado_omie_em              timestamp,
  alterado_por                  text,
  -- Abertos: última vez que o título apareceu na varredura de abertos da API (frente fin-abertos).
  visto_aberto_em               timestamptz,
  -- Proveniência: 'webhook' | 'api' | 'api-conferencia' | 'rateio'; fonte_em = instante que a linha representa.
  origem_dado                   text not null,
  fonte_em                      timestamptz,
  webhook_id                    bigint,
  atualizado_em                 timestamptz not null default now(),
  primary key (loja_id, codigo_lancamento_omie)
);
-- Relatórios (A1) e conferência: por loja + natureza + data; abertos.
create index if not exists omie_fin_titulos_venc on public.omie_fin_titulos (loja_id, natureza, data_vencimento);
create index if not exists omie_fin_titulos_emissao on public.omie_fin_titulos (loja_id, natureza, data_emissao);
create index if not exists omie_fin_titulos_pagamento on public.omie_fin_titulos (loja_id, natureza, data_pagamento);
create index if not exists omie_fin_titulos_abertos on public.omie_fin_titulos (loja_id, natureza)
  where not excluido and situacao in ('aberto', 'parcial');

-- ------------------------------------------------------------------------------------------------------- baixas
create table if not exists public.omie_fin_baixas (
  loja_id                    bigint not null references public.lojas(id) on delete cascade,
  codigo_baixa               bigint not null,
  natureza                   char(1) not null check (natureza in ('P', 'R')),
  codigo_lancamento_omie     bigint,
  codigo_lancamento_integracao text,
  codigo_baixa_integracao    text,
  codigo_conta_corrente      bigint,
  codigo_cliente_fornecedor  bigint,
  codigo_categoria           text,
  -- data = data do pagamento/recebimento; data_cred = data de crédito na conta.
  data                       date,
  data_cred                  date,
  data_conciliacao           date,
  valor                      numeric(14,2),
  juros                      numeric(14,2),
  multa                      numeric(14,2),
  desconto                   numeric(14,2),
  tarifa                     numeric(14,2),
  codigo_mov_cc              bigint,
  observacao                 text,
  cancelada                  boolean not null default false,
  cancelada_em               timestamptz,
  origem_dado                text not null,
  fonte_em                   timestamptz,
  webhook_id                 bigint,
  atualizado_em              timestamptz not null default now(),
  primary key (loja_id, codigo_baixa)
);
create index if not exists omie_fin_baixas_titulo on public.omie_fin_baixas (loja_id, codigo_lancamento_omie);
create index if not exists omie_fin_baixas_data on public.omie_fin_baixas (loja_id, natureza, data);

-- ------------------------------------------------------------------------------ lançamentos de conta corrente
create table if not exists public.omie_fin_lancamentos_cc (
  loja_id                bigint not null references public.lojas(id) on delete cascade,
  n_cod_lanc             bigint not null,
  c_cod_int_lanc         text,
  -- 'lancamento' | 'transferencia'
  tipo                   text not null check (tipo in ('lancamento', 'transferencia')),
  n_cod_cc               bigint,
  n_cod_cc_destino       bigint,
  d_dt_lanc              date,
  n_valor_lanc           numeric(14,2),
  c_cod_categ            text,
  c_natureza             text,
  c_origem               text,
  c_tipo                 text,
  c_num_doc              text,
  n_cod_cliente          bigint,
  c_obs                  text,
  d_dt_conc              date,
  situacao               text,
  excluido               boolean not null default false,
  excluido_em            timestamptz,
  origem_dado            text not null,
  fonte_em               timestamptz,
  webhook_id             bigint,
  atualizado_em          timestamptz not null default now(),
  primary key (loja_id, n_cod_lanc)
);
create index if not exists omie_fin_lancamentos_cc_data on public.omie_fin_lancamentos_cc (loja_id, n_cod_cc, d_dt_lanc);

-- -------------------------------------------------------------------------------------------- categorias e DRE
create table if not exists public.omie_fin_categorias (
  loja_id              bigint not null references public.lojas(id) on delete cascade,
  codigo               text not null,
  descricao            text,
  descricao_padrao     text,
  categoria_superior   text,
  tipo_categoria       text,
  conta_receita        boolean,
  conta_despesa        boolean,
  conta_inativa        boolean,
  totalizadora         boolean,
  transferencia        boolean,
  nao_exibir           boolean,
  definida_pelo_usuario boolean,
  id_conta_contabil    text,
  tag_conta_contabil   text,
  -- Conta da DRE (dadosDRE): código, descrição, nível, sinal (+/-), totalizadora, oculta.
  codigo_dre           text,
  descricao_dre        text,
  nivel_dre            int,
  sinal_dre            text,
  totaliza_dre         boolean,
  nao_exibir_dre       boolean,
  lido_em              timestamptz not null default now(),
  primary key (loja_id, codigo)
);
create index if not exists omie_fin_categorias_dre on public.omie_fin_categorias (loja_id, codigo_dre);

create table if not exists public.omie_fin_dre (
  loja_id         bigint not null references public.lojas(id) on delete cascade,
  codigo_dre      text not null,
  descricao_dre   text,
  nivel_dre       int,
  sinal_dre       text,
  totaliza_dre    boolean,
  nao_exibir_dre  boolean,
  lido_em         timestamptz not null default now(),
  primary key (loja_id, codigo_dre)
);

-- ----------------------------------------------------------------------------------------------- contas correntes
create table if not exists public.omie_fin_contas_correntes (
  loja_id                bigint not null references public.lojas(id) on delete cascade,
  id_conta_corrente      bigint not null,          -- nCodCC
  descricao              text,
  tipo_conta_corrente    text,                     -- CX caixa, CC conta corrente, AC adm. de cartão, CA, CR…
  codigo_banco           text,
  codigo_agencia         text,
  numero_conta_corrente  text,
  inativo                boolean,
  bloqueado              boolean,
  nao_fluxo              boolean,
  nao_resumo             boolean,
  pdv_categoria          text,
  saldo_inicial          numeric(14,2),
  saldo_data             date,
  -- Saldo lido no extrato (ListarExtrato, cExibirApenasSaldo): atual, conciliado e previsto, e quando.
  saldo_atual            numeric(16,2),
  saldo_conciliado       numeric(16,2),
  saldo_atual_previsto   numeric(16,2),
  saldo_em               timestamptz,
  lido_em                timestamptz not null default now(),
  primary key (loja_id, id_conta_corrente)
);

-- ---------------------------------------------------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['omie_fin_titulos', 'omie_fin_baixas', 'omie_fin_lancamentos_cc', 'omie_fin_categorias',
                           'omie_fin_dre', 'omie_fin_contas_correntes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_por_loja', t);
    execute format('create policy %I on public.%I for select using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select_por_loja', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
