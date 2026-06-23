-- Movimentação valorizada (baixas em R$) importada do export MOV_DRV do Omie.
-- O valor em R$ não vem confiável da nossa base (CMC podre; preço-NF tem unidade
-- trocada), então o usuário sobe o export e guardamos os agregados da aba
-- "BAIXA RESUMO" (baixa por tipo SPED em R$ mês a mês). Espelha o faturamento_importado.

create table if not exists movimentacao_importada (
  loja_id bigint not null references lojas(id) on delete cascade,
  dimensao text not null,            -- 'tipo' (por tipo SPED)
  rotulo text not null,
  mes text not null,                 -- 'YYYY-MM'
  valor numeric not null,            -- positivo (módulo da baixa)
  primary key (loja_id, dimensao, rotulo, mes)
);

create table if not exists movimentacao_import_meta (
  loja_id bigint primary key references lojas(id) on delete cascade,
  importado_em timestamptz not null default now(),
  importado_por uuid,
  linhas int not null default 0,
  arquivo text
);

alter table movimentacao_importada enable row level security;
create policy "movimentacao_importada_select_por_loja"
  on movimentacao_importada for select
  using (exists (select 1 from loja_user lu where lu.loja_id = movimentacao_importada.loja_id and lu.user_id = auth.uid()));

alter table movimentacao_import_meta enable row level security;
create policy "movimentacao_import_meta_select_por_loja"
  on movimentacao_import_meta for select
  using (exists (select 1 from loja_user lu where lu.loja_id = movimentacao_import_meta.loja_id and lu.user_id = auth.uid()));

-- Matriz mensal por dimensão (espelha relatorio_faturamento_matriz).
create or replace function relatorio_movimentacao_valor_matriz(p_loja_id bigint, p_dim text)
returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select rotulo, mes, sum(valor)::numeric
  from movimentacao_importada
  where loja_id = p_loja_id and dimensao = p_dim
  group by rotulo, mes
  order by rotulo, mes;
$$;
