-- Faturamento importado do export FAT_DRV do Omie (agregado por dimensão/mês).
-- O auto-sync não é possível (NFC-e do PDV não vem pela API); o usuário sobe o
-- export periodicamente e a gente guarda os agregados das abas-resumo.

create table if not exists faturamento_importado (
  loja_id bigint not null references lojas(id) on delete cascade,
  dimensao text not null,            -- 'tipo' | 'familia' | 'forma_pgto'
  rotulo text not null,
  mes text not null,                 -- 'YYYY-MM'
  valor numeric not null,
  primary key (loja_id, dimensao, rotulo, mes)
);

create table if not exists faturamento_import_meta (
  loja_id bigint primary key references lojas(id) on delete cascade,
  importado_em timestamptz not null default now(),
  importado_por uuid,
  linhas int not null default 0,
  arquivo text
);

alter table faturamento_importado enable row level security;
create policy "faturamento_importado_select_por_loja"
  on faturamento_importado for select
  using (exists (select 1 from loja_user lu where lu.loja_id = faturamento_importado.loja_id and lu.user_id = auth.uid()));

alter table faturamento_import_meta enable row level security;
create policy "faturamento_import_meta_select_por_loja"
  on faturamento_import_meta for select
  using (exists (select 1 from loja_user lu where lu.loja_id = faturamento_import_meta.loja_id and lu.user_id = auth.uid()));

-- Total e matriz mensal por dimensão (espelha o relatorio_compras).
create or replace function relatorio_faturamento_matriz(p_loja_id bigint, p_dim text)
returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select rotulo, mes, sum(valor)::numeric
  from faturamento_importado
  where loja_id = p_loja_id and dimensao = p_dim
  group by rotulo, mes
  order by rotulo, mes;
$$;
