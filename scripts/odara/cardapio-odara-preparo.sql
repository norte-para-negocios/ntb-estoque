begin;
do $$
declare s uuid := 'e73782c1-fb1a-44a5-904c-e942341d9a94'; r record; og uuid;
begin
  for r in select * from (values
    ('Moqueca de Camarão (200g)',            'Moqueca ou Ensopado de Camarão (200g)'),
    ('Moqueca de Camarão (400g)',            'Moqueca ou Ensopado de Camarão (400g)'),
    ('Moqueca de Pescada (500g)',            'Moqueca ou Ensopado de Pescada (500g)'),
    ('Moqueca de Pescada e Camarão',         'Moqueca ou Ensopado de Pescada e Camarão'),
    ('Moqueca de Filé de Pescada (500g)',    'Moqueca ou Ensopado de Filé de Pescada (500g)'),
    ('Moqueca de Filé de Pescada e Camarão', 'Moqueca ou Ensopado de Filé de Pescada e Camarão'),
    ('Moqueca de Pescada Individual',        'Moqueca ou Ensopado de Pescada Individual')
  ) t(antigo, novo) loop
    update products set name = r.novo where store_id = s and name = r.antigo and available returning id into og;
    if og is null then raise exception 'não achei %', r.antigo; end if;
    insert into product_option_groups (product_id, name, type, required, "order", min_select, max_select)
    values (og, 'Preparo', 'single', true, 0, 1, 1) returning id into og;
    insert into product_options (group_id, name, price_delta, "order", available) values (og, 'Moqueca', 0, 0, true), (og, 'Ensopado', 0, 1, true);
  end loop;
end $$;
select p.name, string_agg(o.name, ' / ' order by o."order") from products p join product_option_groups g on g.product_id=p.id join product_options o on o.group_id=g.id
 where p.store_id='e73782c1-fb1a-44a5-904c-e942341d9a94' and p.available group by p.name order by 1;
