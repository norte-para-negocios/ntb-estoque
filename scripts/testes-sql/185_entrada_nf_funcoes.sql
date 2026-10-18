-- Teste da migration 185 (entrada da nota por item: custo N3, local, quantidade recebida, CFOP, movimenta; projeção no
-- formato do Omie; memória; conferência; manifestação negativa). Cópia local com o esquema público de produção + Fase A
-- (175–183) + 184 + 185. Nunca em produção. Valores reais: NF 131055 (CRBS), NF 4010 (peixe, entrega parcial), NF 7433.

-- Nota SEFAZ + compra (registrar_compra_sefaz) a partir de uma lista de itens; devolve o id da compra.
create or replace function pg_temp.compra_sefaz(p_loja bigint, p_chave text, p_itens jsonb, p_local bigint) returns bigint language plpgsql as $$
declare g jsonb; r jsonb; v_nitens jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('seq', (x->>'linha')::int, 'c_prod', x->>'c_prod', 'descricao', x->>'descricao',
           'qtde', (x->>'quantidade')::numeric, 'unidade', 'CX', 'preco_unit', (x->>'valor_unitario')::numeric, 'desconto', 0, 'frete', 0,
           'total', (x->>'valor_total')::numeric, 'full_object', jsonb_build_object('itensCabec', jsonb_build_object('nSequencia', (x->>'linha')::int), 'sefaz', '{"icms":0}'::jsonb))), '[]')
    into v_nitens from jsonb_array_elements(p_itens) x;
  g := gravar_nota_sefaz(p_loja, jsonb_build_object('chave', p_chave, 'numero', right(p_chave, 9), 'serie', '1', 'modelo', '55', 'emissao', '2026-10-19',
         'valor', 100, 'fornecedor_nome', 'CRBS S/A', 'fornecedor_cnpj', '99111222000149', 'ambiente', '1',
         'full_object', '{"infoCadastro":{"cRecebido":"N"},"sefaz":{"alertas":[]}}'::jsonb), v_nitens);
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', p_loja, 'chave_acesso', p_chave, 'nota_fiscal_id', g->>'nota_id', 'numero', right(p_chave, 9),
         'fornecedor_cnpj', '99111222000149', 'fornecedor_nome', 'CRBS S/A', 'valor_frete', 0, 'valor_desconto', 0, 'itens', p_itens), p_local);
  return (r->>'compra_id')::bigint;
end $$;

do $$
declare
  v_loja bigint; BAR bigint := 2746972551; COZ bigint := 2746972605; VELHO bigint := 2746972999;
  ch_a text := '29260999111222000149550220001310551123456781'; ch_f text := '29260999111222000149550220001310561123456782';
  ch_g text := '29260999111222000149550220001310571123456783'; ch_h text := '29260999111222000149550220001310581123456784';
  v_c bigint; r jsonb; v numeric; s text; n int; it compras_proprio_itens%rowtype; fo jsonb; tipos text[];
  nflags jsonb := '{"cICMSCusto":"N","cICMSSTCusto":"N","cIPICusto":"N","cPISCusto":"N","cCOFINSCusto":"N","cOutrosDespCusto":"N","nAliqCredPISCusto":0,"nAliqCredCOFINSCusto":0}';
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 185', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR'), (v_loja, COZ, '02 - COZINHA');
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, deleted_at) values (v_loja, VELHO, '03 - DEPOSITO VELHO', now());
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values
    (v_loja, 1001, 'AGUA', 'AGUA MINERAL 500ML', 'UN'), (v_loja, 1002, 'CORONA', 'CORONA LONG NECK', 'UN'),
    (v_loja, 1003, 'TONICA', 'TONICA DIET', 'UN'), (v_loja, 1004, 'PEIXE', 'PEIXE', 'KG'), (v_loja, 1005, 'LIMAO', 'LIMAO', 'CX'),
    (v_loja, 1006, 'CERVEJA', 'CERVEJA FARDO', 'FD');

  -- A — NF 131055 por item (marcações, quantidade recebida, local por item, CFOP de entrada)
  v_c := pg_temp.compra_sefaz(v_loja, ch_a, jsonb_build_array(
    jsonb_build_object('linha', 1, 'c_prod', '0023552', 'descricao', 'AGUA', 'quantidade', 10, 'valor_unitario', 16.299516, 'valor_total', 163, 'desconto', 0,
      'fator', 12, 'codigo_produto', 1001, 'valor_total_item', 176.41, 'outras_valor', 13.41, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra',
      'cfop_entrada', '1403', 'origem_cfop', 'produto', 'quantidade_recebida', 120, 'unidade_estoque', 'UN', 'fiscal', '{"cst":"60","origem":"0"}'::jsonb),
    jsonb_build_object('linha', 2, 'c_prod', '0018836', 'descricao', 'CORONA', 'quantidade', 4, 'valor_unitario', 158.149101, 'valor_total', 632.60, 'desconto', 0,
      'fator', 24, 'codigo_produto', 1002, 'valor_total_item', 706.35, 'ipi_valor', 20.04, 'outras_valor', 53.71, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra',
      'cfop_entrada', '1403', 'quantidade_recebida', 96, 'fiscal', '{"cst":"60","cstIpi":"50","pis":10.67,"cofins":48.98}'::jsonb),
    jsonb_build_object('linha', 3, 'c_prod', '0009092', 'descricao', 'TONICA', 'quantidade', 1, 'valor_unitario', 36.07555, 'valor_total', 36.08, 'desconto', 0,
      'fator', 12, 'codigo_produto', 1003, 'valor_total_item', 39.87, 'ipi_valor', 0.76, 'outras_valor', 3.03, 'custo_flags', 'SSSSSSSS', 'origem_flags', 'produto',
      'cfop_entrada', '1403', 'quantidade_recebida', 12, 'codigo_local_estoque', COZ)), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c, 'itens', '[]'::jsonb), BAR, null);
  if r->>'status' <> 'lancada' then raise exception 'A: status %', r; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1001;
  if v <> 1.358333 then raise exception 'A: custo água %', v; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1002;
  if v <> 6.589583 then raise exception 'A: custo corona %', v; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1003;
  if v <> 3.3225 then raise exception 'A: custo tônica %', v; end if;
  select saldo into v from estoque_saldos where loja_id = v_loja and codigo_local_estoque = BAR and codigo_produto = 1001;
  if v <> 120 then raise exception 'A: saldo água BAR %', v; end if;
  select saldo into v from estoque_saldos where loja_id = v_loja and codigo_local_estoque = BAR and codigo_produto = 1002;
  if v <> 96 then raise exception 'A: saldo corona BAR %', v; end if;
  select saldo into v from estoque_saldos where loja_id = v_loja and codigo_local_estoque = COZ and codigo_produto = 1003;
  if v <> 12 then raise exception 'A: saldo tônica COZINHA %', v; end if;
  select count(*) into n from estoque_saldos where loja_id = v_loja and codigo_local_estoque = BAR and codigo_produto = 1003;
  if n <> 0 then raise exception 'A: tônica caiu no BAR'; end if;
  select nfi.full_object into fo from nota_fiscal_items nfi join compras_proprio c on c.nota_fiscal_id = nfi.nota_fiscal_id where c.id = v_c and nfi.n_sequencia = 1;
  if fo->'itensAjustes'->>'cCFOPEntrada' <> '1.403' then raise exception 'A: cCFOPEntrada %', fo; end if;
  if (fo->'itensAjustes'->>'nQtdeRecebida')::numeric <> 120 or fo->'itensAjustes'->>'cNaoGerarMovEstoque' <> 'N' then raise exception 'A: itensAjustes %', fo; end if;
  if (fo->'itensCabec'->>'vTotalItem')::numeric <> 176.41 or (fo->'itensCabec'->>'nSequencia')::int <> 1 then raise exception 'A: itensCabec %', fo; end if;
  if custo_estoque_item_omie(fo, 10, 16.299516) <> 163 then raise exception 'A: relatório da água %', custo_estoque_item_omie(fo, 10, 16.299516); end if;
  select nfi.full_object into fo from nota_fiscal_items nfi join compras_proprio c on c.nota_fiscal_id = nfi.nota_fiscal_id where c.id = v_c and nfi.n_sequencia = 3;
  if (fo->'itensAjustes'->>'codigo_local_estoque')::bigint <> COZ then raise exception 'A: local da tônica %', fo; end if;
  if fo->'itensCustoEstoque'->>'cICMSCusto' <> 'S' then raise exception 'A: marcações da tônica %', fo; end if;

  -- B — entrega parcial (NF 4010): valor de estoque inteiro sobre o que chegou
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220000040101123456785', jsonb_build_array(
    jsonb_build_object('linha', 1, 'c_prod', 'PX', 'quantidade', 40.9, 'valor_unitario', 74.9, 'valor_total', 3063.41, 'desconto', 0, 'fator', 1,
      'codigo_produto', 1004, 'valor_total_item', 3063.41, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra', 'quantidade_recebida', 37.888369)), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  select quantidade, custo_unitario into it.quantidade, v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1004;
  if it.quantidade <> 37.888369 or v <> 80.853573 then raise exception 'B: % a %', it.quantidade, v; end if;

  -- C — caminho antigo (sem valor_total_item) igual à 181: fixture antiga do nfe-xml.test.ts
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'origem', 'xml', 'numero', 'C', 'valor_frete', 30, 'valor_desconto', 5, 'itens', jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 2, 'valor_unitario', 100, 'valor_total', 200, 'desconto', 10, 'codigo_produto', '1005'),
    jsonb_build_object('linha', 2, 'quantidade', 1, 'valor_unitario', 100, 'valor_total', 100, 'desconto', 0, 'codigo_produto', '1006'))), BAR, null);
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1005;
  if v <> 103.189655 then raise exception 'C: item 1 %', v; end if;
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1006;
  if v <> 108.62069 then raise exception 'C: item 2 %', v; end if;

  -- D — complementar / valor zero (NF 7433): não movimenta, conta como resolvido
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220000074331123456786', jsonb_build_array(
    jsonb_build_object('linha', 1, 'c_prod', 'ICMS', 'quantidade', 1, 'valor_unitario', 0, 'valor_total', 0, 'codigo_produto', 1005, 'valor_total_item', 0,
      'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra', 'movimenta_estoque', false)), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  if r->>'status' <> 'lancada' or (r->>'ignorados')::int <> 1 or (r->>'lancados')::int <> 0 then raise exception 'D: %', r; end if;
  select count(*) into n from estoque_movimentos where loja_id = v_loja and ref = '29260999111222000149550220000074331123456786';
  if n <> 0 then raise exception 'D: % movimentos', n; end if;
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220000074341123456787', jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 0, 'valor_total', 0, 'codigo_produto', 1005, 'valor_total_item', 0,
      'custo_flags', 'NNNNNNNN', 'movimenta_estoque', false),
    jsonb_build_object('linha', 2, 'quantidade', 2, 'valor_unitario', 5, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN')), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  if r->>'status' <> 'lancada' or (r->>'ignorados')::int <> 1 or (r->>'lancados')::int <> 1 then raise exception 'D2: %', r; end if;

  -- E — local inválido (excluído) por item: fica pendente; o outro entra
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220000000051123456788', jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN', 'codigo_local_estoque', VELHO),
    jsonb_build_object('linha', 2, 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1006, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN')), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  if r->>'status' <> 'parcial' or (r->>'pendentes')::int <> 1 then raise exception 'E: %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r->'itens') x where (x->>'linha')::int = 1 and x->>'motivo' = 'local_invalido') then raise exception 'E: motivo %', r; end if;

  -- F — reimportar mantém a configuração manual e a projeção
  v_c := pg_temp.compra_sefaz(v_loja, ch_f, jsonb_build_array(
    jsonb_build_object('linha', 1, 'c_prod', 'X1', 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10,
      'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra', 'cfop_entrada', '1407', 'origem_cfop', 'tabela', 'codigo_local_estoque', BAR)), BAR);
  select * into it from compras_proprio_itens where compra_id = v_c and linha = 1;
  r := configurar_item_compra(v_loja, it.id, jsonb_build_object('codigo_local_estoque', COZ, 'cfop_entrada', '1102', 'custo_flags', 'SSSSSSSS'), 'gerente');
  if (r->>'ok')::boolean is not true then raise exception 'F: configurar %', r; end if;
  perform pg_temp.compra_sefaz(v_loja, ch_f, jsonb_build_array(
    jsonb_build_object('linha', 1, 'c_prod', 'X1', 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10.5,
      'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra', 'cfop_entrada', '1407', 'origem_cfop', 'tabela', 'codigo_local_estoque', BAR)), BAR);
  select * into it from compras_proprio_itens where compra_id = v_c and linha = 1;
  if it.codigo_local_estoque <> COZ or it.cfop_entrada <> '1102' or it.origem_cfop <> 'manual' or it.origem_flags <> 'manual' or not it.custo_icms or not it.custo_outras then
    raise exception 'F: configuração perdida %', row_to_json(it); end if;
  if it.valor_total_item <> 10.5 then raise exception 'F: valor fiscal não veio da nota nova %', it.valor_total_item; end if;
  select nfi.full_object into fo from nota_fiscal_items nfi join compras_proprio c on c.nota_fiscal_id = nfi.nota_fiscal_id where c.id = v_c and nfi.n_sequencia = 1;
  if fo->'itensCustoEstoque'->>'cICMSCusto' <> 'S' or fo->'itensAjustes'->>'cCFOPEntrada' <> '1.102' or (fo->'itensAjustes'->>'codigo_local_estoque')::bigint <> COZ then
    raise exception 'F: projeção %', fo; end if;

  -- G — manifestação negativa registrada: não entra
  v_c := pg_temp.compra_sefaz(v_loja, ch_g, jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN')), BAR);
  insert into sefaz_manifestacoes (loja_id, chave, tp_evento, status) values (v_loja, ch_g, '210240', 'registrada');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  if r->>'status' <> 'recusada' or (r->>'lancados')::int <> 0 then raise exception 'G: %', r; end if;
  select count(*) into n from estoque_movimentos where loja_id = v_loja and ref = ch_g;
  if n <> 0 then raise exception 'G: % movimentos', n; end if;
  s := sincronizar_situacao_nota(v_loja, (select nota_fiscal_id from compras_proprio where id = v_c));
  if s <> 'recusada' then raise exception 'G: situação %', s; end if;

  -- H — conferência
  v_c := pg_temp.compra_sefaz(v_loja, ch_h, jsonb_build_array(
    jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'codigo_produto', 1005, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN'),
    jsonb_build_object('linha', 2, 'c_prod', 'SEM', 'quantidade', 1, 'valor_unitario', 10, 'valor_total', 10, 'valor_total_item', 10, 'custo_flags', 'NNNNNNNN')), BAR);
  r := marcar_compra_conferida(v_loja, v_c, 'gerente', '{}');
  if (r->>'ok')::boolean or r->'pendencias' <> '[{"linha": 2, "motivo": "sem_produto"}]'::jsonb then raise exception 'H: %', r; end if;
  if (select conferida_em from compras_proprio where id = v_c) is not null then raise exception 'H: gravou com pendência'; end if;
  select * into it from compras_proprio_itens where compra_id = v_c and linha = 2;
  perform vincular_item_compra(v_loja, it.id, 1006, 1, 'gerente');
  if (select unidade_estoque from compras_proprio_itens where id = it.id) <> 'FD' then raise exception 'H: unidade_estoque do produto'; end if;
  r := marcar_compra_conferida(v_loja, v_c, 'gerente', '{"aceitos":[]}');
  if (r->>'ok')::boolean is not true then raise exception 'H: conferida %', r; end if;
  s := sincronizar_situacao_nota(v_loja, (select nota_fiscal_id from compras_proprio where id = v_c));
  if s <> 'conferida' then raise exception 'H: situação %', s; end if;
  r := configurar_item_compra(v_loja, it.id, '{"quantidade_recebida": 2}', 'gerente');
  if (select conferida_em from compras_proprio where id = v_c) is not null then raise exception 'H: conferida_em não zerou'; end if;
  s := sincronizar_situacao_nota(v_loja, (select nota_fiscal_id from compras_proprio where id = v_c));
  if s <> 'a_conferir' then raise exception 'H: situação depois de mexer %', s; end if;
  -- configurar recusa local de outra loja/excluído, CFOP de saída e item lançado
  begin perform configurar_item_compra(v_loja, it.id, jsonb_build_object('codigo_local_estoque', VELHO), null); raise exception 'H: local excluído aceito';
  exception when sqlstate '22023' then null; end;
  begin perform configurar_item_compra(v_loja, it.id, '{"cfop_entrada": "5102"}', null); raise exception 'H: cfop 5102 aceito';
  exception when sqlstate '22023' then null; end;
  begin perform configurar_item_compra(v_loja, (select id from compras_proprio_itens where compra_id = (select id from compras_proprio where loja_id = v_loja and chave_acesso = ch_a) and linha = 1), '{"quantidade_recebida": 1}', null); raise exception 'H: item lançado aceito';
  exception when sqlstate '22023' then null; end;

  -- I — Omie intacto: os 7 casos da 175 com a função nova
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":6.5}'::jsonb, 'itensICMS', '{"nValor":1.33}'::jsonb, 'itensCustoEstoque', nflags), 1, 6.5) <> 5.17 then raise exception 'I: esponja'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":33}'::jsonb, 'itensICMS', '{"nValor":6.77}'::jsonb, 'itensCustoEstoque', nflags || '{"cIPICusto":"S","cICMSSTCusto":"S"}'), 1, 33) <> 26.23 then raise exception 'I: alho'; end if;
  if custo_estoque_item_omie('{"itensCabec":{"vTotalItem":3197.93,"vDesconto":12.97},"itensCustoEstoque":{"cIPICusto":"S","cICMSSTCusto":"S"}}', 77, 41.7) <> 3197.93 then raise exception 'I: pescada'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":189.23}'::jsonb, 'itensCustoEstoque', nflags), 12, 14.570054) <> 174.84 then raise exception 'I: agua'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":109.88,"vDesconto":0}'::jsonb, 'itensIPI', '{"nValIPI":1.58}'::jsonb, 'itensCustoEstoque', nflags), 2, 49.971587) <> 99.94 then raise exception 'I: h2o'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":241.79}'::jsonb, 'itensICMSST', '{"nValorST":11.79}'::jsonb, 'itensCustoEstoque', nflags), 20, 11.5) <> 230 then raise exception 'I: recorte'; end if;
  if custo_estoque_item_omie('{"itensCabec":{}}', 4, 54.9) <> 219.6 then raise exception 'I: sem marcações'; end if;
  -- ramo novo (bloco sefaz), mesmos números do teste TS (Task 3)
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":115}'::jsonb, 'itensCustoEstoque', nflags || '{"cFreteCusto":"S","cSeguroCusto":"N"}', 'sefaz', '{"vFrete":10,"vSeg":2}'::jsonb), 1, 100) <> 110 then raise exception 'I: frete/seguro'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":100}'::jsonb, 'itensCustoEstoque', nflags || '{"cFreteCusto":"S"}', 'sefaz', '{"vFrete":0,"vSeg":0,"freteCte":12.5}'::jsonb), 1, 100) <> 112.5 then raise exception 'I: CT-e S'; end if;
  if custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":100}'::jsonb, 'itensCustoEstoque', nflags, 'sefaz', '{"vFrete":0,"vSeg":0,"freteCte":12.5}'::jsonb), 1, 100) <> 100 then raise exception 'I: CT-e N'; end if;

  -- J — eventos
  select array_agg(e.tipo order by e.id) into tipos from compras_proprio_eventos e join compras_proprio c on c.id = e.compra_id where c.loja_id = v_loja and c.chave_acesso = ch_a;
  if tipos <> array['criada', 'lancada'] then raise exception 'J: eventos de A %', tipos; end if;
  select array_agg(e.tipo order by e.id) into tipos from compras_proprio_eventos e join compras_proprio c on c.id = e.compra_id where c.loja_id = v_loja and c.chave_acesso = ch_h;
  if tipos <> array['criada', 'item_vinculado', 'conferida', 'item_configurado'] then raise exception 'J: eventos de H %', tipos; end if;

  -- memória: último item lançado com marcações, por produto e por código do fornecedor
  select count(*) into n from memoria_itens_compra(v_loja, '99111222000149', array[1003::bigint], array['0018836'])
   where (tipo = 'produto' and chave = '1003' and flags = 'SSSSSSSS' and cfop_entrada = '1403' and codigo_local_estoque = COZ)
      or (tipo = 'fornecedor' and chave = '0018836' and flags = 'NNNNNNNN' and codigo_local_estoque = BAR);
  if n <> 2 then raise exception 'memória: % linhas certas', n; end if;
  raise notice '185 OK';
end $$;

-- K — (revisão final, achado 1) desfazer a entrada REABRE a compra (como o "reverter recebimento" do Omie) e ela pode
-- entrar de novo, sem dobrar o estoque; nota cancelada na SEFAZ continua sem entrar nunca (180).
do $$
declare v_loja bigint; BAR bigint := 2746972551; ch text := '29260999111222000149550220000090011123456781';
  ch2 text := '29260999111222000149550220000090021123456782'; v_c bigint; v_c2 bigint; r jsonb; v numeric; n int; s text; tipos text[]; it compras_proprio_itens%rowtype;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 185 K', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 2001, 'GIN', 'GIN', 'UN');
  v_c := pg_temp.compra_sefaz(v_loja, ch, jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'G1', 'quantidade', 10, 'valor_unitario', 5,
    'valor_total', 50, 'codigo_produto', 2001, 'valor_total_item', 50, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra', 'unidade_estoque', 'UN')), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, 'gerente');
  if r->>'status' <> 'lancada' then raise exception 'K: 1ª entrada %', r; end if;
  -- desfazer: estoque volta, a compra reabre (pendente), conferência zera, situação volta para "a conferir"
  r := estornar_compra(v_c, 'gerente');
  if (r->>'estornados')::int <> 1 then raise exception 'K: estorno %', r; end if;
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 0 then raise exception 'K: saldo depois de desfazer %', v; end if;
  if (select status from compras_proprio where id = v_c) <> 'pendente' then raise exception 'K: desfazer não reabriu: %', (select status from compras_proprio where id = v_c); end if;
  s := sincronizar_situacao_nota(v_loja, (select nota_fiscal_id from compras_proprio where id = v_c));
  if s <> 'a_conferir' then raise exception 'K: situação depois de desfazer %', s; end if;
  -- desfazer de novo não faz nada (nem evento)
  r := estornar_compra(v_c, 'gerente');
  if (r->>'estornados')::int <> 0 or (r->>'duplicado')::boolean is not true then raise exception 'K: 2º estorno %', r; end if;
  -- reaberta = editável e entra de novo pelo mesmo caminho do "Confirmar entrada"
  select * into it from compras_proprio_itens where compra_id = v_c and linha = 1;
  perform configurar_item_compra(v_loja, it.id, '{"quantidade_recebida": 8}', 'gerente');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c, 'itens', '[]'::jsonb), BAR, 'gerente');
  if r->>'status' <> 'lancada' or (r->>'lancados')::int <> 1 then raise exception 'K: 2ª entrada %', r; end if;
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 8 then raise exception 'K: saldo depois de entrar de novo % (esperado 8)', v; end if;
  -- duplo clique / fila do desktop: não dobra
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c, 'itens', '[]'::jsonb), BAR, 'gerente');
  if (r->>'lancados')::int <> 0 or (r->>'duplicado')::boolean is not true then raise exception 'K: relançar duplicou %', r; end if;
  -- terceiro ciclo
  perform estornar_compra(v_c, 'gerente');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c, 'itens', '[]'::jsonb), BAR, 'gerente');
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 8 then raise exception 'K: saldo no 3º ciclo %', v; end if;
  select count(*) into n from estoque_movimentos where loja_id = v_loja and origem = 'COMPRA' and codigo_produto = 2001;
  if n <> 3 then raise exception 'K: % entradas (esperado 3: uma por ciclo)', n; end if;
  select array_agg(tipo order by id) into tipos from compras_proprio_eventos where compra_id = v_c;
  if tipos <> array['criada', 'lancada', 'estornada', 'item_configurado', 'lancada', 'estornada', 'lancada'] then raise exception 'K: eventos %', tipos; end if;
  -- Fase A: nota cancelada na SEFAZ depois de entrar de novo → estorna e fica cancelada para sempre
  r := sefaz_marcar_cancelada(v_loja, ch);
  if (select status from compras_proprio where id = v_c) <> 'cancelada' then raise exception 'K: cancelada na SEFAZ virou %', (select status from compras_proprio where id = v_c); end if;
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 0 then raise exception 'K: saldo depois do cancelamento %', v; end if;
  begin
    r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c, 'itens', '[]'::jsonb), BAR, 'gerente');
    if r->>'status' <> 'cancelada' then raise exception 'K: nota cancelada entrou %', r; end if;
  exception when sqlstate '22023' then null; end;
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 0 then raise exception 'K: saldo depois de tentar lançar a cancelada %', v; end if;
  -- desfeita (reaberta) e depois cancelada na SEFAZ, sem entrar de novo: cancelada
  v_c2 := pg_temp.compra_sefaz(v_loja, ch2, jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 5, 'valor_total', 5,
    'codigo_produto', 2001, 'valor_total_item', 5, 'custo_flags', 'NNNNNNNN')), BAR);
  perform lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c2), BAR, null);
  perform estornar_compra(v_c2, null);
  perform sefaz_marcar_cancelada(v_loja, ch2);
  if (select status from compras_proprio where id = v_c2) <> 'cancelada' then raise exception 'K: reaberta e cancelada virou %', (select status from compras_proprio where id = v_c2); end if;
  begin
    r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c2, 'itens', '[]'::jsonb), BAR, null);
    if r->>'status' <> 'cancelada' then raise exception 'K: reaberta e cancelada entrou %', r; end if;
  exception when sqlstate '22023' then null; end;
  select coalesce(sum(saldo), 0) into v from estoque_saldos where loja_id = v_loja and codigo_produto = 2001;
  if v <> 0 then raise exception 'K: saldo final %', v; end if;
  raise notice '185 K (desfazer reabre) OK';
end $$;

-- L — (revisão final, achado 4) religar o item a OUTRO produto troca a unidade de estoque para a do produto novo e
-- zera a quantidade recebida (TEQUILA PRATA: produto em UN → produto em ML, 1 UND8 = 750 ML).
do $$
declare v_loja bigint; BAR bigint := 2746972551; v_c bigint; it compras_proprio_itens%rowtype; fo jsonb;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 185 L', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values
    (v_loja, 3001, 'TEQ-UN', 'TEQUILA PRATA (garrafa)', 'UN'), (v_loja, 3002, 'TEQ-ML', 'TEQUILA PRATA (dose)', 'ML');
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220001892151123456789', jsonb_build_array(jsonb_build_object('linha', 5, 'c_prod', 'TQP',
    'descricao', 'TEQUILA PRATA', 'unidade_compra', 'UND8', 'quantidade', 1, 'valor_unitario', 139.9, 'valor_total', 139.9, 'codigo_produto', 3001,
    'unidade_estoque', 'UN', 'valor_total_item', 139.9, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'regra')), BAR);
  select * into it from compras_proprio_itens where compra_id = v_c and linha = 5;
  perform configurar_item_compra(v_loja, it.id, '{"quantidade_recebida": 1}', 'gerente');
  perform vincular_item_compra(v_loja, it.id, 3002, 750, 'gerente');
  select * into it from compras_proprio_itens where id = it.id;
  if it.unidade_estoque is distinct from 'ML' then raise exception 'L: unidade ficou % (esperado ML, do produto novo)', it.unidade_estoque; end if;
  if it.quantidade_recebida is not null then raise exception 'L: quantidade recebida ficou % (esperado nula = 1 × 750)', it.quantidade_recebida; end if;
  select nfi.full_object into fo from nota_fiscal_items nfi join compras_proprio c on c.nota_fiscal_id = nfi.nota_fiscal_id where c.id = v_c and nfi.n_sequencia = 5;
  if fo->'itensAjustes'->>'cUnidade' <> 'ML' or (fo->'itensAjustes'->>'nQtdeRecebida')::numeric <> 750 then raise exception 'L: projeção %', fo->'itensAjustes'; end if;
  -- mesmo produto, outro fator: a unidade fica
  perform configurar_item_compra(v_loja, it.id, '{"unidade_estoque": "L"}', 'gerente');
  perform vincular_item_compra(v_loja, it.id, 3002, 700, 'gerente');
  if (select unidade_estoque from compras_proprio_itens where id = it.id) <> 'L' then raise exception 'L: mesmo produto trocou a unidade'; end if;
  raise notice '185 L (religar troca a unidade) OK';
end $$;

-- M — (revisão final, achado 3) CSOSN 101 sem ICMS próprio: o crédito do Simples sai do custo como ICMS (HIPÓTESE).
-- Mesmo caso do teste TS 'HIPÓTESE CSOSN 101' (nf-item-regras.test.ts): 158,92 ÷ 120 = 1,324333.
do $$
declare v_loja bigint; BAR bigint := 2746972551; v_c bigint; r jsonb; v numeric;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 185 M', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 1001, 'AGUA', 'AGUA', 'UN');
  v_c := pg_temp.compra_sefaz(v_loja, '29260999111222000149550220001310991123456780', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', '0023552',
    'quantidade', 10, 'valor_unitario', 16.299516, 'valor_total', 163, 'fator', 12, 'codigo_produto', 1001, 'valor_total_item', 176.41, 'outras_valor', 13.41,
    'icms_valor', 0, 'custo_flags', 'NNNNNNNN', 'origem_flags', 'padrao', 'fiscal', '{"csosn":"101","credIcmsSn":4.08,"aliqCredSn":2.5}'::jsonb)), BAR);
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  select custo_unitario into v from estoque_movimentos where loja_id = v_loja and codigo_produto = 1001;
  if v <> 1.324333 then raise exception 'M: custo CSOSN 101 % (esperado 1,324333, igual à prévia)', v; end if;
  raise notice '185 M (CSOSN 101) OK';
end $$;

-- K2 — (revisão final, achado 1) a nova entrada da compra reaberta (ref <chave>#2) leva o lote e a validade do item
do $$
declare v_loja bigint; BAR bigint := 2746972551; ch text := '29260999111222000149550220000090031123456783'; v_c bigint; n int;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 185 K2', '66764497000122', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, BAR, '01 - BAR');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 2002, 'QUEIJO', 'QUEIJO', 'KG');
  v_c := pg_temp.compra_sefaz(v_loja, ch, jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 2, 'valor_unitario', 30, 'valor_total', 60,
    'codigo_produto', 2002, 'valor_total_item', 60, 'custo_flags', 'NNNNNNNN')), BAR);
  update compras_proprio_itens set lote = 'L-K2', validade = '2027-01-31' where compra_id = v_c;
  perform lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  perform estornar_compra(v_c, null);
  perform lancar_compra(jsonb_build_object('loja_id', v_loja, 'id', v_c), BAR, null);
  -- o saldo da 2ª entrada fica no mesmo lote (não num lote sem nome/validade padrão)
  select count(*) into n from estoque_lotes where loja_id = v_loja and codigo_produto = 2002 and saldo > 0 and lote = 'L-K2' and validade = '2027-01-31';
  if n <> 1 or exists (select 1 from estoque_lotes where loja_id = v_loja and codigo_produto = 2002 and saldo > 0 and lote is distinct from 'L-K2') then raise exception 'K2: lote da 2ª entrada (% linhas; lotes: %)', n, (select json_agg(row_to_json(l)) from estoque_lotes l where loja_id = v_loja); end if;
  raise notice '185 K2 (lote na nova entrada) OK';
end $$;
