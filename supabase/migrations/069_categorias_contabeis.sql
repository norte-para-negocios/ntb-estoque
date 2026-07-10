-- Reuniao 09/07 (#29): cadastro de categorias contabeis (compra mercadoria pra
-- revenda, materia-prima, servicos, uso/consumo, embalagem, material de
-- escritorio etc), espelhando as categorias que a contabilidade usa no Omie.
-- Puramente local (o Omie nao expoe essa classificacao via API pra gente
-- gravar): cada item de NF pode ser marcado com uma categoria, pra reporte
-- interno. Nao mexe em nada do Omie.

create table if not exists categorias_contabeis (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  nome text not null,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loja_id, nome)
);

alter table nota_fiscal_items
  add column if not exists categoria_contabil_id bigint references categorias_contabeis(id) on delete set null;

insert into permissoes (nome) values
  ('Categorias Contabeis'),
  ('Categorias Contabeis - Criar'),
  ('Categorias Contabeis - Editar'),
  ('Categorias Contabeis - Excluir')
on conflict (nome) do nothing;

-- Seed das categorias vistas na reuniao, uma por loja existente. Loja pode
-- editar/excluir/renomear livremente depois -- e so o ponto de partida.
insert into categorias_contabeis (loja_id, nome)
select l.id, c.nome
from lojas l
cross join (values
  ('Compra de mercadoria para revenda'),
  ('Matéria-prima'),
  ('Serviços'),
  ('Uso e consumo'),
  ('Embalagem'),
  ('Material de escritório'),
  ('Ativo imobilizado')
) as c(nome)
on conflict (loja_id, nome) do nothing;
