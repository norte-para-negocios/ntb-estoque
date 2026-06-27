-- B.3.5: Posicao de caixa (contas correntes + saldos) e fluxo de caixa projetado
-- contas_correntes: cadastro + saldo atual de cada conta (do cabecalho do ListarExtrato Omie)
-- RPC financeiro_fluxo_caixa: entradas (CR) x saidas (CP) projetadas por mes, a partir do que ja temos.

create table if not exists contas_correntes (
  id                  bigserial primary key,
  loja_id             bigint not null references lojas(id),
  codigo_cc           bigint not null,        -- nCodCC
  descricao           text,                   -- cDescricao
  tipo                text,                   -- cCodTipo (CX=caixa, CC=conta, AC=adquirente cartao)
  tipo_descricao      text,                   -- cDesTipo
  codigo_banco        text,                   -- nCodBanco
  numero_conta        text,                   -- nNumConta
  saldo_atual         numeric(14,2),          -- nSaldoAtual
  saldo_previsto      numeric(14,2),          -- nSaldoAtualPrevisto
  saldo_disponivel    numeric(14,2),          -- nSaldoDisponivel
  saldo_conciliado    numeric(14,2),          -- nSaldoConciliado
  inclui_fluxo_caixa  boolean default true,   -- cFluxoCaixa = 'S'
  synced_at           timestamptz default now(),
  constraint uq_conta_corrente_omie unique (loja_id, codigo_cc)
);

create index if not exists idx_contas_correntes_loja
  on contas_correntes (loja_id);

-- Fluxo de caixa projetado: entradas (a receber) x saidas (a pagar) por mes de vencimento.
create or replace function financeiro_fluxo_caixa(p_loja_id bigint)
returns table(mes text, entradas numeric, saidas numeric, saldo_mes numeric)
language sql stable security definer
as $$
  with cr as (
    select to_char(data_vencimento, 'YYYY-MM') as mes, sum(valor_documento) as v
    from contas_receber
    where loja_id = p_loja_id and data_vencimento is not null
    group by 1
  ),
  cp as (
    select to_char(data_vencimento, 'YYYY-MM') as mes, sum(valor_documento) as v
    from contas_pagar
    where loja_id = p_loja_id and data_vencimento is not null
    group by 1
  )
  select
    coalesce(cr.mes, cp.mes)                       as mes,
    coalesce(cr.v, 0)                              as entradas,
    coalesce(cp.v, 0)                              as saidas,
    coalesce(cr.v, 0) - coalesce(cp.v, 0)         as saldo_mes
  from cr
  full outer join cp on cr.mes = cp.mes
  order by mes;
$$;

grant execute on function financeiro_fluxo_caixa(bigint) to authenticated, anon;
