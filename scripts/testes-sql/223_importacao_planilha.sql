-- Teste da migration 223 (importação por planilha). Banco LOCAL g1 com fase_g_setup.sql + 220 + 223. Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d g1 < scripts/testes-sql/223_importacao_planilha.sql
begin;
do $$ declare v_id bigint; v_id2 bigint; v_omie bigint; r jsonb; n int; begin
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, valor_unitario, full_object)
    values (9001, 22301, 'P22301', 'TOMATE', 'KG', 3, '{"extras":{"marca":"X"}}');
  insert into importacoes_planilha (loja_id, tipo, hash, linhas) values (9001, 'produtos', 'h1', jsonb_build_array(
    jsonb_build_object('n', 2, 'acao', 'novo', 'alvo', null, 'dados', jsonb_build_object('descricao', 'Cebola', 'unidade', 'KG', 'tipo_item', '01', 'valor_unitario', 2.1)),
    jsonb_build_object('n', 3, 'acao', 'atualizar', 'alvo', 22301, 'dados', jsonb_build_object('valor_unitario', 3.4, 'cest', '0100100')),
    jsonb_build_object('n', 4, 'acao', 'erro', 'alvo', null, 'dados', '{}'::jsonb),
    jsonb_build_object('n', 5, 'acao', 'novo', 'alvo', null, 'dados', jsonb_build_object('codigo', 'P22301', 'descricao', 'Tomate 2', 'unidade', 'KG'))
  )) returning id into v_id;

  -- 1. aplica: 1 criado, 2 atualizados (a linha 5 achou o código existente na hora de aplicar); erro fica de fora
  r := importacao_aplicar(v_id, 9001);
  if (r->>'criados')::int <> 1 or (r->>'atualizados')::int <> 2 then raise exception '1: %', r; end if;
  if (select valor_unitario from produtos where loja_id = 9001 and codigo_produto = 22301) <> 3.4 then raise exception '1: preço'; end if;
  if (select full_object->'extras' from produtos where loja_id = 9001 and codigo_produto = 22301) <> '{"marca":"X","cest":"0100100"}'::jsonb then raise exception '1: extras %', (select full_object from produtos where codigo_produto = 22301); end if;
  if (select descricao from produtos where loja_id = 9001 and codigo_produto = 22301) <> 'Tomate 2' then raise exception '1: descrição'; end if;
  select count(*) into n from produtos where loja_id = 9001 and descricao = 'Cebola' and codigo is not null and tipo_item = '01';
  if n <> 1 then raise exception '1: cebola %', n; end if;

  -- 2. confirmar de novo: mesmo resultado, nada duplica
  r := importacao_aplicar(v_id, 9001);
  if (r->>'duplicado')::boolean is not true then raise exception '2: %', r; end if;
  select count(*) into n from produtos where loja_id = 9001 and descricao = 'Cebola';
  if n <> 1 then raise exception '2: duplicou (%)', n; end if;

  -- 3. outra loja não aplica a prévia desta
  begin perform importacao_aplicar(v_id, 9002); raise exception '3: outra loja aplicou'; exception when sqlstate '22023' then null; end;

  -- 4. loja Omie recusada
  insert into importacoes_planilha (loja_id, tipo, hash, linhas) values (9002, 'produtos', 'h2', '[]') returning id into v_omie;
  begin perform importacao_aplicar(v_omie, 9002); raise exception '4: loja omie importou'; exception when sqlstate '22023' then null; end;

  -- 5. fornecedores: novo com CNPJ, depois o mesmo CNPJ (com máscara) vira atualização; prévia vencida recusada
  insert into importacoes_planilha (loja_id, tipo, hash, linhas) values (9001, 'fornecedores', 'h3', jsonb_build_array(
    jsonb_build_object('n', 2, 'acao', 'novo', 'alvo', null, 'dados', jsonb_build_object('razao_social', 'Horti Ltda', 'cnpj_cpf', '11222333000181', 'uf', 'BA'))
  )) returning id into v_id2;
  r := importacao_aplicar(v_id2, 9001);
  insert into importacoes_planilha (loja_id, tipo, hash, linhas) values (9001, 'fornecedores', 'h4', jsonb_build_array(
    jsonb_build_object('n', 2, 'acao', 'novo', 'alvo', null, 'dados', jsonb_build_object('razao_social', 'Horti', 'cnpj_cpf', '11.222.333/0001-81', 'email', 'a@b.com'))
  )) returning id into v_id2;
  r := importacao_aplicar(v_id2, 9001);
  if (r->>'atualizados')::int <> 1 then raise exception '5: %', r; end if;
  if (select count(*) from fornecedores where loja_id = 9001 and cnpj_cpf = '11222333000181') <> 1 then raise exception '5: duplicou fornecedor'; end if;
  if (select origem from fornecedores where loja_id = 9001 and cnpj_cpf = '11222333000181') <> 'planilha' then raise exception '5: origem'; end if;
  insert into importacoes_planilha (loja_id, tipo, hash, linhas, created_at) values (9001, 'fornecedores', 'h5', '[]', now() - interval '2 days') returning id into v_id2;
  begin perform importacao_aplicar(v_id2, 9001); raise exception '5: aplicou prévia vencida'; exception when sqlstate '22023' then null; end;

  -- 6. linha que quebra (produto novo sem unidade) desfaz tudo e diz a linha
  insert into importacoes_planilha (loja_id, tipo, hash, linhas) values (9001, 'produtos', 'h6', jsonb_build_array(
    jsonb_build_object('n', 2, 'acao', 'novo', 'dados', jsonb_build_object('descricao', 'Alho', 'unidade', 'KG')),
    jsonb_build_object('n', 9, 'acao', 'novo', 'dados', jsonb_build_object('descricao', 'Sem unidade'))
  )) returning id into v_id2;
  begin perform importacao_aplicar(v_id2, 9001); raise exception '6: aplicou';
  exception when sqlstate '22023' then
    if sqlerrm not like 'Linha 9%' then raise exception '6: mensagem %', sqlerrm; end if;
  end;
  if exists (select 1 from produtos where loja_id = 9001 and descricao = 'Alho') then raise exception '6: não desfez'; end if;
end $$;

-- 7. RLS e permissão de execução
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000009002"}', true);
set local role authenticated;
do $$ begin
  if exists (select 1 from importacoes_planilha where loja_id = 9001) then raise exception '7: viu importação de outra loja'; end if;
  begin perform importacao_aplicar(1, 9002); raise exception '7: authenticated chamou'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'OK 223' as resultado;
rollback;
