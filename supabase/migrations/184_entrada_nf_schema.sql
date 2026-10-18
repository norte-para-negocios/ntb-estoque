-- 184 — Fase B (paridade com o Omie): esquema da entrada de nota completa no estoque próprio.
-- SÓ ADITIVA: colunas novas aceitam nulo ou têm padrão, tabelas novas, uma permissão. Com a 184 aplicada e o código antigo
-- no ar, tudo funciona igual (nulo = "comportamento antigo": item sem valor_total_item segue a fórmula da 135/181).
-- Aplicar ANTES da 185 (que usa estas colunas) e antes de publicar o código da Fase B. Lojas Omie não usam nada disto.
--   compras_proprio_itens: valores fiscais do item (X1), local/CFOP de entrada/quantidade recebida/unidade por item,
--     as 8 marcações "é custo de estoque" (todas ou nenhuma), alíquotas de crédito, movimenta estoque / gera conta a pagar.
--   compras_proprio: conferida_em/por (etapa "Conferida"), estornos (entradas desfeitas; a compra reabre).
--   compras_proprio_eventos: histórico append-only do processamento (gravado dentro das funções SQL).
--   sefaz_manifestacoes: manifestação do destinatário (no máximo uma conclusiva em andamento/registrada por nota).
--   sefaz_busca_chave: nota por chave digitada, 1 tentativa por chave por hora.
--   compras_proprio_cte / compras_proprio_cte_compra: CT-e de frete e o rateio entre as notas.

begin;

alter table compras_proprio_itens
  add column if not exists valor_total_item numeric(18,4),
  add column if not exists ipi_valor numeric(18,4) not null default 0,
  add column if not exists st_valor numeric(18,4) not null default 0,
  add column if not exists fcp_st_valor numeric(18,4) not null default 0,
  add column if not exists frete_valor numeric(18,4) not null default 0,
  add column if not exists seguro_valor numeric(18,4) not null default 0,
  add column if not exists outras_valor numeric(18,4) not null default 0,
  add column if not exists frete_cte numeric(18,4) not null default 0,
  add column if not exists fiscal jsonb,
  add column if not exists codigo_local_estoque bigint,
  add column if not exists cfop_entrada text,
  add column if not exists origem_cfop text,
  add column if not exists quantidade_recebida numeric(18,6),
  add column if not exists unidade_estoque text,
  add column if not exists custo_icms boolean,
  add column if not exists custo_icms_st boolean,
  add column if not exists custo_ipi boolean,
  add column if not exists custo_seguro boolean,
  add column if not exists custo_pis boolean,
  add column if not exists custo_cofins boolean,
  add column if not exists custo_frete boolean,
  add column if not exists custo_outras boolean,
  add column if not exists aliq_cred_pis numeric(7,4) not null default 0,
  add column if not exists aliq_cred_cofins numeric(7,4) not null default 0,
  add column if not exists origem_flags text,
  add column if not exists movimenta_estoque boolean not null default true,
  add column if not exists gera_conta_pagar boolean not null default true;

alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_cfop_entrada_chk;
alter table compras_proprio_itens add constraint compras_proprio_itens_cfop_entrada_chk
  check (cfop_entrada is null or cfop_entrada ~ '^[123][0-9]{3}$');
alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_origem_cfop_chk;
alter table compras_proprio_itens add constraint compras_proprio_itens_origem_cfop_chk
  check (origem_cfop is null or origem_cfop in ('produto', 'tabela', 'regra', 'manual'));
alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_qtd_recebida_chk;
alter table compras_proprio_itens add constraint compras_proprio_itens_qtd_recebida_chk
  check (quantidade_recebida is null or quantidade_recebida > 0);
alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_aliq_cred_chk;
alter table compras_proprio_itens add constraint compras_proprio_itens_aliq_cred_chk
  check (aliq_cred_pis between 0 and 100 and aliq_cred_cofins between 0 and 100);
alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_origem_flags_chk;
alter table compras_proprio_itens add constraint compras_proprio_itens_origem_flags_chk
  check (origem_flags is null or origem_flags in ('produto', 'fornecedor', 'regra', 'padrao', 'manual'));
alter table compras_proprio_itens drop constraint if exists compras_proprio_itens_flags_todas;
alter table compras_proprio_itens add constraint compras_proprio_itens_flags_todas check (
  (custo_icms is null and custo_icms_st is null and custo_ipi is null and custo_seguro is null and custo_pis is null
   and custo_cofins is null and custo_frete is null and custo_outras is null)
  or (custo_icms is not null and custo_icms_st is not null and custo_ipi is not null and custo_seguro is not null and custo_pis is not null
   and custo_cofins is not null and custo_frete is not null and custo_outras is not null));

alter table compras_proprio
  add column if not exists conferida_em timestamptz,
  add column if not exists conferida_por text,
  -- quantas vezes a entrada foi desfeita (estornar_compra reabre a compra, como o "reverter recebimento" do Omie); cada
  -- nova entrada usa ref <chave>#<n> no ledger para não cair na idempotência da entrada estornada
  add column if not exists estornos int not null default 0;

create table if not exists compras_proprio_eventos (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  compra_id bigint not null references compras_proprio(id) on delete cascade,
  tipo text not null check (tipo in ('criada', 'item_configurado', 'item_vinculado', 'conferida', 'lancada', 'estornada',
                                     'cte_vinculado', 'cte_desvinculado', 'cancelada', 'recusada', 'observacao')),
  linha int,
  detalhe jsonb,
  user_id text,
  criado_em timestamptz not null default now()
);
create index if not exists compras_proprio_eventos_compra on compras_proprio_eventos (compra_id, id);

create table if not exists sefaz_manifestacoes (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  chave text not null check (chave ~ '^[0-9]{44}$'),
  tp_evento text not null check (tp_evento in ('210200', '210210', '210220', '210240')),
  status text not null check (status in ('enviando', 'registrada', 'recusada', 'incerta')),
  cstat text,
  xmotivo text,
  protocolo text,
  justificativa text,
  user_id text,
  criado_em timestamptz not null default now(),
  respondido_em timestamptz
);
create index if not exists sefaz_manifestacoes_chave on sefaz_manifestacoes (loja_id, chave, id);
-- Uma manifestação conclusiva (210200/210220/210240) em andamento ou registrada por nota: duplo clique e dois gerentes
-- ao mesmo tempo dão 23505 no insert (nunca .upsert(): índice parcial).
create unique index if not exists sefaz_manifestacoes_conclusiva_uq on sefaz_manifestacoes (loja_id, chave)
  where tp_evento <> '210210' and status in ('enviando', 'registrada');

create table if not exists sefaz_busca_chave (
  loja_id bigint not null references lojas(id),
  chave text not null,
  ultima_em timestamptz not null,
  cstat text,
  primary key (loja_id, chave)
);

create table if not exists compras_proprio_cte (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id),
  chave text check (chave is null or chave ~ '^[0-9]{44}$'),
  numero text,
  serie text,
  emissao date,
  transportadora_cnpj text,
  transportadora_nome text,
  valor numeric(18,2) not null check (valor > 0),
  icms numeric(18,2) not null default 0,
  cfop text,
  origem text not null check (origem in ('xml', 'manual')),
  xml text,
  user_id text,
  criado_em timestamptz not null default now(),
  unique (loja_id, chave)
);

create table if not exists compras_proprio_cte_compra (
  cte_id bigint not null references compras_proprio_cte(id) on delete cascade,
  compra_id bigint not null references compras_proprio(id) on delete cascade,
  loja_id bigint not null,
  valor numeric(18,2) not null,
  percentual numeric(7,4) not null,
  primary key (cte_id, compra_id)
);
create index if not exists compras_proprio_cte_compra_compra on compras_proprio_cte_compra (compra_id);

-- RLS: leitura no padrão initplan (156); escrita só pelo service_role (actions/funções security definer).
do $$
declare t text;
begin
  foreach t in array array['compras_proprio_eventos', 'sefaz_manifestacoes', 'sefaz_busca_chave', 'compras_proprio_cte', 'compras_proprio_cte_compra'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('create policy %I on %I for select to authenticated using ((select usuario_e_admin()) or loja_id in (select usuario_lojas()))', t || '_select', t);
    execute format('revoke all on %I from anon, authenticated', t);
    execute format('grant select on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

insert into permissoes (nome) values ('Notas Fiscais - Manifestar na SEFAZ') on conflict (nome) do nothing;

commit;

notify pgrst, 'reload schema';
