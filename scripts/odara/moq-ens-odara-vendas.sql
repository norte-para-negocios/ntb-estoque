-- GERADO a partir dos códigos criados por moq-ens-odara.sql (Estoque). Banco ntb_vendas, loja ODARA.
-- Produto do cardápio fica sem código próprio (mãe = estoque_pai_codigo) e cada opção de "Preparo" ganha o código da variação.
begin;
select set_config('ntb.sync_skip', '1', true);
update products set omie_codigo = null, estoque_pai_codigo = '90085', estoque_sync_at = now() where id = '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90087', estoque_preco = (select price from products where id = '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4')
    from product_option_groups g where o.group_id = g.id and g.product_id = '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90086', estoque_preco = (select price from products where id = '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4')
    from product_option_groups g where o.group_id = g.id and g.product_id = '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', '0aaa0231-067b-4674-b8d4-9fc66dfb2fc4'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90079', estoque_sync_at = now() where id = '22639db6-c874-43b0-8bd0-c326d3ab2fef' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90081', estoque_preco = (select price from products where id = '22639db6-c874-43b0-8bd0-c326d3ab2fef')
    from product_option_groups g where o.group_id = g.id and g.product_id = '22639db6-c874-43b0-8bd0-c326d3ab2fef' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', '22639db6-c874-43b0-8bd0-c326d3ab2fef'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90080', estoque_preco = (select price from products where id = '22639db6-c874-43b0-8bd0-c326d3ab2fef')
    from product_option_groups g where o.group_id = g.id and g.product_id = '22639db6-c874-43b0-8bd0-c326d3ab2fef' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', '22639db6-c874-43b0-8bd0-c326d3ab2fef'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90076', estoque_sync_at = now() where id = '284075cb-3ad2-451c-9e54-b710c605a627' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90078', estoque_preco = (select price from products where id = '284075cb-3ad2-451c-9e54-b710c605a627')
    from product_option_groups g where o.group_id = g.id and g.product_id = '284075cb-3ad2-451c-9e54-b710c605a627' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', '284075cb-3ad2-451c-9e54-b710c605a627'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90077', estoque_preco = (select price from products where id = '284075cb-3ad2-451c-9e54-b710c605a627')
    from product_option_groups g where o.group_id = g.id and g.product_id = '284075cb-3ad2-451c-9e54-b710c605a627' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', '284075cb-3ad2-451c-9e54-b710c605a627'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90070', estoque_sync_at = now() where id = '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90072', estoque_preco = (select price from products where id = '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2')
    from product_option_groups g where o.group_id = g.id and g.product_id = '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90071', estoque_preco = (select price from products where id = '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2')
    from product_option_groups g where o.group_id = g.id and g.product_id = '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', '84b6dc4b-15fd-4b24-bc3b-3cb0c13960c2'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90067', estoque_sync_at = now() where id = '8f157e78-b34d-4721-8688-472059efa9b3' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90069', estoque_preco = (select price from products where id = '8f157e78-b34d-4721-8688-472059efa9b3')
    from product_option_groups g where o.group_id = g.id and g.product_id = '8f157e78-b34d-4721-8688-472059efa9b3' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', '8f157e78-b34d-4721-8688-472059efa9b3'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90068', estoque_preco = (select price from products where id = '8f157e78-b34d-4721-8688-472059efa9b3')
    from product_option_groups g where o.group_id = g.id and g.product_id = '8f157e78-b34d-4721-8688-472059efa9b3' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', '8f157e78-b34d-4721-8688-472059efa9b3'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90073', estoque_sync_at = now() where id = 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90075', estoque_preco = (select price from products where id = 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2')
    from product_option_groups g where o.group_id = g.id and g.product_id = 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90074', estoque_preco = (select price from products where id = 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2')
    from product_option_groups g where o.group_id = g.id and g.product_id = 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', 'd1c3f647-85f9-4652-be3a-cdd94ef5afa2'; end if;
end $$;
update products set omie_codigo = null, estoque_pai_codigo = '90082', estoque_sync_at = now() where id = 'ebc85f71-971b-4e21-95cf-33917606f329' and store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94';
do $$ declare n int; begin
  update product_options o set omie_codigo = '90084', estoque_preco = (select price from products where id = 'ebc85f71-971b-4e21-95cf-33917606f329')
    from product_option_groups g where o.group_id = g.id and g.product_id = 'ebc85f71-971b-4e21-95cf-33917606f329' and g.name = 'Preparo' and o.name = 'Ensopado';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Ensopado', 'ebc85f71-971b-4e21-95cf-33917606f329'; end if;
end $$;
do $$ declare n int; begin
  update product_options o set omie_codigo = '90083', estoque_preco = (select price from products where id = 'ebc85f71-971b-4e21-95cf-33917606f329')
    from product_option_groups g where o.group_id = g.id and g.product_id = 'ebc85f71-971b-4e21-95cf-33917606f329' and g.name = 'Preparo' and o.name = 'Moqueca';
  get diagnostics n = row_count; if n <> 1 then raise exception 'opção % de % não encontrada', 'Moqueca', 'ebc85f71-971b-4e21-95cf-33917606f329'; end if;
end $$;
select p.name, o.name, o.omie_codigo, p.omie_codigo, p.estoque_pai_codigo from products p join product_option_groups g on g.product_id = p.id join product_options o on o.group_id = g.id
 where p.store_id = 'e73782c1-fb1a-44a5-904c-e942341d9a94' and p.available and g.name = 'Preparo' order by 1, 2;
