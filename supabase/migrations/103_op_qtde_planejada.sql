-- Bloco 4 da auditoria (achado 2026-08-01, planilha OP_SVVM_JUN25 - R1.xlsx,
-- aba "OPS"): a consultoria acompanha Qtd Prevista x Qtd Produzida por OP
-- (219 de 1608 OPs de jun/25 divergem, ~14%), mas o app nao consegue mostrar
-- isso -- e a Omie tambem nao, VIA API.
--
-- Por que: ConsultarOrdemProducao devolve UMA quantidade
-- (identificacao.nQtde), nao duas. Testado ao vivo contra OP real concluida
-- (nCodOP 4849230683, loja 3): so `nQtde`, sem par previsto/produzido. Ao
-- concluir, esse campo passa a valer o PRODUZIDO -- o previsto e perdido na
-- origem. A planilha da consultoria tem as duas colunas porque vem do export
-- Excel da Omie, nao da API.
--
-- Solucao: guardar o planejado ENQUANTO a OP esta aberta. Uma linha por OP
-- (nao uma por dia -- seriam ~1000 OPs abertas x 365 dias x 6 lojas de lixo),
-- atualizada so enquanto `concluida = false`. Quando a OP conclui, a linha
-- congela com o ultimo planejado conhecido, e a comparacao vira
-- (qtde_planejada aqui) x (identificacao_n_qtde de ordens_producao, que a
-- essa altura ja e o produzido).
--
-- IMPORTANTE: nao ha retroativo possivel. A serie comeca no primeiro dia em
-- que o cron rodar, e so cobre OPs que ainda estavam abertas nesse momento.
-- A UI precisa deixar isso explicito em vez de fingir historico.
--
-- Nao chama a API da Omie: le do proprio banco, que ja tem o planejado das
-- OPs abertas (sync a cada 10min). Barato e sem risco de rate limit.

create table if not exists op_qtde_planejada (
  loja_id          bigint not null references lojas(id) on delete cascade,
  n_cod_op         bigint not null,
  qtde_planejada   numeric(20,6),
  dt_previsao      date,
  -- default no banco (e FORA do payload do upsert): com PostgREST, so as
  -- colunas presentes no payload entram no SET do ON CONFLICT -- omitir esta
  -- e o que garante que ela marque a PRIMEIRA vez e nao seja resetada a cada
  -- rodada do cron.
  primeira_vez_em  date not null default current_date,
  ultima_vez_em    date not null,
  primary key (loja_id, n_cod_op)
);

alter table op_qtde_planejada enable row level security;
create policy "op_qtde_planejada_select_por_loja"
  on op_qtde_planejada for select
  using (exists (select 1 from loja_user lu where lu.loja_id = op_qtde_planejada.loja_id and lu.user_id = auth.uid()));

-- Comparacao previsto x produzido, so pras OPs concluidas que tem planejado
-- capturado. `divergencia` positiva = produziu MAIS que o planejado.
create or replace function relatorio_op_previsto_produzido(
  p_loja_id bigint,
  p_ini     date,
  p_fim     date
)
returns table (
  n_cod_op       bigint,
  num_op         text,
  produto        text,
  dt_previsao    date,
  dt_conclusao   date,
  qtde_planejada numeric,
  qtde_produzida numeric,
  divergencia    numeric,
  pct            numeric
)
language sql
stable
security invoker
as $$
  select
    p.n_cod_op,
    op.identificacao_c_num_op                              as num_op,
    op.produto_descricao                                   as produto,
    p.dt_previsao,
    op.dt_conclusao_real                                   as dt_conclusao,
    p.qtde_planejada,
    op.identificacao_n_qtde                                as qtde_produzida,
    (op.identificacao_n_qtde - p.qtde_planejada)           as divergencia,
    case when p.qtde_planejada > 0
      then round(((op.identificacao_n_qtde - p.qtde_planejada) / p.qtde_planejada) * 100, 1)
      else null end                                        as pct
  from op_qtde_planejada p
  join ordens_producao op
    on op.loja_id = p.loja_id
   and op.identificacao_n_cod_op = p.n_cod_op
  where p.loja_id = p_loja_id
    and op.concluida
    and p.qtde_planejada is not null
    and op.identificacao_n_qtde is not null
    and op.identificacao_n_qtde <> p.qtde_planejada
    and op.dt_conclusao_real >= p_ini
    and op.dt_conclusao_real <= p_fim
  order by abs(op.identificacao_n_qtde - p.qtde_planejada) desc
$$;
