-- Revisão independente da 260/261 (C1, menores). Banco LOCAL (260_preparar_banco.sh), nunca produção; nada fala com a SEFAZ.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d nf1 < scripts/testes-sql/260_nfe_saida_revisao.sql
begin;
do $$
declare
  v_loja bigint; v_dest bigint; r jsonb; v_b bigint; v_item bigint; v_dev bigint; v_dev2 bigint; v_nfe bigint; v_nfe2 bigint; e text;
  ch1 text := '29261011222333000181550010000000011000000011';
  ch2 text := '29261011222333000181550010000000011000000029';
  x1 text := '<NFe><infNFe Id="NFe' || ch1 || '"/></NFe>';
  x2 text := '<NFe><infNFe Id="NFe' || ch2 || '"/></NFe>';
  n nfe_saida%rowtype;
begin
  insert into lojas (nome, cnpj, modo_estoque, uf) values ('REV 260', '11222333000181', 'proprio', 'BA') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque, uf) values ('REV 260 FILIAL', '11222333000262', 'proprio', 'BA') returning id into v_dest;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (v_loja, 1, 'DEPOSITO', 'S');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm) values (v_loja, 701, 'P701', 'OLEO', 'UN', '15079011');
  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'origem', 'manual', 'numero', '900', 'fornecedor_nome', 'F',
        'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'descricao', 'OLEO', 'quantidade', 20, 'valor_unitario', 10, 'valor_total', 200, 'fator', 1, 'codigo_produto', 701))), 1, 'u1');
  v_b := (r->>'compra_id')::bigint;
  select id into v_item from compras_proprio_itens where compra_id = v_b;
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item, 'quantidade', 2, 'cfop', '5.202')), 'rev', 'u1', 'Ana');
  v_dev := (r->>'id')::bigint;
  insert into nfe_config (loja_id, crt, serie_producao) values (v_loja, 1, 1);

  -- CHECK: PIS/COFINS só 49/99 (CSTs de saída do grupo Outr)
  begin update nfe_config set cst_pis_cofins = '50' where loja_id = v_loja; raise exception 'aceitou CST 50';
  exception when check_violation then null; end;

  -- ===== C1: envio sem resposta prende a chave
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev, 'u1', 'Ana');
  v_nfe := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 then raise exception 'número 1 %', r; end if;
  perform nfe_iniciar_envio(v_nfe, v_loja, ch1, x1, now(), 20, 'F', '0', '{}');
  select * into n from nfe_saida where id = v_nfe;
  if n.pode_regerar or n.ultimo_envio_em is null then raise exception 'envio não prendeu a chave'; end if;
  -- falha ANTES de conectar: volta ao estado anterior (rascunho, livre)
  perform nfe_registrar_erro(v_nfe, v_loja, 'DNS', true);
  select * into n from nfe_saida where id = v_nfe;
  if n.status <> 'rascunho' or not n.pode_regerar then raise exception 'erro antes do envio não restaurou: % %', n.status, n.pode_regerar; end if;
  -- envia de novo; consulta 217 recente vira 'rejeitada' NÃO definitiva (o servidor manda p_pode_regerar false)
  perform nfe_iniciar_envio(v_nfe, v_loja, ch1, x1, now(), 20, 'F', '0', '{}');
  perform nfe_registrar_retorno(v_nfe, v_loja, 'rejeitada', '217', 'NF-e nao consta na base', null, null, null, null, null, 'consulta', null, null, false);
  -- descartar recusado (o número podia ser reaproveitado por OUTRA chave e gerar 2ª NF-e autorizada)
  begin perform nfe_descartar(v_nfe, v_loja); raise exception 'descartou com chave presa';
  exception when sqlstate '22023' then get stacked diagnostics e = message_text;
    if e not like '%pode já ter%' then raise exception 'msg descarte: %', e; end if; end;
  -- outra chave para o mesmo número recusada; o MESMO XML passa
  begin perform nfe_iniciar_envio(v_nfe, v_loja, ch2, x2, now(), 20, 'F', '0', '{}'); raise exception 'nova chave com a antiga presa';
  exception when sqlstate '22023' then null; end;
  begin perform nfe_iniciar_envio(v_nfe, v_loja, ch1, '<NFe>outro</NFe>', now(), 20, 'F', '0', '{}'); raise exception 'mesmo número/chave com XML diferente';
  exception when sqlstate '22023' then null; end;
  -- cancelar a devolução com NF-e de produção presa: recusado
  begin perform devolucao_fornecedor_cancelar(v_loja, v_dev, 'u1', 'Ana', 'x'); raise exception 'cancelou devolução com chave presa';
  exception when sqlstate '22023' then null; end;
  perform nfe_iniciar_envio(v_nfe, v_loja, ch1, x1, now(), 20, 'F', '0', '{}');
  -- rejeição DEFINITIVA da autorização (ex.: 225): libera nova chave e descarte
  perform nfe_registrar_retorno(v_nfe, v_loja, 'rejeitada', '225', 'Falha no Schema', null, null, null, null, null, 'retorno', null, null, true);
  if not (select pode_regerar from nfe_saida where id = v_nfe) then raise exception 'rejeição definitiva não liberou'; end if;
  perform nfe_iniciar_envio(v_nfe, v_loja, ch2, x2, now(), 20, 'F', '0', '{}');

  -- ===== C1/539: a SEFAZ diz que tem o número com a chave 1 (de um envio nosso): volta para ela, XML junto, incerta
  r := nfe_restaurar_chave(v_nfe, v_loja, ch1);
  select * into n from nfe_saida where id = v_nfe;
  if not (r->>'achou')::boolean or n.chave <> ch1 or n.xml_assinado <> x1 or n.status <> 'incerta' or n.pode_regerar then
    raise exception 'restaurar chave: % % % %', r, n.chave, n.status, n.pode_regerar;
  end if;
  -- chave desconhecida: incerta e presa
  r := nfe_restaurar_chave(v_nfe, v_loja, '29261099999999000191550010000000011000000014');
  if (r->>'achou')::boolean then raise exception 'achou chave alheia'; end if;
  -- a consulta acha a chave 1 autorizada (produção): devolução emitida
  perform nfe_registrar_retorno(v_nfe, v_loja, 'autorizada', '100', 'Autorizado', '129260000000901', now(), null, '<nfeProc/>', null, 'consulta');
  if (select situacao from devolucoes_fornecedor where id = v_dev) <> 'emitida' then raise exception 'não emitiu'; end if;

  -- ===== denegada não prende o documento
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item, 'quantidade', 1, 'cfop', '5.202')), 'rev2', 'u1', 'Ana');
  v_dev2 := (r->>'id')::bigint;
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev2, 'u1', 'Ana');
  v_nfe2 := (r->>'id')::bigint;
  perform nfe_iniciar_envio(v_nfe2, v_loja, '29261011222333000181550010000000021000000036', '<NFe>3</NFe>', now(), 10, 'F', '0', '{}');
  perform nfe_registrar_retorno(v_nfe2, v_loja, 'denegada', '302', 'Uso denegado: destinatario irregular');
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev2, 'u1', 'Ana');
  if (r->>'duplicado')::boolean or (r->>'numero')::int <> 3 then raise exception 'denegada prendeu o documento %', r; end if;
  -- e cancelar a devolução com só rascunho/denegada passa
  perform devolucao_fornecedor_cancelar(v_loja, v_dev2, 'u1', 'Ana', 'denegada');

  -- ===== próximo número: descartado abaixo do novo início nunca volta
  -- o rascunho nº 3 foi descartado junto com a devolução; define próximo = 100 e a reserva nova pega 100, não 3
  perform nfe_definir_proximo_numero(v_loja, 1, 1, 100);
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item, 'quantidade', 1, 'cfop', '5.202')), 'rev3', 'u1', 'Ana');
  r := nfe_reservar(v_loja, 1, 'devolucao', (r->>'id')::bigint, 'u1', 'Ana');
  if (r->>'numero')::int <> 100 or (r->>'reaproveitado')::boolean then raise exception 'reaproveitou número abaixo do início %', r; end if;

  -- ===== 261: duplo clique (mesma chave) devolve o mesmo registro
  r := transferencia_loja_registrar(v_loja, v_dest, '[{"codigo_produto":701,"codigo_local_estoque":1,"quantidade":1}]'::jsonb, null, 'u1', 'Ana', 'dup-1');
  if (transferencia_loja_registrar(v_loja, v_dest, '[{"codigo_produto":701,"codigo_local_estoque":1,"quantidade":1}]'::jsonb, null, 'u1', 'Ana', 'dup-1')->>'id')::bigint <> (r->>'id')::bigint then
    raise exception 'idempotência da transferência';
  end if;
  if (select count(*) from transferencias_loja where loja_id = v_loja) <> 1 then raise exception 'duplicou transferência'; end if;

  begin truncate nfe_saida_eventos, nfe_saida; raise exception 'truncate passou'; exception when sqlstate '55000' then null; end;
  raise notice 'OK: revisão 260/261 — todos os cenários passaram';
end $$;
rollback;
