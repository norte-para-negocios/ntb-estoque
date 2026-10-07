-- Teste da OP no estoque próprio (migration 136). Roda dentro de BEGIN ... ROLLBACK.
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99020, '00000000099020', 'TESTE OP', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99020, 8000000002901, 'Geral', 'S'), (99020, 8000000002902, 'Cozinha', 'N');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99020, 8000000002801, '70001', 'Molho', 'ML', '03'), (99020, 8000000002802, '80001', 'Tomate', 'G', '01'),
  (99020, 8000000002803, '80002', 'Cebola', 'G', '01');
do $$
declare r jsonb; v_id bigint; s numeric; n int; m1 jsonb; m2 jsonb;
begin
  perform registrar_movimento(99020, 8000000002901, 8000000002802, 'ENT', 'T', 'e1', 10000, 0.01);
  perform registrar_movimento(99020, 8000000002901, 8000000002803, 'ENT', 'T', 'e2', 5000, 0.02);
  -- ficha: 1000 ml de molho = 1500 g tomate (FC 1.5 sobre 1000) + 200 g cebola
  perform salvar_ficha(99020, 8000000002801, 1000, '[{"codigo_insumo":8000000002802,"quantidade_liquida":1000,"fator_correcao":1.5},{"codigo_insumo":8000000002803,"quantidade_liquida":200}]'::jsonb);

  -- cria OP (sem mexer em estoque)
  r := op_proprio_criar(99020, 8000000002801, current_date, 2000, null, null, current_date + 5, 'teste', 'joao');
  v_id := (r->>'id')::bigint;
  assert (r->>'num_op') ~ '^\d{4}/00001$', 'numero da OP ' || r;
  assert (select jsonb_array_length(full_object->'itensDetalhes') from ordens_producao where id=v_id) = 2, 'ingredientes previstos';
  assert ((select full_object->'itensDetalhes'->0->>'nQtde' from ordens_producao where id=v_id))::numeric = 3000, 'qtde prevista do 1o insumo (2000 ml x 1.5)';
  perform op_proprio_alterar(99020, v_id, current_date + 1, 4000, 'maria');
  assert (select identificacao_n_qtde from ordens_producao where id=v_id) = 4000, 'qtde planejada alterada';
  assert ((select full_object->'itensDetalhes'->0->>'nQtde' from ordens_producao where id=v_id))::numeric = 6000, 'ingredientes refeitos';
  perform op_proprio_alterar(99020, v_id, null, 2000, 'maria');
  assert (select criada_por from ordens_producao where id=v_id) = 'joao', 'criada_por';
  assert (select ficha_versao from ordens_producao where id=v_id) = 1, 'ficha usada na criacao';
  assert (select count(*) from op_historico where op_id=v_id and evento='alterada' and user_nome='maria') = 2, 'historico das alteracoes';
  assert (r->>'n_cod_op')::bigint >= 8000000000001, 'id proprio';
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002802 and codigo_local_estoque=8000000002901;
  assert s = 10000, 'criar OP nao mexe no estoque';
  assert (select concluida from ordens_producao where id=v_id) = false, 'OP aberta';
  assert (select identificacao_codigo_local_estoque from ordens_producao where id=v_id) = 8000000002901, 'local padrao';
  -- segunda OP: numeração sequencial
  r := op_proprio_criar(99020, 8000000002801, current_date, 500);
  assert (r->>'num_op') ~ '/00002$', 'numero sequencial ' || r;

  assert (select qtde_planejada from op_qtde_planejada where loja_id=99020 and n_cod_op=(select identificacao_n_cod_op from ordens_producao where id=v_id)) = 2000, 'planejado capturado';
  -- conclui (parcial: 1000 ml em vez de 2000)
  r := op_proprio_concluir(99020, v_id, current_date, 1000, 'joao', null);
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002802 and codigo_local_estoque=8000000002901;
  assert s = 10000 - 1500, 'tomate consumido com FC ' || s;
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002801 and codigo_local_estoque=8000000002901;
  assert s = 1000, 'molho produzido (parcial) ' || s;
  assert (select concluida from ordens_producao where id=v_id), 'OP concluida';
  assert (select identificacao_n_qtde from ordens_producao where id=v_id) = 1000, 'qtde produzida gravada';
  assert (select concluida_por_nome from ordens_producao where id=v_id) = 'joao', 'quem concluiu';
  assert (select ficha_versao from ordens_producao where id=v_id) = 1, 'versao da ficha';
  assert (select custo_total from ordens_producao where id=v_id) = 19, 'custo total da OP ' || (select custo_total from ordens_producao where id=v_id);
  assert (select custo_unitario from ordens_producao where id=v_id) = 0.019, 'custo unitario da OP';
  r := op_proprio_detalhe(99020, v_id);
  assert jsonb_array_length(r->'execucoes') = 1, 'uma execucao';
  assert jsonb_array_length(r->'execucoes'->0->'insumos') = 2, 'insumos consumidos';
  assert jsonb_array_length(r->'execucoes'->0->'movimentos') = 3, 'movimentos do ledger (2 insumos + produto)';
  assert (r->'execucoes'->0->'insumos'->0->>'quantidade_bruta')::numeric = 1500, 'bruto do 1o insumo (FC 1.5)';
  assert (r->'ficha'->>'versao')::int = 1 and jsonb_array_length(r->'ficha'->'itens') = 2, 'receita usada';
  assert (select count(*) from jsonb_array_elements(r->'historico')) = 4, 'historico: criada, 2 alteradas, concluida';
  -- custo do intermediário = (1500*0.01 + 200*0.02)/1000 = 0.019
  assert (select cmc from estoque_custos where loja_id=99020 and codigo_produto=8000000002801) = 0.019, 'custo do molho';
  -- não conclui duas vezes
  begin perform op_proprio_concluir(99020, v_id); assert false, 'dupla conclusao'; exception when sqlstate '22023' then null; end;
  begin perform op_proprio_alterar(99020, v_id, null, 5); assert false, 'alterar concluida'; exception when sqlstate '22023' then null; end;

  assert (select divergencia from relatorio_op_previsto_produzido(99020, current_date - 1, current_date + 1) where n_cod_op=(select identificacao_n_cod_op from ordens_producao where id=v_id)) = -1000, 'previsto x produzido';
  -- reverte: tudo volta
  perform op_proprio_reverter(99020, v_id, 'joao');
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002802 and codigo_local_estoque=8000000002901;
  assert s = 10000, 'tomate de volta ' || s;
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002801 and codigo_local_estoque=8000000002901;
  assert s = 0, 'molho estornado ' || s;
  assert not (select concluida from ordens_producao where id=v_id), 'OP reaberta';
  assert (select revertida_por from ordens_producao where id=v_id) = 'joao' and (select revertida_em from ordens_producao where id=v_id) is not null, 'quem e quando reverteu';
  assert (select custo_total from ordens_producao where id=v_id) is null, 'custo zerado ao reverter';
  r := op_proprio_detalhe(99020, v_id);
  assert (r->'execucoes'->0->>'status') = 'revertida', 'execucao marcada revertida';
  assert (select bool_and((m->>'estornado')::boolean) from jsonb_array_elements(r->'execucoes'->0->'movimentos') m), 'movimentos estornados';
  begin perform op_proprio_reverter(99020, v_id); assert false, 'reverter aberta'; exception when sqlstate '22023' then null; end;

  -- conclui de novo (nova ref) com a quantidade planejada, destino diferente
  update ordens_producao set local_destino = 8000000002902 where id=v_id;
  r := op_proprio_concluir(99020, v_id, current_date, 2000, 'joao', null);
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002801 and codigo_local_estoque=8000000002902;
  assert s = 2000, 'molho no local de destino ' || s;
  assert (select producao_n from ordens_producao where id=v_id) = 2, 'segunda conclusao';

  -- excluir OP concluída: reverte e apaga
  perform op_proprio_excluir(99020, v_id, 'joao');
  assert not exists (select 1 from ordens_producao where id=v_id), 'OP excluida';
  assert (select count(*) from op_historico where op_id=v_id and evento='excluida') = 1, 'trilha da exclusao fica';
  begin update op_historico set evento='criada' where op_id=v_id; assert false, 'historico imutavel'; exception when sqlstate '55000' then null; end;
  select saldo into s from estoque_saldos where loja_id=99020 and codigo_produto=8000000002802 and codigo_local_estoque=8000000002901;
  assert s = 10000, 'tomate de volta apos excluir ' || s;

  -- loja omie recusa
  begin perform op_proprio_criar(2, 1, current_date, 1); assert false, 'omie recusa'; exception when sqlstate '22023' then null; end;
  -- OP sem ficha não conclui
  r := op_proprio_criar(99020, 8000000002802, current_date, 10);
  begin perform op_proprio_concluir(99020, (r->>'id')::bigint); assert false, 'sem ficha'; exception when sqlstate '22023' then null; end;
  raise notice 'OP PROPRIO OK';
end $$;
