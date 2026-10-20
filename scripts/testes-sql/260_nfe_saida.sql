-- Teste das migrations 260 (NF-e de saída) e 261 (transferência entre lojas). Banco LOCAL (260_preparar_banco.sh), nunca
-- produção. Nada aqui fala com a SEFAZ: o "retorno" é gravado à mão como o servidor gravaria.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d nf1 < scripts/testes-sql/260_nfe_saida.sql
begin;
do $$
declare
  v_loja bigint; v_dest bigint; v_outra bigint; v_omie bigint; r jsonb; v_b bigint; v_item bigint; v_dev bigint; v_nfe bigint; v_nfe2 bigint;
  v_trl bigint; n int; e text; v_chave text; v_saldo numeric; c estoque_custos%rowtype;
begin
  insert into lojas (nome, cnpj, modo_estoque, uf) values ('TESTE 260', '11222333000181', 'proprio', 'BA') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque, uf) values ('TESTE 260 FILIAL', '11222333000262', 'proprio', 'BA') returning id into v_dest;
  insert into lojas (nome, cnpj, modo_estoque, uf) values ('OUTRA EMPRESA', '99888777000100', 'omie', 'SP') returning id into v_outra;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 260 OMIE', '00000000000260', 'omie') returning id into v_omie;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (v_loja, 1, 'DEPOSITO', 'S');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, ncm) values (v_loja, 601, 'P601', 'AZEITE', 'UN', '15091000');

  r := lancar_compra(jsonb_build_object('loja_id', v_loja, 'origem', 'manual', 'numero', '300', 'fornecedor_nome', 'EMPORIO',
        'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'descricao', 'AZEITE', 'quantidade', 10, 'valor_unitario', 30, 'valor_total', 300, 'fator', 1, 'codigo_produto', 601))), 1, 'u1');
  v_b := (r->>'compra_id')::bigint;
  select id into v_item from compras_proprio_itens where compra_id = v_b;
  r := devolucao_fornecedor_registrar(v_loja, v_b, jsonb_build_array(jsonb_build_object('compra_item_id', v_item, 'quantidade', 4, 'cfop', '5.202')), 'vencido', 'u1', 'Ana', 'dev-260');
  v_dev := (r->>'id')::bigint;

  -- 1. sem configuração fiscal: recusa com mensagem clara
  begin perform nfe_reservar(v_loja, 2, 'devolucao', v_dev, 'u1', 'Ana'); raise exception 'reservou sem CRT';
  exception when sqlstate '22023' then get stacked diagnostics e = message_text;
    if e not like '%CRT%' then raise exception 'mensagem sem CRT: %', e; end if; end;
  insert into nfe_config (loja_id, crt) values (v_loja, 1);
  -- produção sem série de produção: recusa
  begin perform nfe_reservar(v_loja, 1, 'devolucao', v_dev, 'u1', 'Ana'); raise exception 'reservou produção sem série';
  exception when sqlstate '22023' then null; end;
  -- loja Omie recusa
  begin perform nfe_reservar(v_omie, 2, 'devolucao', v_dev); raise exception 'omie reservou'; exception when sqlstate '22023' then null; end;

  -- 2. reserva em homologação: série 920, número 1; duplo clique devolve a mesma
  r := nfe_reservar(v_loja, 2, 'devolucao', v_dev, 'u1', 'Ana');
  v_nfe := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 or (r->>'serie')::int <> 920 or (r->>'duplicado')::boolean then raise exception 'reserva 1 %', r; end if;
  r := nfe_reservar(v_loja, 2, 'devolucao', v_dev, 'u1', 'Ana');
  if (r->>'id')::bigint <> v_nfe or not (r->>'duplicado')::boolean then raise exception 'duplo clique %', r; end if;

  -- 3. chave que não bate com número/série recusa; a certa marca 'enviando'
  v_chave := '29' || '2610' || '11222333000181' || '55' || '920' || '000000001' || '1' || '12345678' || '0';
  begin perform nfe_iniciar_envio(v_nfe, v_loja, '29261011222333000181559200000000021123456780', '<x/>', now(), 120, 'X', '1', '{}'); raise exception 'chave errada passou';
  exception when sqlstate '22023' then null; end;
  perform nfe_iniciar_envio(v_nfe, v_loja, v_chave, '<NFe/>', now(), 120, 'FORNECEDOR', '00', '{}', 'u1', 'Ana');
  -- 2º envio simultâneo recusa
  begin perform nfe_iniciar_envio(v_nfe, v_loja, v_chave, '<NFe/>', now(), 120, 'F', '0', '{}'); raise exception 'envio duplo';
  exception when sqlstate '22023' then get stacked diagnostics e = message_text;
    if e not like '%em andamento%' then raise exception 'msg envio duplo: %', e; end if; end;

  -- 4. rejeição: volta a poder enviar com o MESMO número
  perform nfe_registrar_retorno(v_nfe, v_loja, 'rejeitada', '225', 'Falha no Schema XML');
  if (select status from nfe_saida where id = v_nfe) <> 'rejeitada' then raise exception 'rejeitada'; end if;
  perform nfe_iniciar_envio(v_nfe, v_loja, v_chave, '<NFe/>', now(), 120, 'F', '0', '{}');
  -- 5. sem resposta (incerta): reenviar recusa até consultar
  perform nfe_registrar_retorno(v_nfe, v_loja, 'incerta', null, 'Tempo esgotado');
  begin perform nfe_iniciar_envio(v_nfe, v_loja, v_chave, '<NFe/>', now(), 120, 'F', '0', '{}'); raise exception 'reenviou incerta';
  exception when sqlstate '22023' then null; end;
  -- descartar incerta recusa (pode ter sido autorizada)
  begin perform nfe_descartar(v_nfe, v_loja); raise exception 'descartou incerta'; exception when sqlstate '22023' then null; end;

  -- 6. consulta acha autorizada (homologação): a devolução NÃO muda (homologação não tem valor fiscal)
  perform nfe_registrar_retorno(v_nfe, v_loja, 'autorizada', '100', 'Autorizado o uso da NF-e', '129260000000001', now(), null, '<nfeProc/>', '<ret/>', 'consulta');
  if (select situacao from devolucoes_fornecedor where id = v_dev) <> 'a_emitir' then raise exception 'homologação mexeu na devolução'; end if;
  -- fato posterior diferente não rebaixa uma autorizada
  r := nfe_registrar_retorno(v_nfe, v_loja, 'rejeitada', '204', 'Duplicidade');
  if (r->>'status') <> 'autorizada' or (select status from nfe_saida where id = v_nfe) <> 'autorizada' then raise exception 'rebaixou %', r; end if;

  -- 7. produção: série configurada, próximo número 501 (continua a sequência antiga); não volta atrás
  update nfe_config set serie_producao = 1 where loja_id = v_loja;
  perform nfe_definir_proximo_numero(v_loja, 1, 1, 501);
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev, 'u1', 'Ana');
  v_nfe2 := (r->>'id')::bigint;
  if (r->>'numero')::int <> 501 or (r->>'serie')::int <> 1 then raise exception 'reserva produção %', r; end if;
  begin perform nfe_definir_proximo_numero(v_loja, 1, 1, 400); raise exception 'número voltou'; exception when sqlstate '22023' then null; end;
  v_chave := '29261011222333000181550010000005011876543210';
  perform nfe_iniciar_envio(v_nfe2, v_loja, v_chave, '<NFe/>', now(), 120, 'F', '0', '{}');
  perform nfe_registrar_retorno(v_nfe2, v_loja, 'autorizada', '100', 'Autorizado', '129260000000502', now(), null, '<nfeProc/>', '<ret/>');
  if (select situacao from devolucoes_fornecedor where id = v_dev) <> 'emitida' then raise exception 'produção não marcou emitida'; end if;
  if not exists (select 1 from devolucoes_fornecedor_eventos where devolucao_id = v_dev and tipo = 'emitida') then raise exception 'evento emitida'; end if;
  -- devolução emitida não se cancela (231) e com NF-e autorizada também não (260)
  begin perform devolucao_fornecedor_cancelar(v_loja, v_dev, 'u1', 'Ana', 'x'); raise exception 'cancelou emitida'; exception when sqlstate '22023' then null; end;

  -- 8. CC-e e cancelamento: checagem antes da SEFAZ, registro depois
  r := nfe_checar_evento(v_nfe2, v_loja, 'carta de correção');
  if (r->>'chave') <> v_chave then raise exception 'checar %', r; end if;
  perform nfe_registrar_cce(v_nfe2, v_loja, 1, 'Correcao do endereco do destinatario', '129260000000503', '<procEventoNFe/>');
  if (select cce_seq from nfe_saida where id = v_nfe2) <> 1 then raise exception 'cce seq'; end if;
  perform nfe_checar_evento(v_nfe2, v_loja, 'cancelamento');
  perform nfe_registrar_cancelamento(v_nfe2, v_loja, '129260000000504', now(), 'Devolucao registrada por engano', '<procEventoNFe/>');
  if (select situacao from devolucoes_fornecedor where id = v_dev) <> 'a_emitir' then raise exception 'cancelamento não voltou a devolução'; end if;
  if not exists (select 1 from devolucoes_fornecedor_eventos where devolucao_id = v_dev and tipo = 'nfe_cancelada') then raise exception 'evento nfe_cancelada'; end if;
  -- cancelada: checar evento recusa
  begin perform nfe_checar_evento(v_nfe2, v_loja, 'cancelamento'); raise exception 'evento em cancelada'; exception when sqlstate '22023' then null; end;

  -- 9. nova emissão depois do cancelamento: próximo número (502), o 501 ficou consumido
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev, 'u1', 'Ana');
  if (r->>'numero')::int <> 502 then raise exception 'número depois do cancelamento %', r; end if;
  -- descartar rascunho libera o 502; a próxima reserva reaproveita o 502 (sem buraco)
  perform nfe_descartar((r->>'id')::bigint, v_loja, 'u1', 'Ana', 'teste');
  r := nfe_reservar(v_loja, 1, 'devolucao', v_dev, 'u1', 'Ana');
  if (r->>'numero')::int <> 502 or not (r->>'reaproveitado')::boolean then raise exception 'reaproveitamento %', r; end if;
  -- cancelar a devolução com NF-e em rascunho: passa e a NF-e vira descartada
  perform devolucao_fornecedor_cancelar(v_loja, v_dev, 'u1', 'Ana', 'desistiu');
  if (select status from nfe_saida where id = (r->>'id')::bigint) <> 'descartada' then raise exception 'rascunho não descartado'; end if;
  -- devolução cancelada não emite
  begin perform nfe_reservar(v_loja, 1, 'devolucao', v_dev); raise exception 'emitiu cancelada'; exception when sqlstate '22023' then null; end;

  -- 10. mês fechado: CC-e/cancelamento de NF-e emitida num mês fechado recusa ANTES da SEFAZ
  update nfe_saida set data_emissao = date '2026-08-15' where id = v_nfe;
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por, fechado_por_nome) values (v_loja, date '2026-08-01', 'u1', 'Ana');
  begin perform nfe_checar_evento(v_nfe, v_loja, 'cancelamento'); raise exception 'mês fechado passou';
  exception when sqlstate 'PF001' then null; end;

  -- 11. NF-e nunca se apaga; eventos são append-only
  begin delete from nfe_saida where id = v_nfe; raise exception 'apagou nfe'; exception when sqlstate '55000' then null; end;
  begin update nfe_saida_eventos set tipo = 'erro' where nfe_id = v_nfe; raise exception 'mudou evento'; exception when sqlstate '55000' then null; end;

  -- ============================================================================ 261: transferência entre lojas
  -- estoque: 10 compradas − 4 devolvidas + 4 de volta (cancelamento) = 10 a R$ 30
  select * into c from estoque_custos where loja_id = v_loja and codigo_produto = 601;
  if c.saldo_total <> 10 then raise exception 'saldo antes da transferência %', c.saldo_total; end if;
  -- loja Omie (origem) recusa
  begin perform transferencia_loja_registrar(v_omie, v_loja, '[{"codigo_produto":601,"codigo_local_estoque":1,"quantidade":1}]'::jsonb); raise exception 'omie transferiu';
  exception when sqlstate '22023' then null; end;
  -- produto de outra loja recusa
  begin perform transferencia_loja_registrar(v_loja, v_dest, '[{"codigo_produto":999,"codigo_local_estoque":1,"quantidade":1}]'::jsonb); raise exception 'produto alheio';
  exception when sqlstate '22023' then null; end;
  r := transferencia_loja_registrar(v_loja, v_dest, '[{"codigo_produto":601,"codigo_local_estoque":1,"quantidade":3}]'::jsonb, 'reforço', 'u1', 'Ana', 'trl-1');
  v_trl := (r->>'id')::bigint;
  if (r->>'natureza') <> 'transferencia' or (r->>'valor')::numeric <> 90 or (r->>'numero')::int <> 1 then raise exception 'transferência %', r; end if;
  r := transferencia_loja_registrar(v_loja, v_dest, '[{"codigo_produto":601,"codigo_local_estoque":1,"quantidade":3}]'::jsonb, 'reforço', 'u1', 'Ana', 'trl-1');
  if not (r->>'duplicado')::boolean then raise exception 'idempotência transferência %', r; end if;
  select saldo into v_saldo from estoque_saldos where loja_id = v_loja and codigo_local_estoque = 1 and codigo_produto = 601;
  if v_saldo <> 7 then raise exception 'saldo depois da transferência %', v_saldo; end if;
  if (select custo_unitario from transferencias_loja_itens where transferencia_id = v_trl) <> 30 then raise exception 'custo do item'; end if;
  -- outra raiz de CNPJ = remessa
  r := transferencia_loja_registrar(v_loja, v_outra, '[{"codigo_produto":601,"codigo_local_estoque":1,"quantidade":1}]'::jsonb, null, 'u1', 'Ana');
  if (r->>'natureza') <> 'remessa' then raise exception 'remessa %', r; end if;
  perform transferencia_loja_cancelar(v_loja, (r->>'id')::bigint, 'u1', 'Ana', 'erro');
  -- NF-e da transferência: produção autorizada trava o cancelamento da transferência
  r := nfe_reservar(v_loja, 1, 'transferencia_loja', v_trl, 'u1', 'Ana');
  -- o 502 descartado junto com a devolução cancelada volta para a fila: a transferência o reaproveita
  if (r->>'numero')::int <> 502 or not (r->>'reaproveitado')::boolean then raise exception 'número da transferência %', r; end if;
  v_nfe := (r->>'id')::bigint;
  perform nfe_iniciar_envio(v_nfe, v_loja, '29' || '2610' || '11222333000181' || '55' || '001' || '000000502' || '1' || '00000001' || '7', '<NFe/>', now(), 90, 'FILIAL', '1', '{}');
  perform nfe_registrar_retorno(v_nfe, v_loja, 'autorizada', '100', 'Autorizado', '129260000000600', now(), null, '<nfeProc/>', '<ret/>');
  begin perform transferencia_loja_cancelar(v_loja, v_trl, 'u1', 'Ana', 'x'); raise exception 'cancelou com NF-e'; exception when sqlstate '22023' then null; end;
  perform nfe_registrar_cancelamento(v_nfe, v_loja, '129260000000601', now(), 'Transferencia registrada errada', '<procEventoNFe/>');
  r := transferencia_loja_cancelar(v_loja, v_trl, 'u1', 'Ana', 'errada');
  if (r->>'estornados')::int <> 1 then raise exception 'estorno transferência %', r; end if;
  select saldo into v_saldo from estoque_saldos where loja_id = v_loja and codigo_local_estoque = 1 and codigo_produto = 601;
  if v_saldo <> 10 then raise exception 'saldo depois de cancelar a transferência %', v_saldo; end if;
  -- transferência cancelada não emite
  begin perform nfe_reservar(v_loja, 1, 'transferencia_loja', v_trl); raise exception 'emitiu transferência cancelada'; exception when sqlstate '22023' then null; end;

  raise notice 'OK: 260/261 — todos os cenários passaram';
end $$;
rollback;
