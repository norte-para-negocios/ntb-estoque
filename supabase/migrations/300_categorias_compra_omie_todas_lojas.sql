-- 300 — Categorias de compra do Omie (código, nome e tipo) em todas as lojas, como já está na ODARA (298).
-- Serve para mostrar o nome da categoria que a nota já traz do Omie (infoAdicionais.cCategCompra) e para "Classificar pelos produtos".
-- Só troca as categorias genéricas que ninguém usou; o que já foi usado em item de nota ou no financeiro fica.
delete from categorias_contabeis c
where c.loja_id <> 15 and c.codigo is null
  and not exists (select 1 from nota_fiscal_items i where i.categoria_contabil_id = c.id)
  and not exists (select 1 from fin_categorias f where f.categoria_contabil_id = c.id);

insert into categorias_contabeis (loja_id, codigo, nome, tipo)
select l.id, v.codigo, v.nome, v.tipo
from lojas l
cross join (values
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
where l.id <> 15
on conflict (loja_id, nome) do update set codigo = excluded.codigo, tipo = excluded.tipo;
