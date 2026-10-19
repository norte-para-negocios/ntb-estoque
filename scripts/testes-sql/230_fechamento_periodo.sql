-- Teste da migration 230 (fechamento de período). Banco LOCAL (bash scripts/testes-sql/230_preparar_banco.sh f1), nunca produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d f1 < scripts/testes-sql/230_fechamento_periodo.sql
-- Tudo em begin … rollback: nada fica gravado.
begin;
do $$
declare
  v_loja bigint; v_omie bigint; r jsonb; v_mes date; v_dia date; v_hoje date; v_mov bigint; v_comp bigint; v_item bigint;
  v_op bigint; v_inv bigint; v_it bigint; v_ped bigint; n int; e text;
begin
  v_hoje := (now() at time zone 'America/Bahia')::date;
  v_mes := (date_trunc('month', v_hoje) - interval '1 month')::date;   -- mês passado
  v_dia := v_mes + 14;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 230', '00000000000230', 'proprio') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 230 OMIE', '00000000000231', 'omie') returning id into v_omie;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (v_loja, 1, 'DEPOSITO', 'S');
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (v_loja, 501, 'P501', 'TOMATE', 'KG');

  -- 1. só fecha mês que já terminou
  begin perform fechar_periodo(v_loja, v_hoje, 'u1', 'Ana'); raise exception 'fechou o mês atual'; exception when sqlstate '22023' then null; end;
  begin perform fechar_periodo(v_loja, (v_hoje + 40), 'u1', 'Ana'); raise exception 'fechou mês futuro'; exception when sqlstate '22023' then null; end;

  -- preparação (antes de fechar): entrada no mês passado ligada a um item de nota lançado
  r := registrar_movimento(v_loja, 1, 501, 'ENT', 'COMPRA', 'teste230', 10, 5, 'u1', null, 1, null, null, v_dia);
  v_mov := (r->>'id')::bigint;
  insert into compras_proprio (loja_id, origem, numero, chave_acesso, status) values (v_loja, 'xml', '777', repeat('2', 44), 'lancada') returning id into v_comp;
  insert into compras_proprio_itens (compra_id, loja_id, linha, descricao, quantidade, valor_unitario, valor_total, fator, codigo_produto, lancado, movimento_id)
    values (v_comp, v_loja, 1, 'TOMATE', 10, 5, 50, 1, 501, true, v_mov) returning id into v_item;
  -- OP própria concluída no mês passado
  insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, concluida, dt_conclusao_real)
    values (v_loja, 501, v_dia, 1, true, v_dia) returning id into v_op;
  -- inventário com data no mês passado (já finalizado) e um item
  insert into inventarios (loja_id, codigo_local_estoque, data, status) values (v_loja, 1, (v_dia::timestamp + interval '12 hours') at time zone 'America/Bahia', 'Finalizado') returning id into v_inv;
  insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan, status) values (v_loja, v_inv, 501, 3, 'Concluido') returning id into v_it;
  -- pedido de compra criado no mês passado
  r := pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'HORTI', 'itens', '[{"codigo_produto":501,"quantidade":2,"preco_unitario":5}]'::jsonb), 'u1', 'Ana');
  v_ped := (r->>'id')::bigint;
  update pedidos_compra set created_at = v_dia::timestamp at time zone 'America/Bahia' where id = v_ped;
  -- pendência na loja Omie: ajuste manual do mês passado esperando reenvio
  insert into movimentos (loja_id, codigo_local_estoque, id_prod, data, tipo, status, tentativas, quan)
    values (v_omie, 1, 501, v_dia::timestamp at time zone 'America/Bahia', 'SAI', 'Erro', 2, 1);

  -- 2. fechar o mês passado (loja própria) e a 2ª vez é duplicado
  r := fechar_periodo(v_loja, v_mes, 'u1', 'Ana', 'enviado ao contador');
  if (r->>'ok')::boolean is not true or (r->>'duplicado')::boolean then raise exception 'fechar %', r; end if;
  r := fechar_periodo(v_loja, v_mes + 3, 'u1', 'Ana');
  if (r->>'duplicado')::boolean is not true then raise exception 'duplicado %', r; end if;
  if not periodo_fechado(v_loja, v_dia) or periodo_fechado(v_loja, v_hoje) then raise exception 'periodo_fechado errado'; end if;
  select count(*) into n from estoque_periodo_eventos where loja_id = v_loja and acao = 'fechar';
  if n <> 1 then raise exception 'eventos fechar: %', n; end if;

  -- 3. ledger: data no mês fechado recusa, hoje passa
  begin
    perform registrar_movimento(v_loja, 1, 501, 'AJU', 'INVENTARIO', 'teste230b', -1, null, 'u1', null, 0, null, null, v_dia);
    raise exception 'aceitou movimento no mês fechado';
  exception when sqlstate 'PF001' then
    get stacked diagnostics e = message_text;
    if e not like 'Período fechado:%Ana%' then raise exception 'mensagem: %', e; end if;
  end;
  perform registrar_movimento(v_loja, 1, 501, 'AJU', 'INVENTARIO', 'teste230c', -1, null, 'u1', null, 0, null, null, null);

  -- 4. estornar_compra de compra lançada em mês fechado falha com PF001 e não grava estorno
  begin perform estornar_compra(v_comp, 'u1'); raise exception 'estornou compra do mês fechado'; exception when sqlstate 'PF001' then null; end;
  select count(*) into n from estoque_movimentos where reverses_id = v_mov;
  if n <> 0 then raise exception 'estorno ficou gravado'; end if;
  if not (select lancado from compras_proprio_itens where id = v_item) then raise exception 'item perdeu lancado'; end if;
  -- mudar só a descrição do item passa
  update compras_proprio_itens set descricao = 'TOMATE ITALIANO' where id = v_item;

  -- 5. sefaz_marcar_cancelada em mês fechado não estorna e não falha
  r := sefaz_marcar_cancelada(v_loja, repeat('2', 44));
  if (r->>'mes_fechado')::boolean is not true or (r->>'estornada')::boolean then raise exception 'cancelada %', r; end if;
  select count(*) into n from compras_proprio_eventos where compra_id = v_comp and tipo = 'cancelada' and (detalhe->>'estorno_pendente')::boolean;
  if n <> 1 then raise exception 'evento cancelada_mes_fechado: %', n; end if;

  -- 6. OP própria concluída no mês fechado não reverte; OP nova com previsão no mês fechado recusa; hoje passa
  begin perform op_proprio_reverter(v_loja, v_op, 'Ana'); raise exception 'reverteu OP do mês fechado'; exception when sqlstate 'PF001' then null; end;
  begin
    insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde) values (v_loja, 501, v_dia, 1);
    raise exception 'criou OP no mês fechado';
  exception when sqlstate 'PF001' then null; end;
  insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde) values (v_loja, 501, v_hoje, 1);
  -- loja Omie: OP no mês passado (o sync grava) passa
  insert into ordens_producao (loja_id, identificacao_n_cod_produto, identificacao_d_dt_previsao, identificacao_n_qtde, concluida, dt_conclusao_real)
    values (v_omie, 501, v_dia, 1, true, v_dia);

  -- 7. inventário do mês fechado: item novo e contagem recusam; status do reenvio passa
  begin
    insert into inventario_items (loja_id, inventario_id, produto_codigo_produto, quan) values (v_loja, v_inv, 502, 1);
    raise exception 'item novo em inventário do mês fechado';
  exception when sqlstate 'PF001' then null; end;
  begin update inventario_items set quan = 4 where id = v_it; raise exception 'mudou contagem'; exception when sqlstate 'PF001' then null; end;
  update inventario_items set status = 'Concluido', descricao_status = 'ok', quan = 3 where id = v_it;
  begin delete from inventarios where id = v_inv; raise exception 'apagou inventário'; exception when sqlstate 'PF001' then null; end;
  begin
    insert into inventarios (loja_id, codigo_local_estoque, data) values (v_loja, 1, v_dia::timestamp at time zone 'America/Bahia');
    raise exception 'criou inventário no mês fechado';
  exception when sqlstate 'PF001' then null; end;

  -- 8. pedido criado no mês fechado: conteúdo não muda, etapa muda; previsão no mês fechado recusa
  begin
    perform pc_salvar(v_loja, jsonb_build_object('id', v_ped, 'fornecedor_nome', 'HORTI 2', 'itens', '[{"codigo_produto":501,"quantidade":3,"preco_unitario":5}]'::jsonb), 'u1', 'Ana');
    raise exception 'editou pedido do mês fechado';
  exception when sqlstate 'PF001' then null; end;
  perform pc_acao(v_loja, v_ped, 'enviar', 'u1', 'Ana');
  begin
    perform pc_salvar(v_loja, jsonb_build_object('fornecedor_nome', 'X', 'previsao_entrega', v_dia, 'itens', '[{"codigo_produto":501,"quantidade":1}]'::jsonb), 'u1', 'Ana');
    raise exception 'previsão no mês fechado';
  exception when sqlstate 'PF001' then null; end;

  -- 9. correção de custo (loja Omie) com data do ajuste em mês fechado recusa
  r := fechar_periodo(v_omie, v_mes, 'u1', 'Ana');
  if (r->>'ok')::boolean or jsonb_array_length(r->'pendencias') <> 1 or r->'pendencias'->0->>'tipo' <> 'ajuste_omie' then raise exception 'pendência %', r; end if;
  if exists (select 1 from estoque_periodo_fechado where loja_id = v_omie) then raise exception 'fechou com pendência'; end if;
  r := fechar_periodo(v_omie, v_mes, 'u1', 'Ana', null, true);
  if (r->>'ok')::boolean is not true then raise exception 'fechar aceitando pendência %', r; end if;
  if jsonb_array_length((select pendencias from estoque_periodo_eventos where loja_id = v_omie order by id desc limit 1)) <> 1 then raise exception 'pendência não gravada'; end if;
  begin
    insert into estoque_correcao_custo (loja_id, movimento_id, id_ajuste_antigo, id_prod, codigo_local_estoque, tipo, quantidade, data_ajuste, custo_novo, status)
      values (v_omie, 1, 1, 501, 1, 'ENT', 1, v_dia, 2, 'excluindo');
    raise exception 'correção de custo no mês fechado';
  exception when sqlstate 'PF001' then null; end;
  insert into estoque_correcao_custo (loja_id, movimento_id, id_ajuste_antigo, id_prod, codigo_local_estoque, tipo, quantidade, data_ajuste, custo_novo, status)
    values (v_omie, 1, 2, 501, 1, 'ENT', 1, v_hoje, 2, 'excluindo');

  -- 10. reabrir: sem motivo recusa; com motivo libera e registra
  begin perform reabrir_periodo(v_loja, v_mes, 'u2', 'Dono', 'curto'); raise exception 'reabriu sem motivo'; exception when sqlstate '22023' then null; end;
  begin perform reabrir_periodo(v_loja, v_mes - 31, 'u2', 'Dono', 'motivo bem explicado'); raise exception 'reabriu mês aberto'; exception when sqlstate '22023' then null; end;
  perform reabrir_periodo(v_loja, v_mes, 'u2', 'Dono', 'contador pediu correção do inventário');
  perform registrar_movimento(v_loja, 1, 501, 'AJU', 'INVENTARIO', 'teste230d', -1, null, 'u1', null, 0, null, null, v_dia);
  select count(*) into n from estoque_periodo_eventos where loja_id = v_loja and acao = 'reabrir' and user_nome = 'Dono';
  if n <> 1 then raise exception 'evento reabrir: %', n; end if;
  begin update estoque_periodo_eventos set motivo = 'x' where loja_id = v_loja; raise exception 'evento editável'; exception when sqlstate '55000' then null; end;

  raise notice '230: todos os testes passaram';
end $$;

-- RLS: usuário comum não lê o fechamento de loja alheia e anon não lê nada
do $$ begin
  if has_table_privilege('anon', 'public.estoque_periodo_fechado', 'select') then raise exception 'anon lê estoque_periodo_fechado'; end if;
  if has_table_privilege('authenticated', 'public.estoque_periodo_fechado', 'insert') then raise exception 'authenticated escreve'; end if;
  if has_function_privilege('authenticated', 'public.fechar_periodo(bigint,date,text,text,text,boolean)', 'execute') then raise exception 'authenticated fecha'; end if;
  if (select count(*) from pg_proc where proname in ('fechar_periodo', 'reabrir_periodo', '_exigir_periodo_aberto', 'periodo_pendencias', 'sefaz_marcar_cancelada')) <> 5 then
    raise exception 'overload a mais';
  end if;
  raise notice '230: grants ok';
end $$;

-- A trava vale também quando quem escreve é o service_role (o servidor), não só o dono das funções
insert into lojas (nome, cnpj, modo_estoque) values ('T230R', '00000000000239', 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao) select id, 1, 'D' from lojas where nome = 'T230R';
select (fechar_periodo((select id from lojas where nome = 'T230R'), (date_trunc('month', now()) - interval '2 month')::date, 'u', 'Ana')->>'ok') as fechou,
       set_config('t230.loja', (select id from lojas where nome = 'T230R')::text, true);
set local role service_role;
do $$ begin
  perform registrar_movimento(current_setting('t230.loja')::bigint, 1, 9, 'ENT', 'X', 'r', 1, 1, null, null, 0, null, null,
                              (date_trunc('month', now()) - interval '2 month')::date + 3);
  raise exception 'service_role escreveu no mês fechado';
exception when sqlstate 'PF001' then raise notice '230: service_role travado ok';
end $$;
reset role;
rollback;
