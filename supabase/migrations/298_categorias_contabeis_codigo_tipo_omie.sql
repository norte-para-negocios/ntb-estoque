-- 298 — Categorias contábeis com o código e o tipo do Omie, e as categorias de compra do Omie (Donana) na ODARA.
-- tipo (REV/MAT/USO/ATV) é o mesmo que o Omie usa para ligar categoria a produto: REV = revenda/embalagem, MAT = matéria-prima, USO = uso e consumo, ATV = ativo.
alter table categorias_contabeis add column if not exists codigo text;
alter table categorias_contabeis add column if not exists tipo text;
alter table categorias_contabeis drop constraint if exists categorias_contabeis_tipo_chk;
alter table categorias_contabeis add constraint categorias_contabeis_tipo_chk check (tipo is null or tipo in ('REV', 'MAT', 'USO', 'ATV'));
create unique index if not exists categorias_contabeis_loja_codigo on categorias_contabeis (loja_id, codigo) where codigo is not null;

-- ODARA (loja 15): troca as 8 categorias genéricas da 297 (nenhuma usada) pelas de compra do Omie. Só mexe nas que ninguém usou.
delete from categorias_contabeis c
where c.loja_id = 15 and c.codigo is null
  and not exists (select 1 from nota_fiscal_items i where i.categoria_contabil_id = c.id)
  and not exists (select 1 from fin_categorias f where f.categoria_contabil_id = c.id);

insert into categorias_contabeis (loja_id, codigo, nome, tipo)
select 15, v.codigo, v.nome, v.tipo
from (values
  ('2.01.01', 'Compras de Mercadorias para Revenda', 'REV'),
  ('2.01.02', 'Frete', null),
  ('2.01.03', 'Compras de Materia Prima', 'MAT'),
  ('2.01.04', 'Compra de Serviços', null),
  ('2.01.77', 'Compra para os sócios', 'USO'),
  ('2.01.78', 'Combustíveis', 'USO'),
  ('2.01.79', 'Manutencao e Reparo', 'USO'),
  ('2.01.80', 'Bens de pequeno valor', 'USO'),
  ('2.01.81', 'Manutencao de Veiculos', 'USO'),
  ('2.01.82', 'Descartaveis', 'USO'),
  ('2.01.83', 'Copa e Cozinha', 'USO'),
  ('2.01.84', 'Outras Entradas de Mercadoria', 'USO'),
  ('2.01.85', 'Compra de Gas', 'USO'),
  ('2.01.86', 'Uso e Consumo Difal Fora do Estado', 'USO'),
  ('2.01.87', 'Compra de Mercadoria para Revenda Fora do Estado', 'REV'),
  ('2.01.88', 'Material de Escritório', 'USO'),
  ('2.01.89', 'Comodato', 'ATV'),
  ('2.01.90', 'Ativo Imobilizado', 'ATV'),
  ('2.01.91', 'Bonificação', 'USO'),
  ('2.01.92', 'Higiene e Material de limpeza', 'USO'),
  ('2.01.93', 'Serviços Gráficos', null),
  ('2.01.94', 'Serviço de Manutenção de Equipamentos', null),
  ('2.01.95', 'Serviço de Manutenção Predial', null),
  ('2.01.96', 'Embalagens', 'REV'),
  ('2.01.97', 'Uso e Consumo', 'USO'),
  ('2.01.98', 'Compra para socios', null),
  ('2.01.99', 'Feira', null)
) as v(codigo, nome, tipo)
where exists (select 1 from lojas where id = 15)
on conflict (loja_id, nome) do update set codigo = excluded.codigo, tipo = excluded.tipo;
