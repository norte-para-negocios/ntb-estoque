-- Teste da migration 313 (entrada da compra na data da nota + reprocessamento). CÓPIA local, nunca produção. Precisa da
-- 311 e da 312. Tudo dentro de BEGIN … ROLLBACK:
--   begin; \i supabase/migrations/311_custo_revisao.sql \i supabase/migrations/312_reprocessar_custo.sql
--          \i supabase/migrations/313_compra_data_da_nota.sql \i scripts/testes-sql/313_compra_data_da_nota.sql rollback;
-- Espera: NOTICE "313 COMPRA DATA DA NOTA OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99313, '00000000099313', 'TESTE 313', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99313, 8000000031301, 'Estoque', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99313, 8000000031311, '31311', 'Coca Zero 313', 'UN', '00'),
  (99313, 8000000031312, '31312', 'Guaraná 313', 'UN', '00');

do $$
declare L bigint := 8000000031301; COCA bigint := 8000000031311; GUA bigint := 8000000031312;
        CH1 text := '29261000000000000000550010000000011000000011';
        CH2 text := '29261000000000000000550010000000021000000021';
        CH3 text := '29261000000000000000550010000000031000000031';
        r jsonb; v_venda bigint; v_comp bigint; e record; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- ledger começa em 05/10: 4 a R$ 5; venda de 6 em 20/10 (saldo negativo, sem a nota)
  perform registrar_movimento(99313, L, COCA, 'ENT', 'COMPRA', 'ini', 4, 5.00, null, null, 0, null, null, '2026-10-05');
  r := registrar_movimento(99313, L, COCA, 'SAI', 'VENDA', 'v1', 6, null, null, null, 0, null, null, '2026-10-20');
  v_venda := (r->>'id')::bigint;

  -- 1) nota com dhSaiEnt 09/10 (emissão 08/10) chega pela SEFAZ e é lançada hoje
  insert into sefaz_documentos (loja_id, nsu, tipo, chave, completo, xml)
  values (99313, '000000000000001', 'procNFe', CH1, true,
          '<nfeProc><NFe><infNFe><ide><dhEmi>2026-10-08T09:00:00-03:00</dhEmi><dhSaiEnt>2026-10-09T15:00:00-03:00</dhSaiEnt></ide></infNFe></NFe></nfeProc>');
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'chave_acesso', CH1, 'numero', '1', 'emissao', '2026-10-08', 'origem', 'sefaz',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'A1', 'descricao', 'Coca', 'quantidade', 10, 'valor_unitario', 4,
                                                      'valor_total', 40, 'codigo_produto', COCA, 'fator', 1))), L, null);
  assert r->>'status' = 'lancada', 'compra lançada: ' || r::text;
  assert r->>'data_entrada' = '2026-10-09', 'entrada na data de saída/entrada da nota: ' || r::text;
  v_comp := (r->>'compra_id')::bigint;
  assert (select m.data_ref from estoque_movimentos m join compras_proprio_itens i on i.movimento_id = m.id where i.compra_id = v_comp) = '2026-10-09',
    'movimento gravado com a data da nota';
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 4.285714 and e.revisado, 'a venda de 20/10 ganha o custo da nota: ' || e.custo_unitario;
  assert (select cmc from estoque_custos where loja_id = 99313 and codigo_produto = COCA) = 4.285714, 'CMC de hoje bate com o ledger';
  assert (select saldo_total from estoque_custos where loja_id = 99313 and codigo_produto = COCA)
       = (select sum(quantidade) from estoque_movimentos where loja_id = 99313 and codigo_produto = COCA), 'saldo = ledger';
  assert (r->'reprocessamento'->>'movimentos_revisados')::int >= 2, 'reprocessou: ' || r::text;
  -- mesma chave de novo: não lança nem reprocessa de novo
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'chave_acesso', CH1, 'itens', '[]'::jsonb), L, null);
  assert (r->>'lancados')::int = 0 and (r->>'ja_lancados')::int = 1, 'reenvio não duplica: ' || r::text;

  -- 2) nota sem XML com emissão no futuro → hoje; emissão antes do início do ledger → início do ledger
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'numero', '2', 'emissao', '2027-01-10',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 3, 'valor_total', 3, 'codigo_produto', GUA))), L, null);
  assert r->>'data_entrada' = v_hoje::text, 'emissão futura vira hoje: ' || r::text;
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'numero', '3', 'emissao', '2026-08-01',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 3, 'valor_total', 3, 'codigo_produto', GUA))), L, null);
  assert r->>'data_entrada' = '2026-10-05', 'antes do início do ledger vira o início: ' || r::text;

  -- 3) mês fechado: vale o 1º dia aberto, com aviso na compra
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por) values (99313, '2026-10-01', 'teste');
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'chave_acesso', CH2, 'numero', '4', 'emissao', '2026-10-25',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 3, 'valor_total', 3, 'codigo_produto', GUA))), L, null);
  assert r->>'data_entrada' = '2026-11-01', 'mês fechado: 1º dia aberto: ' || r::text;
  assert exists (select 1 from jsonb_array_elements_text(r->'avisos') a where a like '%fechado%'), 'aviso no retorno: ' || r::text;
  assert exists (select 1 from compras_proprio_eventos where compra_id = (r->>'compra_id')::bigint and tipo = 'lancada'
                  and detalhe->>'data_entrada' = '2026-11-01' and detalhe->>'aviso_data' like '%fechado%'), 'aviso gravado na compra';
  delete from estoque_periodo_fechado where loja_id = 99313;

  -- 4) desfazer a entrada: o par sai da cadeia e a venda volta ao custo sem a nota
  r := estornar_compra(v_comp, null);
  assert (r->>'estornados')::int = 1, 'estornou: ' || r::text;
  assert (r->'reprocessamento'->>'desde_efetivo') = '2026-10-09', 'reprocessa desde a data da entrada: ' || r::text;
  select * into e from estoque_movimentos_efetivo where id = v_venda;
  assert e.custo_unitario = 5, 'sem a nota a venda volta a sair a 5: ' || e.custo_unitario;
  assert (select cmc from estoque_custos where loja_id = 99313 and codigo_produto = COCA) = 5, 'CMC sem a nota';
  assert (select saldo_total from estoque_custos where loja_id = 99313 and codigo_produto = COCA) = -2, 'saldo sem a nota';

  -- 5) a nota 3 lançada de novo (reaberta) volta a entrar na data da nota
  insert into sefaz_documentos (loja_id, nsu, tipo, chave, completo, xml)
  values (99313, '000000000000002', 'procNFe', CH3, true, '<nfeProc><NFe><infNFe><ide><dEmi>2026-10-11</dEmi><dSaiEnt>2026-10-12</dSaiEnt></ide></infNFe></NFe></nfeProc>');
  r := lancar_compra(jsonb_build_object('loja_id', 99313, 'chave_acesso', CH3, 'numero', '5', 'emissao', '2026-10-11',
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 3, 'valor_total', 3, 'codigo_produto', GUA))), L, null);
  assert r->>'data_entrada' = '2026-10-12', 'dSaiEnt (layout antigo) também vale: ' || r::text;
  raise notice '313 COMPRA DATA DA NOTA OK';
end $$;
