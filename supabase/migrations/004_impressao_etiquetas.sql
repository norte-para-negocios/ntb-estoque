-- Historico de impressao de etiquetas (NF e OP)
create table if not exists impressao_etiquetas (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  origem varchar(2) not null check (origem in ('NF', 'OP')),
  referencia_id bigint not null,
  qtd_etiquetas int not null default 0,
  user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_impressao_loja_created
  on impressao_etiquetas(loja_id, created_at);

-- RLS: leitura escopada por loja do usuario.
-- O service_role (usado pelas rotas de impressao) ignora RLS, entao
-- so precisamos da policy de SELECT. Insercoes sao feitas via service client.
alter table impressao_etiquetas enable row level security;

create policy "impressao_etiquetas_select_por_loja"
  on impressao_etiquetas
  for select
  using (
    exists (
      select 1
      from loja_user lu
      where lu.loja_id = impressao_etiquetas.loja_id
        and lu.user_id = auth.uid()
    )
  );
