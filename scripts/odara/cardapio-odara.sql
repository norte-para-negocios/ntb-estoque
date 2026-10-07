-- Cardápio real da ODARA BEACH (fotos do cardápio impresso, 07/10/2026). Roda no banco ntb_vendas.
-- Os produtos de teste ficam indisponíveis e sem categoria (têm venda registrada, não dá para apagar).
-- A sincronização Vendas -> Estoque cria os produtos no Estoque com código por tipo e devolve o código.
begin;
do $$
declare
  s uuid := 'e73782c1-fb1a-44a5-904c-e942341d9a94';
  g_beb uuid; g_com uuid; c uuid; p uuid; og uuid;
  r record;
begin
  -- 1) tira o cardápio de teste
  update products set available = false, category_id = null where store_id = s;
  delete from categories where store_id = s;
  delete from category_groups where store_id = s;

  -- 2) grupos
  insert into category_groups (store_id, name, "order") values (s, 'Bebidas', 0) returning id into g_beb;
  insert into category_groups (store_id, name, "order") values (s, 'Comidas', 1) returning id into g_com;

  -- 3) categorias e produtos: (categoria, grupo, ordem da categoria, nome, preço, destino, ncm, descrição)
  for r in select * from (values
    ('Cervejas 600ml',        'B', 0, 'Cerveja Black Princess 600ml',          23.00, 'bar',     '22030000', null),
    ('Cervejas 600ml',        'B', 0, 'Cerveja Império Gold 600ml',            22.00, 'bar',     '22030000', null),
    ('Cervejas 600ml',        'B', 0, 'Cerveja Petra 600ml',                   20.00, 'bar',     '22030000', null),
    ('Cervejas Long Neck',    'B', 1, 'Cerveja Black Princess Long Neck',      18.00, 'bar',     '22030000', null),
    ('Cervejas Long Neck',    'B', 1, 'Cerveja Petra Long Neck',               15.00, 'bar',     '22030000', null),
    ('Drinks',                'B', 2, 'Caipirinha',                            27.00, 'bar',     '22089000', null),
    ('Drinks',                'B', 2, 'Roska Nacional',                        30.00, 'bar',     '22089000', 'Caipiroska com vodka nacional'),
    ('Drinks',                'B', 2, 'Roska Importada',                       35.00, 'bar',     '22089000', 'Caipiroska com vodka importada'),
    ('Drinks',                'B', 2, 'Gin Tônica',                            35.00, 'bar',     '22089000', null),
    ('Drinks',                'B', 2, 'Aperol Spritz',                         35.00, 'bar',     '22089000', null),
    ('Águas',                 'B', 3, 'Água sem Gás',                          10.00, 'bar',     '22011000', null),
    ('Águas',                 'B', 3, 'Água com Gás',                          10.00, 'bar',     '22011000', null),
    ('Bebidas sem Álcool',    'B', 4, 'Refrigerante',                          10.00, 'bar',     '22021000', null),
    ('Bebidas sem Álcool',    'B', 4, 'Red Bull',                              22.00, 'bar',     '22029900', null),
    ('Bebidas sem Álcool',    'B', 4, 'H2O',                                   10.00, 'bar',     '22021000', null),
    ('Bebidas sem Álcool',    'B', 4, 'Suco Copo 300ml',                       12.00, 'bar',     '20098990', null),
    ('Bebidas sem Álcool',    'B', 4, 'Coco Verde',                            10.00, 'bar',     '08011900', null),
    ('Bebidas sem Álcool',    'B', 4, 'Cerveja Long Neck sem Álcool',          18.00, 'bar',     '22029100', null),
    ('Caldos',                'C', 0, 'Caldo de Sururu',                       34.90, 'kitchen', '21041011', null),
    ('Caldos',                'C', 0, 'Caldo de Camarão',                      36.90, 'kitchen', '21041011', null),
    ('Caldos',                'C', 0, 'Caldo Misto',                           36.90, 'kitchen', '21041011', null),
    ('Petiscos',              'C', 1, 'Bolinho de Peixe (4 unidades)',         29.90, 'kitchen', '16042090', null),
    ('Petiscos',              'C', 1, 'Bolinho de Camarão (4 unidades)',       32.90, 'kitchen', '16052900', null),
    ('Petiscos',              'C', 1, 'Bolinho de Queijo (4 unidades)',        29.90, 'kitchen', '19059090', null),
    ('Petiscos',              'C', 1, 'Queijo Coalho (200g)',                  44.90, 'kitchen', '04069090', null),
    ('Petiscos',              'C', 1, 'Casquinha de Siri',                     39.90, 'kitchen', '16051000', null),
    ('Petiscos',              'C', 1, 'Batata Frita (350g)',                   34.90, 'kitchen', '20041000', null),
    ('Petiscos',              'C', 1, 'Camarão Alho e Óleo (300g)',            99.90, 'kitchen', '16052900', null),
    ('Petiscos',              'C', 1, 'Isca de Peixe (400g)',                  74.90, 'kitchen', '16042090', null),
    ('Petiscos',              'C', 1, 'Arrumadinho de Carne do Sol (300g)',    89.90, 'kitchen', '21069090', null),
    ('Petiscos',              'C', 1, 'Carne do Sol (300g)',                   89.90, 'kitchen', '02102000', 'Acompanha batata frita ou farofa e vinagrete'),
    ('Petiscos',              'C', 1, 'Acarajé ou Abará',                      45.00, 'kitchen', '21069090', '8 bolinhos de acarajé ou 6 mini abarás. Acompanha vatapá, camarão, salada e pimenta'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Camarão (200g)',            104.90, 'kitchen', '16052900', 'Acompanha arroz, pirão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Camarão (400g)',            174.90, 'kitchen', '16052900', 'Acompanha arroz, pirão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Pescada (500g)',            169.90, 'kitchen', '16042090', 'Acompanha arroz, pirão, feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Pescada e Camarão',         214.90, 'kitchen', '16042090', 'Acompanha arroz, pirão, feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Filé de Pescada (500g)',    179.90, 'kitchen', '16042090', 'Acompanha arroz, pirão, feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Filé de Pescada e Camarão', 219.90, 'kitchen', '16042090', 'Acompanha arroz, pirão, feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Pescada Posta Frita (500g)',           169.90, 'kitchen', '16042090', 'Acompanha arroz, feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Vermelho Frito Inteiro',               219.90, 'kitchen', '16042090', 'Peixe inteiro, com a cabeça. Acompanha feijão e farofa'),
    ('Moquecas e Ensopados',  'C', 2, 'Moqueca de Pescada Individual',         89.90, 'kitchen', '16042090', 'Acompanha arroz, pirão e farofa'),
    ('Guarnições',            'C', 3, 'Porção de Farofa',                      20.00, 'kitchen', '11062000', null),
    ('Guarnições',            'C', 3, 'Porção de Arroz',                       20.00, 'kitchen', '19049000', null),
    ('Guarnições',            'C', 3, 'Porção de Feijão',                      25.00, 'kitchen', '20055900', null),
    ('Guarnições',            'C', 3, 'Porção de Pirão',                       25.00, 'kitchen', '21041011', null),
    ('Guarnições',            'C', 3, 'Porção de Vinagrete',                   20.00, 'kitchen', '20059900', null),
    ('Sobremesas',            'C', 4, 'Ambrosia',                              24.90, 'kitchen', '21069090', null),
    ('Sobremesas',            'C', 4, 'Cocada',                                29.90, 'kitchen', '17049090', null),
    ('Sobremesas',            'C', 4, 'Picolé',                                10.90, 'bar',     '21050010', null)
  ) as t(cat, grp, cat_ordem, nome, preco, dest, ncm, descr)
  loop
    select id into c from categories where store_id = s and name = r.cat;
    if c is null then
      insert into categories (store_id, name, "order", group_id)
      values (s, r.cat, r.cat_ordem, case r.grp when 'B' then g_beb else g_com end) returning id into c;
    end if;
    insert into products (store_id, category_id, name, description, price, destination, ncm, available, "order")
    values (s, c, r.nome, r.descr, r.preco, r.dest, r.ncm, true,
            (select count(*) from products where category_id = c))
    returning id into p;

    -- escolhas obrigatórias (sem código: não mexem em estoque)
    if r.nome = 'Carne do Sol (300g)' then
      insert into product_option_groups (product_id, name, type, required, "order", min_select, max_select)
      values (p, 'Acompanhamento', 'single', true, 0, 1, 1) returning id into og;
      insert into product_options (group_id, name, price_delta, "order", available) values (og, 'Batata frita', 0, 0, true), (og, 'Farofa', 0, 1, true);
    elsif r.nome = 'Acarajé ou Abará' then
      insert into product_option_groups (product_id, name, type, required, "order", min_select, max_select)
      values (p, 'Escolha', 'single', true, 0, 1, 1) returning id into og;
      insert into product_options (group_id, name, price_delta, "order", available) values (og, '8 bolinhos de acarajé', 0, 0, true), (og, '6 mini abarás', 0, 1, true);
    end if;
  end loop;
end $$;

select c.name as categoria, count(*) as itens from products p join categories c on c.id = p.category_id
 where p.store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94' group by 1 order by 1;
