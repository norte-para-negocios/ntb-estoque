-- Margem por produto (Módulo D) importada da aba "MARGEM" do export FAT_DRV.
-- O CMC do Omie é podre para parte do produto acabado (ex.: Casquinha de siri
-- CMC R$100bi), então a margem dele explode; a tela isola esses casos como
-- "CMC inválido — revisar no Omie". Espelha o faturamento_importado.

create table if not exists margem_importada (
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo text not null,
  descricao text,
  familia text,
  mes text not null,        -- 'YYYY-MM'
  pdv numeric,              -- preço de venda (PDV) unitário máx no mês
  cmc numeric,             -- custo médio (CMC Atual) do Omie
  margem numeric,          -- % margem do export (pode explodir se CMC podre)
  primary key (loja_id, codigo, mes)
);

create table if not exists margem_import_meta (
  loja_id bigint primary key references lojas(id) on delete cascade,
  importado_em timestamptz not null default now(),
  importado_por uuid,
  linhas int not null default 0,
  arquivo text
);

alter table margem_importada enable row level security;
create policy "margem_importada_select_por_loja"
  on margem_importada for select
  using (exists (select 1 from loja_user lu where lu.loja_id = margem_importada.loja_id and lu.user_id = auth.uid()));

alter table margem_import_meta enable row level security;
create policy "margem_import_meta_select_por_loja"
  on margem_import_meta for select
  using (exists (select 1 from loja_user lu where lu.loja_id = margem_import_meta.loja_id and lu.user_id = auth.uid()));
