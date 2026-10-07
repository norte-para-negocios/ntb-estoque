-- GERADO por scripts/odara/moq-ens-odara.py. Banco postgres (Estoque), loja 15 (ODARA).
begin;
select set_config('ntb.sync_skip', '1', true);
create function pg_temp.fam(p_nome text) returns bigint language sql as $f$
  select codigo_familia from familias where loja_id = 15 and lower(nome) = lower(p_nome) order by inativo, id limit 1 $f$;
create function pg_temp.cp(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_produto into v from produtos where loja_id = 15 and (descricao = p_nome or codigo = p_nome) and not inativo and descricao not like '[%' order by id limit 1;
  if v is null then raise exception 'produto não encontrado: %', p_nome; end if;
  return v;
end $f$;
create function pg_temp.ficha(p_prod bigint, p_itens jsonb, p_obs text) returns void language plpgsql as $f$
declare v_itens jsonb := '[]'::jsonb; i jsonb;
begin
  for i in select * from jsonb_array_elements(p_itens) loop
    v_itens := v_itens || jsonb_build_object('codigo_insumo', pg_temp.cp(i ->> 0), 'quantidade_liquida', (i ->> 1)::numeric, 'fator_correcao', 1);
  end loop;
  perform salvar_ficha(15, p_prod, 1, v_itens, false, 'moq-ens-odara', p_obs);
end $f$;
create function pg_temp.aposentar(p_cp bigint) returns void language plpgsql as $f$
declare r record;
begin
  for r in select codigo_local_estoque, saldo from estoque_saldos where loja_id = 15 and codigo_produto = p_cp and saldo <> 0 loop
    perform registrar_movimento(15, r.codigo_local_estoque, p_cp, 'AJU', 'AJUSTE', 'moq-ens-odara-2026-10-07', -r.saldo, null, 'moq-ens-odara',
                                'Produto substituído por Moqueca/Ensopado com código próprio');
  end loop;
  update fichas_tecnicas set ativa = false where loja_id = 15 and codigo_produto = p_cp and ativa;
  update produtos set inativo = true, pdv = false, grupo_id = null, vendas_ref = null,
         descricao = case when descricao like '[%' then descricao else '[Substituído] ' || descricao end, updated_at = now()
   where loja_id = 15 and codigo_produto = p_cp;
end $f$;
create temp table mapa (item text, preparo text, codigo text, codigo_produto bigint, donana text);
-- 1) Matéria-prima e produtos em processo que faltavam (iguais à Donana)
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
select 15, novo_id_produto_proprio(), proximo_codigo_produto(15, '01'), 'GIN IMPORTADO (MP)', 'ML', '22085000', 0, false, '01', pg_temp.fam('Destilados'), 'Destilados', false, now()
 where not exists (select 1 from produtos where loja_id = 15 and descricao = 'GIN IMPORTADO (MP)' and not inativo);
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
select 15, novo_id_produto_proprio(), proximo_codigo_produto(15, '03'), 'PEIXE PESCADA AMARELA 600 g (PI)', 'UN', '03022900', 0, false, '03', pg_temp.fam('Produto Intermediário'), 'Produto Intermediário', false, now()
 where not exists (select 1 from produtos where loja_id = 15 and descricao = 'PEIXE PESCADA AMARELA 600 g (PI)' and not inativo);
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
select 15, novo_id_produto_proprio(), proximo_codigo_produto(15, '03'), 'FILE PESCADA 400 g (PI)', 'UN', '03022900', 0, false, '03', pg_temp.fam('Produto Intermediário'), 'Produto Intermediário', false, now()
 where not exists (select 1 from produtos where loja_id = 15 and descricao = 'FILE PESCADA 400 g (PI)' and not inativo);
select pg_temp.ficha(pg_temp.cp('PEIXE PESCADA AMARELA 600 g (PI)'), '[["PEIXE PESCADA AMARELA (MP)", 1.245902]]'::jsonb, 'Cópia literal da estrutura da Donana (Omie)');
select pg_temp.ficha(pg_temp.cp('FILE PESCADA 400 g (PI)'), '[["FILE DE PESCADA - G (MP)", 0.56]]'::jsonb, 'Cópia literal da estrutura da Donana (Omie)');
-- 2) Mãe + Moqueca + Ensopado para cada item; o produto antigo e os componentes "Preparo" são aposentados
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Camarão (200g)' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Camarão (200g)'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Camarão (200g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (200g)', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Camarão (200g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (200g)', 'Moqueca', v_cm, v_m, '90853');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Camarão (200g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (200g)', 'Ensopado', v_ce, v_e, '90856');
  perform pg_temp.ficha(v_m, '[["VINAGRETE (PI)", 0.02], ["ARROZ BCO (PI)", 0.2], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE DENDE (PI)", 0.055], ["AZEITE DE DENDE 2000 (MP)", 0.025], ["CAMARAO MOQ / ENS 200 g - (PI)", 0.2], ["TEMPERO LIQUIDO (PI)", 0.02], ["PIRAO DE DENDE (PI)", 0.27]]'::jsonb,
                        'Cópia literal da estrutura Donana 90853 Moqueca de Camarao Individual 200g - Pirao');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.02], ["ARROZ BCO (PI)", 0.093], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE MANTEIGA (PI)", 0.1], ["CAMARAO MOQ / ENS 200 g - (PI)", 0.2], ["EXTRATO DE TOMATE (MP)", 0.05], ["TEMPERO LIQUIDO (PI)", 0.02], ["PIRAO ENSOPADO (PI)", 0.27]]'::jsonb,
                        'Cópia literal da estrutura Donana 90856 Ensopado de Caramao Individual 200g - Pirão');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Camarão (400g)' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Camarão (400g)'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Camarão (400g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (400g)', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Camarão (400g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (400g)', 'Moqueca', v_cm, v_m, '90950');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Camarão (400g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Camarão (400g)', 'Ensopado', v_ce, v_e, '90206');
  perform pg_temp.ficha(v_m, '[["ARROZ BCO (PI)", 0.26], ["LEITE DE COCO (MOQ) (MP)", 350.0], ["FAROFA DE DENDE (PI)", 0.175], ["AZEITE DE DENDE 2000 (MP)", 0.05], ["CAMARAO MOQ / ENSO (PI)", 0.4], ["VINAGRETE (PI)", 0.04], ["TEMPERO LIQUIDO (PI)", 0.04], ["PIRAO DE DENDE (PI)", 0.375]]'::jsonb,
                        'Cópia literal da estrutura Donana 90950 Moqueca de Camarao 400 g - Pirao');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.26], ["LEITE DE COCO (MOQ) (MP)", 300.0], ["FAROFA DE MANTEIGA (PI)", 0.2], ["EXTRATO DE TOMATE (MP)", 0.13], ["TEMPERO LIQUIDO (PI)", 0.04], ["PIRAO ENSOPADO (PI)", 0.375], ["CAMARAO MOQ / ENSO (PI)", 0.4]]'::jsonb,
                        'Cópia literal da estrutura Donana 90206 Ensopado de Camarao 400 g - Pirão - P. P');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Pescada (500g)' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Pescada (500g)'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada (500g)', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada (500g)', 'Moqueca', v_cm, v_m, '90162');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada (500g)', 'Ensopado', v_ce, v_e, '90202');
  perform pg_temp.ficha(v_m, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.26], ["FAROFA DE DENDE (PI)", 0.175], ["AZEITE DE DENDE 2000 (MP)", 0.05], ["TEMPERO LIQUIDO (PI)", 0.04], ["LEITE DE COCO (BASE) (MP)", 300.0], ["PIRAO DE DENDE (PI)", 0.375], ["PEIXE PESCADA AMARELA 500 g (PI)", 1.0], ["FEIJAO FRADINHO (PI)", 0.444]]'::jsonb,
                        'Cópia literal da estrutura Donana 90162 Moqueca de Pescada 500g - Pirao + feijão da 90163');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.26], ["FAROFA DE MANTEIGA (PI)", 0.2], ["EXTRATO DE TOMATE (MP)", 0.13], ["TEMPERO LIQUIDO (PI)", 0.04], ["LEITE DE COCO (BASE) (MP)", 300.0], ["PIRAO ENSOPADO (PI)", 0.375], ["PEIXE PESCADA AMARELA 500 g (PI)", 1.0], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90202 Ensopado de Pescada 500g - Pirão + feijão da 90203');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Pescada e Camarão' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Pescada e Camarão'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada e Camarão', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada e Camarão', 'Moqueca', v_cm, v_m, '90491');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada e Camarão', 'Ensopado', v_ce, v_e, '90495');
  perform pg_temp.ficha(v_m, '[["LEITE DE COCO (MOQ) (MP)", 100.0], ["ARROZ BCO (PI)", 0.4], ["FAROFA DE DENDE (PI)", 0.175], ["VINAGRETE (PI)", 0.04], ["AZEITE DE DENDE 2000 (MP)", 0.0545], ["CAMARAO MOQ / ENS 300 g - (PI)", 1.0], ["TEMPERO LIQUIDO (PI)", 0.04], ["PEIXE PESCADA AMARELA 500 g (PI)", 1.0], ["LEITE DE COCO (BASE) (MP)", 200.0], ["PIRAO DE DENDE (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90491 Moqueca Peixe Pescada C/ Camarao- Pirao + feijão da 90489');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.28], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE MANTEIGA (PI)", 0.2], ["CAMARAO MOQ / ENS 300 g - (PI)", 1.0], ["EXTRATO DE TOMATE (MP)", 0.13], ["TEMPERO LIQUIDO (PI)", 0.04], ["LEITE DE COCO (BASE) (MP)", 200.0], ["PEIXE PESCADA AMARELA 500 g (PI)", 1.0], ["PIRAO ENSOPADO (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90495 Ensopado Peixe Pescada C/ Camarao-Pirao + feijão da 90493');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Filé de Pescada (500g)' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Filé de Pescada (500g)'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Filé de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada (500g)', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Filé de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada (500g)', 'Moqueca', v_cm, v_m, '90174');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Filé de Pescada (500g)', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada (500g)', 'Ensopado', v_ce, v_e, '90214');
  perform pg_temp.ficha(v_m, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.26], ["LEITE DE COCO (MOQ) (MP)", 300.0], ["FAROFA DE DENDE (PI)", 0.175], ["AZEITE DE DENDE 2000 (MP)", 0.0545], ["TEMPERO LIQUIDO (PI)", 0.04], ["FILE PESCADA 450 g (PI)", 1.111111], ["PIRAO DE DENDE (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90174 Moqueca de File de Pescada 450g - Pirao + feijão da 90175 · FILE PESCADA 450 g (PI) x1.1111 (gramatura ODARA)');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.26], ["LEITE DE COCO (MOQ) (MP)", 300.0], ["FAROFA DE MANTEIGA (PI)", 0.2], ["PEIXE PESCADA AMARELA 600 g (PI)", 1.0], ["EXTRATO DE TOMATE (MP)", 0.13], ["TEMPERO LIQUIDO (PI)", 0.04], ["FILE PESCADA 450 g (PI)", 1.111111], ["PIRAO ENSOPADO (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90214 Ensopado de Filé de Pescada 450g - Pirão + feijão da 90215 · FILE PESCADA 450 g (PI) x1.1111 (gramatura ODARA)');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Filé de Pescada e Camarão' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Filé de Pescada e Camarão'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Filé de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada e Camarão', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Filé de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada e Camarão', 'Moqueca', v_cm, v_m, '90556');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Filé de Pescada e Camarão', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Filé de Pescada e Camarão', 'Ensopado', v_ce, v_e, '90557');
  perform pg_temp.ficha(v_m, '[["LEITE DE COCO (MOQ) (MP)", 100.0], ["ARROZ BCO (PI)", 0.4], ["FAROFA DE DENDE (PI)", 0.175], ["VINAGRETE (PI)", 0.04], ["AZEITE DE DENDE 2000 (MP)", 0.0545], ["TEMPERO LIQUIDO (PI)", 0.04], ["CAMARAO MOQ / ENS 300 g - (PI)", 1.0], ["LEITE DE COCO (BASE) (MP)", 200.0], ["PEIXE PESCADA AMARELA 500 g (PI)", 1.0], ["PIRAO DE DENDE (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90556 Moqueca Filé de Pescada C/ Camarao- Pirao + feijão da 90554');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.04], ["ARROZ BCO (PI)", 0.28], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE MANTEIGA (PI)", 0.2], ["CAMARAO MOQ / ENS 300 g - (PI)", 1.0], ["EXTRATO DE TOMATE (MP)", 0.13], ["TEMPERO LIQUIDO (PI)", 0.04], ["LEITE DE COCO (BASE) (MP)", 200.0], ["FILE PESCADA 400 g (PI)", 1.0], ["PIRAO ENSOPADO (PI)", 0.375], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb,
                        'Cópia literal da estrutura Donana 90557 Ensopado File de Pescada C/ Camarao- Pirao + feijão da 90559');
end $$;
do $$
declare v_old produtos%rowtype; v_mae bigint; v_m bigint; v_e bigint; v_cm text; v_ce text; v_cmae text;
begin
  select * into v_old from produtos where loja_id = 15 and descricao = 'Moqueca ou Ensopado de Pescada Individual' and not inativo;
  if v_old.id is null then raise exception 'item não encontrado: %', 'Moqueca ou Ensopado de Pescada Individual'; end if;
  perform pg_temp.aposentar(v_old.codigo_produto);
  v_mae := novo_id_produto_proprio(); v_cmae := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, eh_mae, inativo, vendas_ref, updated_at)
  values (15, v_mae, v_cmae, 'Moqueca ou Ensopado de Pescada Individual', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, true, false, v_old.vendas_ref, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada Individual', 'mae', v_cmae, v_mae, null);
  v_m := novo_id_produto_proprio(); v_cm := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_m, v_cm, 'Moqueca de Pescada Individual', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Moqueca"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada Individual', 'Moqueca', v_cm, v_m, '90894');
  v_e := novo_id_produto_proprio(); v_ce := proximo_codigo_produto(15, '04');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia,
                        grupo_id, produto_pai_codigo, atributos, inativo, updated_at)
  values (15, v_e, v_ce, 'Ensopado de Pescada Individual', 'UN', v_old.ncm, v_old.valor_unitario, true, '04', v_old.codigo_familia, v_old.descricao_familia,
          v_old.grupo_id, v_mae, '{"Preparo": "Ensopado"}'::jsonb, false, now());
  insert into mapa values ('Moqueca ou Ensopado de Pescada Individual', 'Ensopado', v_ce, v_e, '90898');
  perform pg_temp.ficha(v_m, '[["VINAGRETE (PI)", 0.02], ["ARROZ BCO (PI)", 0.2], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE DENDE (PI)", 0.055], ["AZEITE DE DENDE 2000 (MP)", 0.025], ["TEMPERO LIQUIDO (PI)", 0.02], ["PEIXE PESCADA AMARELA 200 g (PI)", 1.0], ["PIRAO DE DENDE (PI)", 0.27]]'::jsonb,
                        'Cópia literal da estrutura Donana 90894 Moqueca de Pescada Individual 200g - Pirao');
  perform pg_temp.ficha(v_e, '[["VINAGRETE (PI)", 0.02], ["ARROZ BCO (PI)", 0.093], ["LEITE DE COCO (MOQ) (MP)", 100.0], ["FAROFA DE MANTEIGA (PI)", 0.1], ["EXTRATO DE TOMATE (MP)", 0.05], ["TEMPERO LIQUIDO (PI)", 0.02], ["PEIXE PESCADA AMARELA 200 g (PI)", 1.0], ["PIRAO ENSOPADO (PI)", 0.27]]'::jsonb,
                        'Cópia literal da estrutura Donana 90898 Ensopado de Pescada Individual 200g - Pirão');
end $$;
select pg_temp.aposentar(codigo_produto) from produtos where loja_id = 15 and descricao = 'Preparo Moqueca - porção inteira (PI)' and not inativo;
select pg_temp.aposentar(codigo_produto) from produtos where loja_id = 15 and descricao = 'Preparo Moqueca - porção individual (PI)' and not inativo;
select pg_temp.aposentar(codigo_produto) from produtos where loja_id = 15 and descricao = 'Preparo Ensopado - porção inteira (PI)' and not inativo;
select pg_temp.aposentar(codigo_produto) from produtos where loja_id = 15 and descricao = 'Preparo Ensopado - porção individual (PI)' and not inativo;
-- 3) Fichas trocadas pela estrutura literal da Donana
select pg_temp.ficha(pg_temp.cp('90047'), '[["FAROFA DE MANTEIGA (PI)", 0.165], ["VINAGRETE (PI)", 0.15], ["ALFACE CRESPA (MP)", 0.02], ["ARROZ BCO (PI)", 0.28], ["PEIXE PESCADA AMARELA 600 g (PI)", 1.0], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb, 'Cópia literal da estrutura Donana 90472 Peixe Frito REFEICAO- Pescada 500g Fradinho');
select pg_temp.ficha(pg_temp.cp('90036'), '[["VINAGRETE (PI)", 0.15], ["FAROFA DE MANTEIGA (PI)", 0.165], ["PEIXE VERMELHO INTEIRO 1 KG (PI)", 1.0], ["LIMAO TAHITI (MP)", 0.05], ["SAL FINO (MP)", 0.03], ["TEMPERO LIQUIDO (PI)", 0.06], ["FARINHA DE TRIGO (MP)", 0.05], ["OLEO SOJA (MP)", 500.0], ["ALFACE CRESPA (MP)", 0.01], ["ARROZ BCO (PI)", 0.4], ["FEIJAO FRADINHO (PI)", 0.315]]'::jsonb, 'Cópia literal da estrutura Donana 90139 Peixe Frito - Vermelho 1 Kg - Fradinho');
select pg_temp.ficha(pg_temp.cp('90065'), '[["GIN IMPORTADO (MP)", 60.0], ["Tonica Antarctica 350 ML", 1.0]]'::jsonb, 'Cópia literal da estrutura Donana 90609 Gin Importado c/ Tônica');
select item, preparo, codigo, donana from mapa order by item, preparo;
