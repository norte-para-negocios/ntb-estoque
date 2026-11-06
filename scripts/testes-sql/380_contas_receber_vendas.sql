-- Teste da migration 380 (contas a receber geradas pelas vendas do Norte Vendas). Roda na loja 19 "ZZ NORTE ERP LAB"
-- (proprio, is_test; ligada à loja de teste do Vendas "ZZ NORTE ERP LAB (NAO E CLIENTE)" 3774fb33…, que ainda não tem venda),
-- com vendas SINTÉTICAS gravadas pelo caminho real (registrar_venda_proprio / cancelar_venda_proprio), TUDO dentro de
-- BEGIN … ROLLBACK (nada fica gravado). Rodar com scripts/testes-sql/380_rodar.sh.
-- A ODARA (loja 15) só é LIDA: a prévia (função só leitura) é conferida contra as vendas reais dela.
-- Espera: NOTICE "380 CONTAS A RECEBER DAS VENDAS OK".

create temp table _t380 (k text primary key, v text) on commit drop;

create function pg_temp.venda380(ref text, dia date, pags jsonb) returns void language sql as $$
  select null::void from (select registrar_venda_proprio(19, jsonb_build_object('pedidoRef', 't380-' || ref, 'data', dia,
    'valor', (select coalesce(sum((p->>'valor')::numeric), 0) from jsonb_array_elements(pags) p), 'itens', '[]'::jsonb, 'pagamentos', pags))) x
$$;
create function pg_temp.pg380(metodo text, valor numeric, bandeira text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('metodo', metodo, 'valor', valor, 'bandeira', bandeira))
$$;
create function pg_temp.tit(forma text, dia date default '2026-10-30') returns fin_titulos_receber language sql as $$
  select * from fin_titulos_receber where loja_id = 19 and data_venda = dia and forma = $1 and status <> 'cancelado'
$$;

do $$
declare
  L constant bigint := 19;
  D1 constant date := '2026-10-30'; -- sexta-feira
  D2 constant date := '2026-10-31'; -- sábado
  r jsonb; v_conta bigint; v_conta_outra bigint; v_cat bigint; t fin_titulos_receber; n int; v_rec bigint; v_saldo numeric;
  v_bruto_real numeric; v_previa numeric; x record;
begin
  -- ========== 0) pré-condições
  assert (select modo_estoque = 'proprio' and is_test and fin_cr_vendas_ativo from lojas where id = L), 'loja 19 laboratório com a chave ligada';
  assert (select not fin_cr_vendas_ativo from lojas where id = 15), 'ODARA desligada';
  assert (select count(*) from lojas where fin_cr_vendas_ativo) = 1, 'só a loja 19 ligada pela migration';
  assert not exists (select 1 from vendas_proprio where loja_id = L and data in (D1, D2)), 'loja 19 sem venda nos dias do teste';
  select id into v_cat from fin_categorias where loja_id = L and padrao = 'rec_vendas';
  assert v_cat is not null, 'categoria rec_vendas existe na loja 19';

  -- ========== 1) mapa metodo/bandeira → forma (mesma tabela do teste TS)
  assert fin_cr_forma_do_pagamento('CREDIT', 'visa') = 'credito';
  assert fin_cr_forma_do_pagamento('DEBIT', 'mastercard') = 'debito';
  assert fin_cr_forma_do_pagamento('PIX', null) = 'pix';
  assert fin_cr_forma_do_pagamento('CASH', null) = 'dinheiro';
  assert fin_cr_forma_do_pagamento('DEBIT', 'ticket') = 'voucher';
  assert fin_cr_forma_do_pagamento('CREDIT', 'Alelo') = 'voucher';
  assert fin_cr_forma_do_pagamento('credit', ' SODEXO ') = 'voucher';
  assert fin_cr_forma_do_pagamento('VOUCHER', null) = 'voucher';
  assert fin_cr_forma_do_pagamento('IFOOD', null) = 'app_entrega';
  assert fin_cr_forma_do_pagamento('rappi', null) = 'app_entrega';
  assert fin_cr_forma_do_pagamento('OUTRO', null) = 'outros';
  assert fin_cr_forma_do_pagamento(null, null) = 'outros';
  assert fin_cr_forma_do_pagamento('PIX', 'ticket') = 'pix';
  assert fin_cr_somar_dias('2026-11-06', 1, true) = '2026-11-09', 'sexta + 1 útil = segunda';
  assert fin_cr_somar_dias('2026-11-07', 0, true) = '2026-11-07', 'prazo 0 não anda';
  assert fin_cr_somar_dias('2026-11-06', 30, false) = '2026-12-06';

  -- ========== 2) recusas da geração
  begin perform fin_receber_vendas_gerar(15, D1, D1); raise exception 'gerou na ODARA (chave desligada)';
  exception when sqlstate '22023' then null; end;
  begin perform fin_receber_vendas_gerar(4, D1, D1); raise exception 'gerou na loja 4';
  exception when sqlstate '22023' then null; end;
  begin perform fin_receber_vendas_gerar(2, D1, D1); raise exception 'gerou em loja Omie';
  exception when sqlstate '22023' then null; end;
  begin perform fin_receber_vendas_gerar(L, D1, D1 + 93); raise exception 'aceitou período de 94 dias';
  exception when sqlstate '22023' then null; end;
  begin perform fin_receber_vendas_gerar(L, D2, D1); raise exception 'aceitou período invertido';
  exception when sqlstate '22023' then null; end;

  -- ========== 3) vendas sintéticas do dia D1 (o que o Vendas manda hoje + nomes futuros)
  perform pg_temp.venda380('a', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 100, 'visa')));
  perform pg_temp.venda380('b', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 50, 'mastercard'), pg_temp.pg380('PIX', 40)));
  perform pg_temp.venda380('c', D1, jsonb_build_array(pg_temp.pg380('DEBIT', 30, 'mastercard'), pg_temp.pg380('DEBIT', 20, 'ticket')));
  perform pg_temp.venda380('d', D1, jsonb_build_array(pg_temp.pg380('CASH', 10), pg_temp.pg380('IFOOD', 25), pg_temp.pg380('OUTRO', 5)));
  perform pg_temp.venda380('e', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 0, 'visa'))); -- pagamento zero: não entra
  perform pg_temp.venda380('x', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 999, 'visa')));
  perform cancelar_venda_proprio(L, 't380-x');                                              -- cancelada: não entra

  -- prévia (só leitura) antes de gerar: nada gravado
  assert (select count(*) from fin_receber_vendas_previa(L, D1, D1)) = 7, 'prévia: 7 formas';
  assert not exists (select 1 from fin_titulos_receber where loja_id = L), 'prévia não grava';

  -- ========== 4) 1ª geração, sem cadastro: taxa 0, prazo 0, "configurar"
  r := fin_receber_vendas_gerar(L, D1, D1, 'u-teste', 'Teste 380');
  assert (r->>'criados')::int = 7 and (r->>'atualizados')::int = 0, 'gera 7 títulos: ' || r;
  t := pg_temp.tit('credito');
  assert t.valor_bruto = 150 and t.quantidade = 2 and t.valor_taxa = 0 and t.valor_liquido = 150 and t.data_prevista = D1
         and t.configurar and t.categoria_id = v_cat and t.status = 'aberto', 'crédito sem cadastro';
  assert (pg_temp.tit('debito')).valor_bruto = 30, 'débito';
  assert (pg_temp.tit('voucher')).valor_bruto = 20, 'ticket = voucher';
  assert (pg_temp.tit('pix')).valor_bruto = 40 and (pg_temp.tit('dinheiro')).valor_bruto = 10, 'pix e dinheiro';
  assert (pg_temp.tit('app_entrega')).valor_bruto = 25 and (pg_temp.tit('outros')).valor_bruto = 5, 'app e outros';
  assert (select sum(valor_bruto) from fin_titulos_receber where loja_id = L) = 280, 'soma = vendas não canceladas';
  assert (select count(*) from fin_eventos where loja_id = L and entidade = 'titulo_receber' and tipo = 'gerado') = 7, '7 eventos';

  -- ========== 5) idempotente: rodar de novo não muda nada nem grava evento
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (r->>'criados')::int = 0 and (r->>'atualizados')::int = 0 and (r->>'iguais')::int = 7, 'segunda rodada igual: ' || r;
  assert (select count(*) from fin_titulos_receber where loja_id = L) = 7, 'sem duplicar';
  assert (select count(*) from fin_eventos where loja_id = L and entidade = 'titulo_receber') = 7, 'sem evento novo';

  -- ========== 6) cadastro das formas (validação) e reprecificação dos títulos em aberto
  r := fin_conta_salvar(L, null, jsonb_build_object('nome', 'Banco teste 380', 'tipo', 'banco', 'saldo_inicial', 1000,
         'data_saldo_inicial', '2026-10-01'), 'u-teste', 'Teste 380');
  v_conta := (r->>'id')::bigint;
  begin perform fin_forma_recebimento_salvar(L, 'cheque', '{}'); raise exception 'aceitou forma inválida';
  exception when sqlstate '22023' then null; end;
  begin perform fin_forma_recebimento_salvar(L, 'pix', '{"taxa_percentual":"100"}'); raise exception 'aceitou taxa de 100 por cento';
  exception when sqlstate '22023' then null; end;
  begin perform fin_forma_recebimento_salvar(L, 'pix', '{"taxa_percentual":"-1"}'); raise exception 'aceitou taxa negativa';
  exception when sqlstate '22023' then null; end;
  begin perform fin_forma_recebimento_salvar(L, 'pix', '{"taxa_fixa":"abc"}'); raise exception 'aceitou lixo';
  exception when sqlstate '22023' then null; end;
  begin perform fin_forma_recebimento_salvar(L, 'pix', '{"prazo_dias":"401"}'); raise exception 'aceitou prazo 401';
  exception when sqlstate '22023' then null; end;
  -- conta inexistente (a ODARA não tem conta corrente e não é escrita aqui):
  begin perform fin_forma_recebimento_salvar(L, 'pix', '{"conta_id":"999999999"}'); raise exception 'aceitou conta inexistente';
  exception when sqlstate '22023' then null; end;
  begin perform fin_forma_recebimento_salvar(2, 'pix', '{}'); raise exception 'aceitou cadastro em loja Omie';
  exception when sqlstate '22023' then null; end;

  r := fin_forma_recebimento_salvar(L, 'credito', jsonb_build_object('adquirente', 'Stone', 'taxa_percentual', '3.19',
         'taxa_fixa', '0.10', 'prazo_dias', '30', 'conta_id', v_conta), 'u-teste', 'Teste 380');
  assert (r->>'mudou')::boolean, 'cadastra crédito';
  assert (fin_forma_recebimento_salvar(L, 'credito', jsonb_build_object('adquirente', 'Stone', 'taxa_percentual', '3.19',
         'taxa_fixa', '0.10', 'prazo_dias', '30', 'conta_id', v_conta))->>'mudou')::boolean = false, 'mesmo cadastro: nada muda';
  perform fin_forma_recebimento_salvar(L, 'debito', jsonb_build_object('adquirente', 'Stone', 'taxa_percentual', '1.5',
         'prazo_dias', '1', 'dias_uteis', true, 'conta_id', v_conta));
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (r->>'atualizados')::int = 2 and (r->>'iguais')::int = 5, 'reprecifica só crédito e débito: ' || r;
  t := pg_temp.tit('credito');
  -- 150 × 3,19% = 4,785 + 2 × 0,10 = 4,985 → 4,99 (mesma conta do teste TS)
  assert t.valor_taxa = 4.99 and t.valor_liquido = 145.01 and t.data_prevista = D1 + 30 and t.adquirente = 'Stone'
         and t.conta_id = v_conta and not t.configurar, 'crédito com taxa: ' || row_to_json(t);
  t := pg_temp.tit('debito');
  assert t.valor_taxa = 0.45 and t.valor_liquido = 29.55 and t.data_prevista = '2026-11-02', 'débito D+1 útil (sexta → segunda)';
  assert (pg_temp.tit('pix')).configurar, 'pix segue "configurar"';

  -- ========== 7) cancelamento de venda muda o título em aberto; forma que zera é cancelada e volta como título novo
  perform cancelar_venda_proprio(L, 't380-a');            -- crédito 100
  perform cancelar_venda_proprio(L, 't380-b');            -- crédito 50 + pix 40 (único pix do dia)
  perform pg_temp.venda380('f', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 80, 'elo')));
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (r->>'atualizados')::int = 1 and (r->>'cancelados')::int = 1, 'crédito atualizado e pix cancelado: ' || r;
  t := pg_temp.tit('credito');
  assert t.valor_bruto = 80 and t.quantidade = 1 and t.valor_taxa = 2.65 and t.valor_liquido = 77.35, 'crédito depois do cancelamento';
  assert (pg_temp.tit('pix')).id is null, 'sem pix ativo';
  assert (select motivo_cancelamento from fin_titulos_receber where loja_id = L and forma = 'pix' and status = 'cancelado') is not null;
  perform pg_temp.venda380('g', D1, jsonb_build_array(pg_temp.pg380('PIX', 12)));
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (r->>'criados')::int = 1, 'pix volta como título novo';
  assert (select count(*) from fin_titulos_receber where loja_id = L and forma = 'pix') = 2, 'o cancelado fica';

  -- ========== 8) baixa: valor e data recebidos, diferença, extrato, idempotência
  t := pg_temp.tit('credito');
  begin perform fin_recebimento_registrar(L, t.id, '{}'::jsonb, null, null, null); raise exception 'baixa sem chave';
  exception when sqlstate '22023' then null; end;
  begin perform fin_recebimento_registrar(L, t.id, jsonb_build_object('valor_recebido', '0'), null, null, 'k0'); raise exception 'baixa zero';
  exception when sqlstate '22023' then null; end;
  begin perform fin_recebimento_registrar(L, t.id, jsonb_build_object('data_recebimento', fin_hoje() + 1), null, null, 'k1'); raise exception 'baixa futura';
  exception when sqlstate '22023' then null; end;
  begin perform fin_recebimento_registrar(L, t.id, jsonb_build_object('data_recebimento', D1 - 1), null, null, 'k2'); raise exception 'baixa antes da venda';
  exception when sqlstate '22023' then null; end;
  begin perform fin_recebimento_registrar(L, (pg_temp.tit('pix')).id, '{}'::jsonb, null, null, 'k3'); raise exception 'baixa sem conta';
  exception when sqlstate '22023' then null; end;

  r := fin_recebimento_registrar(L, t.id, jsonb_build_object('valor_recebido', '77.00', 'data_recebimento', '2026-11-02',
         'observacao', 'depósito Stone'), 'u-teste', 'Teste 380', 'baixa-1');
  assert (r->>'duplicado')::boolean = false and (r->>'diferenca')::numeric = -0.35, 'diferença recebido − previsto: ' || r;
  v_rec := (r->>'id')::bigint;
  t := pg_temp.tit('credito');
  assert t.status = 'recebido' and t.valor_recebido = 77 and t.data_recebimento = '2026-11-02' and t.diferenca = -0.35, 'título recebido';
  assert (select tipo = 'entrada' and valor = 77 and origem_tipo = 'recebimento' and origem_id = v_rec and conta_id = v_conta
            from fin_lancamentos where id = (r->>'lancamento_id')::bigint), 'entrada no extrato';
  r := fin_recebimento_registrar(L, t.id, jsonb_build_object('valor_recebido', '77.00', 'data_recebimento', '2026-11-02',
         'observacao', 'depósito Stone'), 'u-teste', 'Teste 380', 'baixa-1');
  assert (r->>'duplicado')::boolean and (r->>'id')::bigint = v_rec, 'mesma chave = mesma baixa';
  begin perform fin_recebimento_registrar(L, t.id, jsonb_build_object('valor_recebido', '70'), null, null, 'baixa-1'); raise exception 'chave com outros dados';
  exception when sqlstate '22023' then null; end;
  begin perform fin_recebimento_registrar(L, t.id, '{}'::jsonb, null, null, 'baixa-2'); raise exception 'baixou duas vezes';
  exception when sqlstate '22023' then null; end;
  begin update fin_recebimentos set valor_recebido = 1 where id = v_rec; raise exception 'recebimento editável';
  exception when sqlstate '55000' then null; end;
  begin delete from fin_recebimentos where id = v_rec; raise exception 'recebimento apagável';
  exception when sqlstate '55000' then null; end;

  -- ========== 9) venda que muda DEPOIS da baixa: o título não muda; um aviso por valor novo
  perform pg_temp.venda380('h', D1, jsonb_build_array(pg_temp.pg380('CREDIT', 20, 'visa')));
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (r->>'divergentes')::int = 1 and (r->>'atualizados')::int = 0, 'divergente: ' || r;
  assert (pg_temp.tit('credito')).valor_bruto = 80, 'título recebido não muda';
  perform fin_receber_vendas_gerar(L, D1, D1);
  assert (select count(*) from fin_eventos where loja_id = L and entidade = 'titulo_receber' and tipo = 'vendas_mudaram_apos_baixa') = 1,
    'um aviso só, mesmo rodando de novo';

  -- ========== 10) estorno da baixa: saída no extrato, título volta a aberto e a próxima geração atualiza
  begin perform fin_recebimento_estornar(L, v_rec, 'x'); raise exception 'estorno sem motivo';
  exception when sqlstate '22023' then null; end;
  r := fin_recebimento_estornar(L, v_rec, 'valor errado', 'u-teste', 'Teste 380');
  assert (r->>'status') = 'aberto', 'estornado';
  assert (fin_recebimento_estornar(L, v_rec, 'de novo')->>'duplicado')::boolean, 'estornar de novo = nada';
  t := pg_temp.tit('credito');
  assert t.status = 'aberto' and t.valor_recebido is null and t.diferenca is null, 'título aberto de novo';
  select (e->>'saldo_atual')::numeric into v_saldo from jsonb_array_elements(fin_contas_saldo(L)) e where (e->>'id')::bigint = v_conta;
  assert v_saldo = 1000, 'entrada e estorno se anulam no saldo: ' || v_saldo;
  r := fin_receber_vendas_gerar(L, D1, D1);
  assert (pg_temp.tit('credito')).valor_bruto = 100 and (pg_temp.tit('credito')).quantidade = 2, 'depois do estorno segue a venda';
  -- baixa de novo com outra conta (a conta do título é só a sugestão)
  r := fin_conta_salvar(L, null, jsonb_build_object('nome', 'Caixa teste 380', 'tipo', 'caixa', 'saldo_inicial', 0,
         'data_saldo_inicial', '2026-10-01'));
  v_conta_outra := (r->>'id')::bigint;
  r := fin_recebimento_registrar(L, (pg_temp.tit('credito')).id, jsonb_build_object('conta_id', v_conta_outra, 'data_recebimento', '2026-11-03'),
         null, null, 'baixa-3');
  assert (r->>'diferenca')::numeric = 0, 'vazio = recebe o líquido previsto';
  assert (select conta_id from fin_recebimentos where id = (r->>'id')::bigint) = v_conta_outra, 'baixa na conta escolhida';

  -- ========== 11) outro dia, outra forma; listagem com totais e filtros
  perform pg_temp.venda380('i', D2, jsonb_build_array(pg_temp.pg380('DEBIT', 60, 'visa')));
  r := fin_receber_vendas_gerar(L, D1, D2);
  assert (r->>'criados')::int = 1, 'débito do sábado';
  assert (pg_temp.tit('debito', D2)).data_prevista = '2026-11-02', 'sábado + 1 útil = segunda';
  r := fin_titulos_receber_listar(L, '{}'::jsonb, 50, 0, '2026-11-05');
  assert (r#>>'{totais,quantidade}')::int = 8, 'lista sem cancelados: ' || (r->'totais');
  assert (r#>>'{totais,bruto}')::numeric = (select sum(valor_bruto) from fin_titulos_receber where loja_id = L and status <> 'cancelado');
  assert (r#>>'{totais,recebido}')::numeric = (select valor_liquido from fin_titulos_receber where loja_id = L and status = 'recebido');
  r := fin_titulos_receber_listar(L, '{"situacao":"atrasado"}'::jsonb, 50, 0, '2026-11-05');
  -- atrasados em 05/11: em aberto com prevista antes de 05/11 (pix/dinheiro/voucher/app/outros de 30/10 e os 2 débitos de segunda 02/11)
  assert (r#>>'{totais,quantidade}')::int = 7, 'atrasados: ' || (r->'totais');
  r := fin_titulos_receber_listar(L, '{"situacao":"configurar"}'::jsonb, 50, 0, '2026-11-05');
  assert (r#>>'{totais,quantidade}')::int = 5, 'sem cadastro: ' || (r->'totais');
  r := fin_titulos_receber_listar(L, '{"forma":"debito","venda_de":"2026-10-31"}'::jsonb, 50, 0, '2026-11-05');
  assert jsonb_array_length(r->'itens') = 1, 'filtro por forma e data';
  r := fin_titulos_receber_listar(L, '{"situacao":"cancelado"}'::jsonb, 50, 0, '2026-11-05');
  assert (r#>>'{totais,quantidade}')::int = 1, 'o pix cancelado';

  -- ========== 12) isolamento: nada em outra loja
  assert not exists (select 1 from fin_titulos_receber where loja_id <> L), 'só a loja 19 tem títulos';
  assert not exists (select 1 from fin_formas_recebimento where loja_id <> L), 'só a loja 19 tem cadastro';

  -- ========== 13) DADOS REAIS (só leitura): prévia da ODARA fecha com as vendas dela
  select coalesce(sum(g.valor), 0) into v_bruto_real
    from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id = v.id
   where v.loja_id = 15 and v.data between '2026-10-01' and '2026-11-05' and not v.cancelado and not v.devolvido and g.valor > 0;
  select coalesce(sum(valor_bruto), 0) into v_previa from fin_receber_vendas_previa(15, '2026-10-01', '2026-11-05');
  assert v_previa = v_bruto_real and v_previa > 0, format('prévia ODARA %s = vendas %s', v_previa, v_bruto_real);
  for x in select forma, count(*) dias, sum(quantidade) pagamentos, sum(valor_bruto) bruto
             from fin_receber_vendas_previa(15, '2026-10-01', '2026-11-05') group by forma order by 4 desc loop
    raise notice 'ODARA out–05/nov (prévia, sem gravar): % → % dias, % pagamentos, R$ %', x.forma, x.dias, x.pagamentos, x.bruto;
  end loop;
  assert (select count(*) from fin_receber_vendas_previa(15, '2026-10-01', '2026-11-05')) =
         (select count(distinct (v.data, fin_cr_forma_do_pagamento(g.metodo, g.bandeira)))
            from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id = v.id
           where v.loja_id = 15 and v.data between '2026-10-01' and '2026-11-05' and not v.cancelado and not v.devolvido and g.valor > 0),
         'um título por dia × forma';
  assert not exists (select 1 from fin_titulos_receber where loja_id = 15), 'ODARA continua sem título';

  raise notice '380 CONTAS A RECEBER DAS VENDAS OK (prévia ODARA R$ %)', v_previa;
end $$;
