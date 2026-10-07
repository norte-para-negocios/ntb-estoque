-- GERADO por scripts/odara/fichas-odara.py (não editar à mão). Estoque, banco postgres. Ver docstring do gerador.
begin;
create function pg_temp.fam(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_familia into v from familias where loja_id = 15 and lower(nome) = lower(p_nome) order by inativo, id limit 1;
  if v is null then
    insert into familias (loja_id, codigo_familia, nome, inativo, origem) values (15, nextval('seq_id_produto_proprio'), p_nome, false, 'local') returning codigo_familia into v;
  else update familias set inativo = false where loja_id = 15 and codigo_familia = v and inativo; end if;
  return v;
end $f$;
create function pg_temp.prod(p_nome text, p_un text, p_ncm text, p_tipo text, p_fam text) returns bigint language plpgsql as $f$
declare v bigint; v_cod text; v_f bigint := pg_temp.fam(p_fam);
begin
  select codigo_produto into v from produtos where loja_id = 15 and descricao = p_nome and not inativo and codigo not like '[%' order by id limit 1;
  if v is null then
    v_cod := proximo_codigo_produto(15, p_tipo); v := novo_id_produto_proprio();
    insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm, valor_unitario, pdv, tipo_item, codigo_familia, descricao_familia, inativo, updated_at)
    values (15, v, v_cod, p_nome, p_un, p_ncm, 0, false, p_tipo, v_f, p_fam, false, now());
  else
    update produtos set codigo_familia = v_f, descricao_familia = p_fam where loja_id = 15 and codigo_produto = v;
  end if;
  return v;
end $f$;
create function pg_temp.cp(p_nome text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  select codigo_produto into v from produtos where loja_id = 15 and (descricao = p_nome or codigo = p_nome) and not inativo order by id limit 1;
  if v is null then raise exception 'produto não encontrado: %', p_nome; end if;
  return v;
end $f$;
create function pg_temp.ficha(p_prod text, p_expandir boolean, p_itens jsonb) returns void language plpgsql as $f$
declare v_p bigint := pg_temp.cp(p_prod); v_itens jsonb := '[]'::jsonb; i jsonb;
begin
  if exists (select 1 from fichas_tecnicas where loja_id = 15 and codigo_produto = v_p and ativa and criada_por = 'fichas-odara') then return; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    v_itens := v_itens || jsonb_build_object('codigo_insumo', pg_temp.cp(i ->> 0), 'quantidade_liquida', (i ->> 1)::numeric, 'fator_correcao', 1);
  end loop;
  perform salvar_ficha(15, v_p, 1, v_itens, p_expandir, 'fichas-odara', 'Estrutura baseada na Donana (Omie), adaptada à porção da ODARA');
end $f$;
-- 1) Cardápio/insumos de teste: zera saldo com ajuste, desativa fichas, inativa, marca [Teste]; apaga o que não tem movimento
do $$ declare r record; begin
  for r in select s.codigo_local_estoque, s.codigo_produto, s.saldo from estoque_saldos s join produtos p on p.loja_id = 15 and p.codigo_produto = s.codigo_produto
            where s.loja_id = 15 and s.saldo <> 0 and p.codigo in ('70001','70002','80001','80002','80003','80004','80005','80006','80007','80008','80009','80010','80011','80012','80013','80014','80015','80016','90001','90002','90003','90004','90005','90006','90007','90008','90009','90010','90011','90012','90013','90014','90015','90016') loop
    perform registrar_movimento(15, r.codigo_local_estoque, r.codigo_produto, 'AJU', 'AJUSTE', 'limpeza-teste-odara-2026-10-07', -r.saldo, null, 'fichas-odara', 'Zera saldo de teste (semente/QA): estoque real começa no primeiro inventário');
  end loop;
  update fichas_tecnicas set ativa = false where loja_id = 15 and ativa and codigo_produto in (select codigo_produto from produtos where loja_id = 15 and codigo in ('70001','70002','80001','80002','80003','80004','80005','80006','80007','80008','80009','80010','80011','80012','80013','80014','80015','80016','90001','90002','90003','90004','90005','90006','90007','90008','90009','90010','90011','90012','90013','90014','90015','90016'));
  for r in select codigo_produto, codigo from produtos where loja_id = 15 and codigo in ('70001','70002','80001','80002','80003','80004','80005','80006','80007','80008','80009','80010','80011','80012','80013','80014','80015','80016','90001','90002','90003','90004','90005','90006','90007','90008','90009','90010','90011','90012','90013','90014','90015','90016') loop
    if not exists (select 1 from estoque_movimentos m where m.loja_id = 15 and m.codigo_produto = r.codigo_produto)
       and not exists (select 1 from ficha_tecnica_itens fi where fi.loja_id = 15 and fi.codigo_insumo = r.codigo_produto)
       and not exists (select 1 from fichas_tecnicas ft where ft.loja_id = 15 and ft.codigo_produto = r.codigo_produto) then
      begin
        delete from produtos where loja_id = 15 and codigo_produto = r.codigo_produto;
        continue;
      exception when foreign_key_violation then null; end;
    end if;
    update produtos set inativo = true, grupo_id = null, pdv = false,
           descricao = case when descricao like '[Teste]%' then descricao else '[Teste] ' || descricao end
     where loja_id = 15 and codigo_produto = r.codigo_produto;
  end loop;
end $$;
update familias set inativo = true where loja_id = 15 and nome in ('Insumos de bar', 'Insumos de cozinha', 'Pratos e petiscos');
do $$ begin
  update produtos set grupo_id = null where loja_id = 15 and grupo_id in (select id from grupos_produto where loja_id = 15 and not ativo);
  delete from grupos_produto where loja_id = 15 and not ativo;
exception when others then raise notice 'grupos de teste ficaram inativos: %', sqlerrm; end $$;
-- 2) Matérias-primas e produtos em processo (nome/unidade/NCM/tipo/família da Donana)
select pg_temp.prod('ACUCAR CRISTAL (MP)', 'KG', '17019900', '01', 'Atacado');
select pg_temp.prod('BATATA PRE-FRITA (MP)', 'KG', '20041000', '01', 'Atacado');
select pg_temp.prod('ALFACE CRESPA (MP)', 'KG', '07051100', '01', 'Horti - Frut');
select pg_temp.prod('ALHO (MP)', 'KG', '07032010', '01', 'Horti - Frut');
select pg_temp.prod('AMENDOIM TORRADO (MP)', 'KG', '20081100', '01', 'Feira');
select pg_temp.prod('ARROZ BCO (MP)', 'KG', '10063021', '01', 'Atacado');
select pg_temp.prod('AZEITE DE DENDE 2000 (MP)', 'L', '15111000', '01', 'Feira');
select pg_temp.prod('BATATA INGLESA (MP)', 'KG', '07011000', '01', 'Horti - Frut');
select pg_temp.prod('CACHAÇA 51 (MP)', 'ML', '22084000', '01', 'Destilados');
select pg_temp.prod('CAMARAO CONG 41/50 (MP)', 'KG', '03061790', '01', 'Frutos do mar');
select pg_temp.prod('CAMARAO CONG S/CAB CRU BLOCO 36/40 (MP)', 'KG', '03061790', '01', 'Frutos do mar');
select pg_temp.prod('CARNE DO SOL (MP)', 'KG', '02102000', '01', 'Proteínas');
select pg_temp.prod('CEBOLA (MP)', 'KG', '07031011', '01', 'Horti - Frut');
select pg_temp.prod('COENTRO (MP)', 'KG', '07039090', '01', 'Horti - Frut');
select pg_temp.prod('EXTRATO DE TOMATE (MP)', 'KG', '20029000', '01', 'Atacado');
select pg_temp.prod('FARINHA DE TRIGO (MP)', 'KG', '11010010', '01', 'Atacado');
select pg_temp.prod('FEIJAO FRADINHO (MP)', 'KG', '07133590', '01', 'Atacado');
select pg_temp.prod('ALHO TRITURADO (MP)', 'G', '07123900', '01', 'Atacado');
select pg_temp.prod('LARANJA (MP)', 'KG', '08051000', '01', 'Horti - Frut');
select pg_temp.prod('OVO DE GALINHA (MP)', 'UN', '04071100', '01', 'Horti - Frut');
select pg_temp.prod('PIMENTAO (MP)', 'KG', '07096000', '01', 'Horti - Frut');
select pg_temp.prod('PIMENTA MALAGUETA (MP)', 'KG', '07096000', '01', 'Horti - Frut');
select pg_temp.prod('SALSA (MP)', 'KG', '07039090', '01', 'Horti - Frut');
select pg_temp.prod('LEITE DE COCO (MOQ) (MP)', 'ML', '20098990', '01', 'Atacado');
select pg_temp.prod('LEITE L.VIDA (MP)', 'L', '04012010', '01', 'Atacado');
select pg_temp.prod('LIMAO TAHITI (MP)', 'KG', '08055000', '01', 'Horti - Frut');
select pg_temp.prod('MARG C/SAL (MP)', 'G', '15171000', '01', 'Atacado');
select pg_temp.prod('OLEO SOJA (MP)', 'ML', '15079011', '01', 'Atacado');
select pg_temp.prod('PEIXE PESCADA AMARELA (MP)', 'KG', '03022900', '01', 'Frutos do mar');
select pg_temp.prod('PEIXE VERMELHO (MP)', 'KG', '03022900', '01', 'Frutos do mar');
select pg_temp.prod('PICLES (MP)', 'G', '20019000', '01', 'Atacado');
select pg_temp.prod('QUEIJO COALHO (MP)', 'KG', '04069020', '01', 'Atacado');
select pg_temp.prod('SIRI CATADO (MP)', 'KG', '03038990', '01', 'Frutos do mar');
select pg_temp.prod('SURURU (MP)', 'KG', '03038990', '01', 'Frutos do mar');
select pg_temp.prod('TOMATE SALADA (MP)', 'KG', '07020000', '01', 'Horti - Frut');
select pg_temp.prod('VINAGRE ALCOOL (MP)', 'ML', '22090000', '01', 'Atacado');
select pg_temp.prod('GIN NACIONAL (MP)', 'ML', '22085000', '01', 'Destilados');
select pg_temp.prod('GIN IMPORTADO (MP)', 'ML', '22085000', '01', 'Destilados');
select pg_temp.prod('PEIXE PESCADA AMARELA 600 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('FILE PESCADA 400 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('MAIONESE (MP)', 'KG', '21039019', '01', 'Atacado');
select pg_temp.prod('VODKA ABSOLUT (MP)', 'ML', '22086000', '01', 'Destilados');
select pg_temp.prod('VODKA SMIRNOFF (MP)', 'ML', '22086000', '01', 'Destilados');
select pg_temp.prod('DOCE DE AMBROSIA (MP)', 'G', '20089900', '01', 'Atacado');
select pg_temp.prod('AZEITONA PRETA (MP)', 'KG', '20057000', '01', 'Atacado');
select pg_temp.prod('CAMARAO 40/50 ALHO E OLEO 30/40  (MP)', 'KG', '03061790', '01', 'Frutos do mar');
select pg_temp.prod('FARINHA DE MANDIOCA - FINA (MP)', 'KG', '11029000', '01', 'Feira');
select pg_temp.prod('FARINHA DE MANDIOCA - GROSSA (MP)', 'KG', '11029000', '01', 'Feira');
select pg_temp.prod('OREGANO (MP)', 'KG', '12119010', '01', 'Horti - Frut');
select pg_temp.prod('CAMARAO CONG IQF CRU PPV 61/70 (MP)', 'KG', '03061790', '01', 'Frutos do mar');
select pg_temp.prod('PAO INTEGRAL (MP)', 'G', '19052090', '01', 'Atacado');
select pg_temp.prod('ABARÁ (MP)', 'POR', '21069090', '01', 'Feira');
select pg_temp.prod('COCADA BRANCA (MP)', 'KG', '08011900', '01', 'Feira');
select pg_temp.prod('CAMARAO SECO (MP)', 'KG', '03038990', '01', 'Frutos do mar');
select pg_temp.prod('COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)', 'UN', '39241000', '01', 'Embalagem/Descartáveis');
select pg_temp.prod('COMINHO MOIDO (MP)', 'KG', '21039029', '01', 'Feira');
select pg_temp.prod('CALDO DE CAMARAO (KG) (MP)', 'KG', '21041019', '01', 'Atacado');
select pg_temp.prod('LEITE DE COCO (BASE) (MP)', 'ML', '20098990', '01', 'Atacado');
select pg_temp.prod('EMBALAGEM P/MOLHO 30 ML (MP)', 'UN', '39239090', '01', 'Embalagem/Descartáveis');
select pg_temp.prod('AZEITE EXTRA VIRG COZINHA ( OLEO MISTO ) (MP)', 'ML', '21039021', '01', 'Atacado');
select pg_temp.prod('SAL FINO (MP)', 'KG', '25010020', '01', 'Atacado');
select pg_temp.prod('BOLINHO DE PEIXE (MP)', 'UN', '16042090', '01', 'Feira');
select pg_temp.prod('FILE DE PESCADA - G (MP)', 'KG', '03022900', '01', 'Frutos do mar');
select pg_temp.prod('Tonica Antarctica 350 ML', 'UN', '22021000', '00', 'GELADAS SEM ALCOOL');
select pg_temp.prod('ARROZ BCO (PI)', 'KG', '10063021', '03', 'Produto Intermediário');
select pg_temp.prod('FEIJAO FRADINHO (PI)', 'KG', '20055900', '03', 'Produto Intermediário');
select pg_temp.prod('VINAGRETE (PI)', 'KG', '20021000', '03', 'Produto Intermediário');
select pg_temp.prod('CAMARAO MOQ / ENS 200 g - (PI)', 'UN', '03061790', '03', 'Produto Intermediário');
select pg_temp.prod('CARNE DO SOL 300 G (PI)', 'UN', '02102000', '03', 'Produto Intermediário');
select pg_temp.prod('Base p/ VATAPA/CARURU', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('VATAPA (PI)', 'KG', '19012000', '03', 'Produto Intermediário');
select pg_temp.prod('FAROFA DE MANTEIGA (PI)', 'KG', '19019090', '03', 'Produto Intermediário');
select pg_temp.prod('CAMARAO MOQ / ENS 300 g - (PI)', 'UN', '03061790', '03', 'Produto Intermediário');
select pg_temp.prod('BOLINHO DE CAMARAO 8 UNID (PI)', 'UN', '16042090', '03', 'Produto Intermediário');
select pg_temp.prod('FAROFA DE DENDE (PI)', 'KG', '19019090', '03', 'Produto Intermediário');
select pg_temp.prod('Base p/ PIRAO DENDE (PI)', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('FILE PESCADA 450 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('PEIXE PESCADA AMARELA 500 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('PEIXE VERMELHO INTEIRO 1 KG (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('CALDO DE CAMARAO (250ml) (PI)', 'UN', '21041029', '03', 'Produto Intermediário');
select pg_temp.prod('CALDO DE SURURU (250 ml) (PI)', 'UN', '21041029', '03', 'Produto Intermediário');
select pg_temp.prod('CALDO MISTO (PI)', 'UN', '21041029', '03', 'Produto Intermediário');
select pg_temp.prod('MOLHO TARTARO (PI)', 'L', '21039099', '03', 'Produto Intermediário');
select pg_temp.prod('PIRAO DE DENDE (PI)', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('CASQUINHA DE SIRI (PI)', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('CAMARAO MOQ / ENSO (PI)', 'KG', '03061790', '03', 'Produto Intermediário');
select pg_temp.prod('PIRAO ENSOPADO (PI)', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('TEMPERO LIQUIDO (PI)', 'L', '20021000', '03', 'Produto Intermediário');
select pg_temp.prod('Base p/ PIRAO ENSOPADO (PI)', 'KG', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('CARNE DO SOL LIMPA (PI)', 'KG', '02102000', '03', 'Produto Intermediário');
select pg_temp.prod('PEIXE PESCADA AMARELA 200 g (PI)', 'UN', '03022900', '03', 'Produto Intermediário');
select pg_temp.prod('ACARAJE (MP)', 'UN', '21069090', '01', 'Feira');
select pg_temp.prod('BOLINHO DE QUEIJO (MP)', 'UN', '19059090', '01', 'Feira');
select pg_temp.prod('APEROL (MP)', 'ML', '22089000', '01', 'Destilados');
select pg_temp.prod('ESPUMANTE (MP)', 'ML', '22041010', '01', 'Destilados');
select pg_temp.prod('Porção de Batata Frita (acompanhamento da Carne do Sol) (PI)', 'UN', '20041000', '03', 'Produto Intermediário');
select pg_temp.prod('Porção de Farofa (acompanhamento da Carne do Sol) (PI)', 'UN', '19019090', '03', 'Produto Intermediário');
select pg_temp.prod('Acarajé - 8 bolinhos (PI)', 'UN', '21069090', '03', 'Produto Intermediário');
select pg_temp.prod('Mini Abará - 6 unidades (PI)', 'UN', '21069090', '03', 'Produto Intermediário');
-- 3) Família de todos os vendáveis (nomes da Donana)
update produtos set codigo_familia = pg_temp.fam('GELADAS COM ALCOOL'), descricao_familia = 'GELADAS COM ALCOOL' where loja_id = 15 and codigo in ('90057','90058','90059','90060','90061');
update produtos set codigo_familia = pg_temp.fam('GELADAS SEM ALCOOL'), descricao_familia = 'GELADAS SEM ALCOOL' where loja_id = 15 and codigo in ('90018','90019','90021','90022','90023','90024','90025','90026');
update produtos set codigo_familia = pg_temp.fam('DRINKS'), descricao_familia = 'DRINKS' where loja_id = 15 and codigo in ('90062','90063','90064','90065','90017');
update produtos set codigo_familia = pg_temp.fam('ENTRADA / PETISCOS'), descricao_familia = 'ENTRADA / PETISCOS' where loja_id = 15 and codigo in ('90027','90028','90029','90030','90031','90032','90055','90056','90020','90054','90033','90034','90035','90039');
update produtos set codigo_familia = pg_temp.fam('DO MAR'), descricao_familia = 'DO MAR' where loja_id = 15 and codigo in ('90047','90036');
update produtos set codigo_familia = pg_temp.fam('GUARNIÇÕES'), descricao_familia = 'GUARNIÇÕES' where loja_id = 15 and codigo in ('90038','90042','90048','90049','90050');
update produtos set codigo_familia = pg_temp.fam('SOBREMESA'), descricao_familia = 'SOBREMESA' where loja_id = 15 and codigo in ('90051','90052','90053');
-- 4) Sub-receitas dos PI (saem do estoque do PI; a OP de preparo consome a MP), componentes de escolha (abrem na venda) e pratos
select pg_temp.ficha('ARROZ BCO (PI)', false, '[["ARROZ BCO (MP)", 0.33]]'::jsonb);
select pg_temp.ficha('FAROFA DE DENDE (PI)', false, '[["AZEITE DE DENDE 2000 (MP)", 0.16], ["FARINHA DE MANDIOCA - FINA (MP)", 0.84], ["SAL FINO (MP)", 0.008]]'::jsonb);
select pg_temp.ficha('FAROFA DE MANTEIGA (PI)', false, '[["OLEO SOJA (MP)", 76.14], ["MARG C/SAL (MP)", 84.6], ["FARINHA DE MANDIOCA - FINA (MP)", 0.84], ["SAL FINO (MP)", 0.008]]'::jsonb);
select pg_temp.ficha('CAMARAO MOQ / ENSO (PI)', false, '[["CAMARAO CONG S/CAB CRU BLOCO 36/40 (MP)", 0.666667], ["CAMARAO CONG 41/50 (MP)", 0.666667]]'::jsonb);
select pg_temp.ficha('VINAGRETE (PI)', false, '[["TOMATE SALADA (MP)", 0.48], ["CEBOLA (MP)", 0.145278], ["PIMENTAO (MP)", 0.072639], ["COENTRO (MP)", 0.072639]]'::jsonb);
select pg_temp.ficha('TEMPERO LIQUIDO (PI)', false, '[["SAL FINO (MP)", 0.3333], ["LIMAO TAHITI (MP)", 0.6], ["VINAGRE ALCOOL (MP)", 800], ["COMINHO MOIDO (MP)", 0.005], ["ALHO (MP)", 0.1]]'::jsonb);
select pg_temp.ficha('PIRAO DE DENDE (PI)', false, '[["LEITE DE COCO (MOQ) (MP)", 200], ["FARINHA DE MANDIOCA - GROSSA (MP)", 0.2], ["Base p/ PIRAO DENDE (PI)", 0.5], ["AZEITE DE DENDE 2000 (MP)", 0.02], ["TEMPERO LIQUIDO (PI)", 0.012]]'::jsonb);
select pg_temp.ficha('CAMARAO MOQ / ENS 200 g - (PI)', false, '[["CAMARAO MOQ / ENSO (PI)", 0.2]]'::jsonb);
select pg_temp.ficha('PIRAO ENSOPADO (PI)', false, '[["LEITE DE COCO (MOQ) (MP)", 200], ["FARINHA DE MANDIOCA - GROSSA (MP)", 0.2], ["Base p/ PIRAO ENSOPADO (PI)", 0.5], ["EXTRATO DE TOMATE (MP)", 0.02], ["TEMPERO LIQUIDO (PI)", 0.012]]'::jsonb);
select pg_temp.ficha('PEIXE PESCADA AMARELA 500 g (PI)', false, '[["PEIXE PESCADA AMARELA (MP)", 1.038251]]'::jsonb);
select pg_temp.ficha('FILE PESCADA 450 g (PI)', false, '[["FILE DE PESCADA - G (MP)", 0.63]]'::jsonb);
select pg_temp.ficha('CAMARAO MOQ / ENS 300 g - (PI)', false, '[["CAMARAO MOQ / ENSO (PI)", 0.3]]'::jsonb);
select pg_temp.ficha('PEIXE PESCADA AMARELA 200 g (PI)', false, '[["PEIXE PESCADA AMARELA (MP)", 0.415301]]'::jsonb);
select pg_temp.ficha('PEIXE VERMELHO INTEIRO 1 KG (PI)', false, '[["PEIXE VERMELHO (MP)", 1.1]]'::jsonb);
select pg_temp.ficha('PEIXE PESCADA AMARELA 600 g (PI)', false, '[["PEIXE PESCADA AMARELA (MP)", 1.245902]]'::jsonb);
select pg_temp.ficha('FILE PESCADA 400 g (PI)', false, '[["FILE DE PESCADA - G (MP)", 0.56]]'::jsonb);
select pg_temp.ficha('CALDO MISTO (PI)', false, '[["CAMARAO CONG IQF CRU PPV 61/70 (MP)", 0.035], ["SURURU (MP)", 0.035], ["ALHO TRITURADO (MP)", 0.007], ["LEITE DE COCO (MOQ) (MP)", 35], ["AZEITE DE DENDE 2000 (MP)", 0.013], ["AMENDOIM TORRADO (MP)", 0.009], ["TOMATE SALADA (MP)", 0.03], ["CEBOLA (MP)", 0.025], ["PIMENTAO (MP)", 0.005], ["COENTRO (MP)", 0.005], ["BATATA INGLESA (MP)", 0.025], ["CAMARAO SECO (MP)", 0.004]]'::jsonb);
select pg_temp.ficha('CALDO DE CAMARAO (250ml) (PI)', false, '[["CAMARAO CONG IQF CRU PPV 61/70 (MP)", 0.07], ["AMENDOIM TORRADO (MP)", 0.009], ["ALHO TRITURADO (MP)", 0.007], ["LEITE DE COCO (MOQ) (MP)", 35], ["AZEITE DE DENDE 2000 (MP)", 0.013], ["COENTRO (MP)", 0.006749], ["BATATA INGLESA (MP)", 0.025], ["SAL FINO (MP)", 0.001852], ["TEMPERO LIQUIDO (PI)", 0.002778], ["VINAGRETE (PI)", 0.024074], ["EXTRATO DE TOMATE (MP)", 0.002963], ["LIMAO TAHITI (MP)", 8e-05], ["CEBOLA (MP)", 0.003497], ["PIMENTAO (MP)", 0.001749], ["TOMATE SALADA (MP)", 0.011556], ["CAMARAO SECO (MP)", 0.007]]'::jsonb);
select pg_temp.ficha('CALDO DE SURURU (250 ml) (PI)', false, '[["SURURU (MP)", 0.031], ["EXTRATO DE TOMATE (MP)", 0.01], ["ALHO TRITURADO (MP)", 0.007], ["TOMATE SALADA (MP)", 0.03], ["CEBOLA (MP)", 0.025], ["PIMENTAO (MP)", 0.005], ["COENTRO (MP)", 0.005], ["BATATA INGLESA (MP)", 0.025], ["LEITE DE COCO (BASE) (MP)", 35]]'::jsonb);
select pg_temp.ficha('MOLHO TARTARO (PI)', false, '[["OVO DE GALINHA (MP)", 1], ["AZEITONA PRETA (MP)", 0.1185], ["ALHO TRITURADO (MP)", 20], ["OREGANO (MP)", 0.04], ["PICLES (MP)", 593], ["SALSA (MP)", 0.06], ["MAIONESE (MP)", 0.89]]'::jsonb);
select pg_temp.ficha('BOLINHO DE CAMARAO 8 UNID (PI)', false, '[["CAMARAO CONG IQF CRU PPV 61/70 (MP)", 0.2343], ["CEBOLA (MP)", 0.0109], ["COENTRO (MP)", 0.0031], ["EXTRATO DE TOMATE (MP)", 0.0062], ["CALDO DE CAMARAO (KG) (MP)", 0.004], ["AZEITE EXTRA VIRG COZINHA ( OLEO MISTO ) (MP)", 6], ["MARG C/SAL (MP)", 3.5], ["FARINHA DE TRIGO (MP)", 0.0625], ["LEITE L.VIDA (MP)", 0.031], ["TEMPERO LIQUIDO (PI)", 0.02]]'::jsonb);
select pg_temp.ficha('CARNE DO SOL 300 G (PI)', false, '[["CARNE DO SOL LIMPA (PI)", 0.3]]'::jsonb);
select pg_temp.ficha('CASQUINHA DE SIRI (PI)', false, '[["SIRI CATADO (MP)", 0.64], ["LEITE DE COCO (MOQ) (MP)", 148], ["AZEITE DE DENDE 2000 (MP)", 0.11], ["EXTRATO DE TOMATE (MP)", 0.05], ["LIMAO TAHITI (MP)", 0.09], ["TEMPERO LIQUIDO (PI)", 0.067], ["VINAGRETE (PI)", 0.303226]]'::jsonb);
select pg_temp.ficha('VATAPA (PI)', false, '[["Base p/ VATAPA/CARURU", 0.13], ["FARINHA DE TRIGO (MP)", 0.13], ["CALDO DE CAMARAO (KG) (MP)", 0.003], ["AZEITE DE DENDE 2000 (MP)", 0.054], ["SAL FINO (MP)", 0.007463], ["LEITE DE COCO (MOQ) (MP)", 47.410009]]'::jsonb);
select pg_temp.ficha('FEIJAO FRADINHO (PI)', false, '[["FEIJAO FRADINHO (MP)", 0.519], ["SAL FINO (MP)", 0.013]]'::jsonb);
select pg_temp.ficha('Base p/ PIRAO DENDE (PI)', false, '[["CAMARAO CONG IQF CRU PPV 61/70 (MP)", 0.33], ["LEITE DE COCO (MOQ) (MP)", 133], ["LEITE DE COCO (BASE) (MP)", 267], ["VINAGRETE (PI)", 0.05], ["ALHO TRITURADO (MP)", 13.17], ["TEMPERO LIQUIDO (PI)", 0.03], ["SAL FINO (MP)", 0.001], ["AZEITE DE DENDE 2000 (MP)", 0.05]]'::jsonb);
select pg_temp.ficha('Base p/ PIRAO ENSOPADO (PI)', false, '[["CAMARAO CONG IQF CRU PPV 61/70 (MP)", 0.33], ["LEITE DE COCO (MOQ) (MP)", 133], ["LEITE DE COCO (BASE) (MP)", 267], ["VINAGRETE (PI)", 0.05], ["ALHO TRITURADO (MP)", 13.17], ["TEMPERO LIQUIDO (PI)", 0.03], ["SAL FINO (MP)", 0.001], ["EXTRATO DE TOMATE (MP)", 0.033]]'::jsonb);
select pg_temp.ficha('CARNE DO SOL LIMPA (PI)', false, '[["CARNE DO SOL (MP)", 1.3897]]'::jsonb);
select pg_temp.ficha('Base p/ VATAPA/CARURU', false, '[["ALHO TRITURADO (MP)", 30], ["AMENDOIM TORRADO (MP)", 0.016], ["CEBOLA (MP)", 0.036], ["COENTRO (MP)", 0.01], ["LEITE DE COCO (BASE) (MP)", 113], ["CAMARAO SECO (MP)", 0.168]]'::jsonb);
select pg_temp.ficha('Porção de Batata Frita (acompanhamento da Carne do Sol) (PI)', true, '[["BATATA PRE-FRITA (MP)", 0.2]]'::jsonb);
select pg_temp.ficha('Porção de Farofa (acompanhamento da Carne do Sol) (PI)', true, '[["FAROFA DE MANTEIGA (PI)", 0.15]]'::jsonb);
select pg_temp.ficha('Acarajé - 8 bolinhos (PI)', true, '[["ACARAJE (MP)", 8]]'::jsonb);
select pg_temp.ficha('Mini Abará - 6 unidades (PI)', true, '[["ABARÁ (MP)", 1]]'::jsonb);
select pg_temp.ficha('90027', false, '[["CALDO DE SURURU (250 ml) (PI)", 1]]'::jsonb);
select pg_temp.ficha('90028', false, '[["CALDO DE CAMARAO (250ml) (PI)", 1], ["LIMAO TAHITI (MP)", 0.01], ["PAO INTEGRAL (MP)", 50]]'::jsonb);
select pg_temp.ficha('90029', false, '[["CALDO MISTO (PI)", 1], ["LARANJA (MP)", 0.045], ["PAO INTEGRAL (MP)", 10]]'::jsonb);
select pg_temp.ficha('90030', false, '[["BOLINHO DE PEIXE (MP)", 4], ["MOLHO TARTARO (PI)", 0.01], ["EMBALAGEM P/MOLHO 30 ML (MP)", 1], ["LIMAO TAHITI (MP)", 0.005], ["ALFACE CRESPA (MP)", 0.001]]'::jsonb);
select pg_temp.ficha('90031', false, '[["BOLINHO DE CAMARAO 8 UNID (PI)", 0.5], ["MOLHO TARTARO (PI)", 0.01], ["EMBALAGEM P/MOLHO 30 ML (MP)", 1], ["LIMAO TAHITI (MP)", 0.005], ["ALFACE CRESPA (MP)", 0.001]]'::jsonb);
select pg_temp.ficha('90032', false, '[["BOLINHO DE QUEIJO (MP)", 4], ["MOLHO TARTARO (PI)", 0.01], ["EMBALAGEM P/MOLHO 30 ML (MP)", 1], ["LIMAO TAHITI (MP)", 0.005], ["ALFACE CRESPA (MP)", 0.001]]'::jsonb);
select pg_temp.ficha('90055', false, '[["QUEIJO COALHO (MP)", 0.2]]'::jsonb);
select pg_temp.ficha('90056', false, '[["CASQUINHA DE SIRI (PI)", 0.14], ["FAROFA DE MANTEIGA (PI)", 0.04], ["LIMAO TAHITI (MP)", 0.005]]'::jsonb);
select pg_temp.ficha('90020', false, '[["BATATA PRE-FRITA (MP)", 0.35]]'::jsonb);
select pg_temp.ficha('90054', false, '[["TOMATE SALADA (MP)", 0.1725], ["ALFACE CRESPA (MP)", 0.015], ["ALHO TRITURADO (MP)", 15], ["FAROFA DE MANTEIGA (PI)", 0.12375], ["CAMARAO 40/50 ALHO E OLEO 30/40  (MP)", 0.3]]'::jsonb);
select pg_temp.ficha('90033', false, '[["FILE DE PESCADA - G (MP)", 0.44], ["FARINHA DE TRIGO (MP)", 0.05], ["OLEO SOJA (MP)", 300], ["LIMAO TAHITI (MP)", 0.05], ["SAL FINO (MP)", 0.01], ["TEMPERO LIQUIDO (PI)", 0.03], ["MOLHO TARTARO (PI)", 0.02]]'::jsonb);
select pg_temp.ficha('90034', false, '[["CARNE DO SOL 300 G (PI)", 1], ["FAROFA DE MANTEIGA (PI)", 0.15], ["TOMATE SALADA (MP)", 0.03], ["CEBOLA (MP)", 0.045], ["PIMENTAO (MP)", 0.0225], ["COENTRO (MP)", 0.007], ["FEIJAO FRADINHO (MP)", 0.125]]'::jsonb);
select pg_temp.ficha('90035', false, '[["CARNE DO SOL 300 G (PI)", 1], ["CEBOLA (MP)", 0.05], ["VINAGRETE (PI)", 0.04]]'::jsonb);
select pg_temp.ficha('90039', false, '[["VATAPA (PI)", 0.075], ["VINAGRETE (PI)", 0.04], ["CAMARAO SECO (MP)", 0.03], ["PIMENTA MALAGUETA (MP)", 0.005]]'::jsonb);
select pg_temp.ficha('90047', false, '[["FAROFA DE MANTEIGA (PI)", 0.165], ["VINAGRETE (PI)", 0.15], ["ALFACE CRESPA (MP)", 0.02], ["ARROZ BCO (PI)", 0.28], ["PEIXE PESCADA AMARELA 600 g (PI)", 1], ["FEIJAO FRADINHO (PI)", 0.44]]'::jsonb);
select pg_temp.ficha('90036', false, '[["VINAGRETE (PI)", 0.15], ["FAROFA DE MANTEIGA (PI)", 0.165], ["PEIXE VERMELHO INTEIRO 1 KG (PI)", 1], ["LIMAO TAHITI (MP)", 0.05], ["SAL FINO (MP)", 0.03], ["TEMPERO LIQUIDO (PI)", 0.06], ["FARINHA DE TRIGO (MP)", 0.05], ["OLEO SOJA (MP)", 500], ["ALFACE CRESPA (MP)", 0.01], ["ARROZ BCO (PI)", 0.4], ["FEIJAO FRADINHO (PI)", 0.315]]'::jsonb);
select pg_temp.ficha('90038', false, '[["FAROFA DE MANTEIGA (PI)", 0.2]]'::jsonb);
select pg_temp.ficha('90042', false, '[["ARROZ BCO (PI)", 0.26]]'::jsonb);
select pg_temp.ficha('90048', false, '[["FEIJAO FRADINHO (PI)", 0.44], ["VINAGRETE (PI)", 0.025]]'::jsonb);
select pg_temp.ficha('90049', false, '[["PIRAO DE DENDE (PI)", 0.375]]'::jsonb);
select pg_temp.ficha('90050', false, '[["VINAGRETE (PI)", 0.12]]'::jsonb);
select pg_temp.ficha('90062', false, '[["ACUCAR CRISTAL (MP)", 0.04], ["CACHAÇA 51 (MP)", 70], ["LIMAO TAHITI (MP)", 0.2]]'::jsonb);
select pg_temp.ficha('90063', false, '[["VODKA SMIRNOFF (MP)", 70], ["ACUCAR CRISTAL (MP)", 0.04], ["LIMAO TAHITI (MP)", 0.2]]'::jsonb);
select pg_temp.ficha('90064', false, '[["VODKA ABSOLUT (MP)", 70], ["ACUCAR CRISTAL (MP)", 0.04], ["LIMAO TAHITI (MP)", 0.2]]'::jsonb);
select pg_temp.ficha('90065', false, '[["GIN IMPORTADO (MP)", 60], ["Tonica Antarctica 350 ML", 1]]'::jsonb);
select pg_temp.ficha('90017', false, '[["APEROL (MP)", 60], ["ESPUMANTE (MP)", 90], ["LARANJA (MP)", 0.03]]'::jsonb);
select pg_temp.ficha('90051', false, '[["DOCE DE AMBROSIA (MP)", 170], ["COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)", 1]]'::jsonb);
select pg_temp.ficha('90052', false, '[["COCADA BRANCA (MP)", 0.15], ["COPO DESC 100ML C / TAMPA - (SOBREMESA) (MP)", 1]]'::jsonb);
select 'sem família' as k, count(*) from produtos where loja_id = 15 and not inativo and codigo_familia is null
union all select 'ativos', count(*) from produtos where loja_id = 15 and not inativo
union all select 'fichas ativas', count(*) from fichas_tecnicas where loja_id = 15 and ativa
union all select 'saldo de teste', count(*) from estoque_saldos s join produtos p on p.loja_id = 15 and p.codigo_produto = s.codigo_produto where s.loja_id = 15 and s.saldo <> 0 and p.inativo;
