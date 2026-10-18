-- Teste da migration 182: o fornecedor da nota da SEFAZ/XML vira cadastro (estoque próprio). Cópia local com o esquema
-- público de produção + 180/181/182. Nunca em produção.
do $$
declare v_loja bigint; r1 jsonb; r2 jsonb; r3 jsonb; f1 bigint; f2 bigint; n int; v_ant bigint;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 182', '00000000000000', 'proprio') returning id into v_loja;
  r1 := gravar_nota_sefaz(v_loja, '{"chave":"29261012345678000190550010000000011000000011","fornecedor_cnpj":"12.345.678/0001-90","fornecedor_nome":"FORNECEDOR XPTO LTDA","numero":"1"}', '[]');
  r2 := gravar_nota_sefaz(v_loja, '{"chave":"29261012345678000190550010000000021000000022","fornecedor_cnpj":"12345678000190","fornecedor_nome":"FORNECEDOR XPTO LTDA","numero":"2"}', '[]');
  select n_id_fornecedor into f1 from notas_fiscais where id = (r1->>'nota_id')::bigint;
  select n_id_fornecedor into f2 from notas_fiscais where id = (r2->>'nota_id')::bigint;
  if f1 is null or f1 <> f2 or f1 < 8000000000001 then raise exception 'mesmo CNPJ: % × %', f1, f2; end if;
  select count(*) into n from fornecedores where loja_id = v_loja;
  if n <> 1 then raise exception 'fornecedores: % (esperado 1)', n; end if;

  -- fornecedor já cadastrado (sem codigo_omie) é reaproveitado
  insert into fornecedores (loja_id, razao_social, cnpj_cpf) values (v_loja, 'OUTRO FORNECEDOR', '98.765.432/0001-10') returning id into v_ant;
  r3 := gravar_nota_sefaz(v_loja, '{"chave":"29261098765432000110550010000000031000000033","fornecedor_cnpj":"98765432000110","fornecedor_nome":"OUTRO FORNECEDOR","numero":"3"}', '[]');
  select count(*) into n from fornecedores where loja_id = v_loja;
  if n <> 2 then raise exception 'reaproveitar: % fornecedores (esperado 2)', n; end if;
  if (select codigo_omie from fornecedores where id = v_ant) is null then raise exception 'cadastrado não recebeu código'; end if;

  -- sem CNPJ → null
  r3 := gravar_nota_sefaz(v_loja, '{"chave":"29261000000000000000550010000000041000000044","fornecedor_nome":"SEM CNPJ","numero":"4"}', '[]');
  if (select n_id_fornecedor from notas_fiscais where id = (r3->>'nota_id')::bigint) is not null then raise exception 'sem CNPJ ganhou fornecedor'; end if;

  select count(*) into n from compras_ranking_fornecedores(v_loja) where codigo_omie = f1;
  if n <> 1 then raise exception 'ranking: % linhas para o CNPJ', n; end if;
  raise notice 'fornecedor da nota sefaz (182) OK';
end $$;
