-- Teste da migration 143 (roda dentro de BEGIN ... ROLLBACK).
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99050, '00000000099050', 'TESTE 143', true, 'proprio');
insert into grupos_produto (id, loja_id, pai_id, nome, vendas_ref) overriding system value values
  (990501, 99050, null, 'Bebidas', '11111111-1111-1111-1111-111111111111'),
  (990502, 99050, 990501, 'Cervejas', '22222222-2222-2222-2222-222222222222'),
  (990503, 99050, 990502, 'Long Neck', null);
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, grupo_id, vendas_ref, pdv, updated_at) values
  (99050, 8000000990501, '90001', 'Heineken', 'UN', '00', 990503, '33333333-3333-3333-3333-333333333333', true, now() - interval '1 day');
do $$
declare r jsonb; n int; g bigint;
begin
  r := aplicar_catalogo_vendas(99050, jsonb_build_object(
    'grupos', jsonb_build_array(
      jsonb_build_object('vendas_ref','11111111-1111-1111-1111-111111111111','nome','Bebidas','updated_at', now()),
      jsonb_build_object('vendas_ref','22222222-2222-2222-2222-222222222222','nome','Cervejas','pai_vendas_ref','11111111-1111-1111-1111-111111111111','updated_at', now()),
      jsonb_build_object('vendas_ref','44444444-4444-4444-4444-444444444444','nome','Bebidas','pai_vendas_ref','11111111-1111-1111-1111-111111111111','updated_at', now())),
    'produtos', jsonb_build_array(
      jsonb_build_object('vendas_ref','33333333-3333-3333-3333-333333333333','codigo','90001','nome','Heineken','preco',10,'grupo_vendas_ref','22222222-2222-2222-2222-222222222222','updated_at', now()),
      jsonb_build_object('vendas_ref','55555555-5555-5555-5555-555555555555','nome','Acai','preco',15,'grupo_vendas_ref','44444444-4444-4444-4444-444444444444','updated_at', now()))));
  select count(*) into n from grupos_produto where loja_id = 99050 and lower(nome) = 'bebidas';
  assert n = 1, 'criou subgrupo Bebidas duplicado: ' || n;
  select grupo_id into g from produtos where loja_id = 99050 and codigo = '90001';
  assert g = 990503, 'achatou o subgrupo: ' || g;
  select grupo_id into g from produtos where loja_id = 99050 and descricao = 'Acai';
  assert g = 990501, 'produto da categoria padrão não caiu no grupo: ' || coalesce(g::text, 'null');
  raise notice 'CATALOGO 143 OK';
end $$;
