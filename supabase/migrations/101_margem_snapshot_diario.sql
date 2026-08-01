-- Item 5 da auditoria FAT_SVVM_2026.xlsx (2026-08-01): margem mensal so tem
-- dado historico real pra lojas com import manual do FAT_DRV (hoje so a
-- loja 3) -- posicao_estoques (usada no calculo "ao vivo" das outras 5
-- lojas) so guarda 2 dias de snapshot, nao e serie temporal. Decisao do
-- usuario: comecar a arquivar CMC diario AGORA (sem retroativo possivel).

create table if not exists margem_snapshot_diario (
  loja_id        bigint not null references lojas(id) on delete cascade,
  data_snapshot  date not null,
  codigo_produto bigint not null,
  codigo         text,
  descricao      text,
  descricao_familia text,
  pdv            numeric,
  cmc            numeric,
  margem         numeric,
  primary key (loja_id, data_snapshot, codigo_produto)
);

alter table margem_snapshot_diario enable row level security;
create policy "margem_snapshot_diario_select_por_loja"
  on margem_snapshot_diario for select
  using (exists (select 1 from loja_user lu where lu.loja_id = margem_snapshot_diario.loja_id and lu.user_id = auth.uid()));

-- Matriz mes a mes (media do CMC/PDV no mes, ponderada simples por dia) --
-- espelha relatorio_faturamento_matriz em formato de saida.
create or replace function relatorio_margem_snapshot_matriz(p_loja_id bigint)
returns table (codigo text, descricao text, familia text, mes text, pdv numeric, cmc numeric, margem numeric)
language sql stable as $$
  select
    codigo,
    max(descricao) as descricao,
    max(descricao_familia) as familia,
    to_char(data_snapshot, 'YYYY-MM') as mes,
    avg(pdv) as pdv,
    avg(cmc) as cmc,
    avg(margem) as margem
  from margem_snapshot_diario
  where loja_id = p_loja_id
  group by codigo, to_char(data_snapshot, 'YYYY-MM')
  order by codigo, mes
$$;
