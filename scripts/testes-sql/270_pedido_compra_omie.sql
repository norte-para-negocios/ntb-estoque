-- Teste da migration 270 (C1: pedido de compra do NTB gravado no Omie). Cópia local (c2 = fb + 187, 188, 190–195, 200, 201,
-- 240–242; depois a 270). Nunca em produção. Nenhuma chamada ao Omie (só banco).
-- Uso: docker exec ntb-teste-sql psql -U postgres -c "create database c1 template c2"
--      docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c1 < supabase/migrations/270_pedido_compra_omie.sql
--      docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d c1 < scripts/testes-sql/270_pedido_compra_omie.sql
begin;
do $$
declare v_prop bigint; v_omie bigint; v_omie_off bigint; v_ped bigint; v_ped2 bigint; v_prop_ped bigint; r jsonb; n int; s text;
begin
  -- 0. padrão desligado: colunas novas existem e nenhuma loja (as já existentes) ficou liberada
  if exists (select 1 from lojas where omie_gravar_pedidos_compra) then raise exception 'alguma loja nasceu liberada'; end if;
  if exists (select 1 from lojas where omie_pedido_categoria is not null or omie_pedido_email_aprovador is not null) then raise exception 'config preenchida'; end if;

  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 270 PROPRIA', '00000000000270', 'proprio') returning id into v_prop;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 270 OMIE', '00000000000271', 'omie') returning id into v_omie;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 270 OMIE SEM OPT-IN', '00000000000272', 'omie') returning id into v_omie_off;
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values
    (v_prop, 7001, 'P7001', 'TOMATE', 'KG'), (v_omie, 3155667788, 'AZ500', 'AZEITE 500ML', 'UN'), (v_omie_off, 3155667788, 'AZ500', 'AZEITE 500ML', 'UN');

  -- 1. loja própria: igual à 200 (cria, aprova, cancela); nunca tem linha na fila do Omie
  r := pc_salvar(v_prop, '{"fornecedor_nome":"HORTI","itens":[{"codigo_produto":7001,"quantidade":2,"preco_unitario":5}]}'::jsonb);
  v_prop_ped := (r->>'id')::bigint;
  perform pc_acao(v_prop, v_prop_ped, 'aprovar');
  perform pc_acao(v_prop, v_prop_ped, 'cancelar', null, null, 'teste');
  begin perform pc_omie_enfileirar(v_prop, v_prop_ped); raise exception 'loja própria entrou na fila do Omie'; exception when sqlstate '22023' then null; end;
  if exists (select 1 from pedidos_compra_omie where loja_id = v_prop) then raise exception 'linha da fila na loja própria'; end if;

  -- 2. loja Omie SEM opt-in: exatamente como antes (pedido recusado, mesma mensagem da 200)
  begin
    perform pc_salvar(v_omie_off, '{"fornecedor_nome":"F","itens":[{"codigo_produto":3155667788,"quantidade":1}]}'::jsonb);
    raise exception 'loja omie sem opt-in criou pedido';
  exception when sqlstate '22023' then
    get stacked diagnostics s = message_text;
    if s not like '%não usa estoque próprio: pedido de compra local só existe no estoque próprio' then raise exception 'mensagem mudou: %', s; end if;
  end;
  begin perform comp_salvar(v_omie_off, '{"nome":"X"}'::jsonb); raise exception 'loja omie sem opt-in criou comprador'; exception when sqlstate '22023' then null; end;

  -- 3. loja 4 nunca, mesmo com opt-in: o CHECK lojas_omie_pedido_compra_nunca_loja4 nem deixa ligar (teste no passo 8c)

  -- 4. loja Omie COM opt-in: cria, enfileira só aprovado, fila idempotente
  update lojas set omie_gravar_pedidos_compra = true where id = v_omie;
  r := pc_salvar(v_omie, '{"fornecedor_nome":"DISTRIB","previsao_entrega":"2026-10-27","itens":[{"codigo_produto":3155667788,"quantidade":12,"preco_unitario":29.95}]}'::jsonb);
  v_ped := (r->>'id')::bigint;
  begin perform pc_omie_enfileirar(v_omie, v_ped); raise exception 'rascunho entrou na fila'; exception when sqlstate '22023' then null; end;
  perform pc_acao(v_omie, v_ped, 'aprovar');
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'pendente' or r->>'cod_int' <> 'NTB-PC-' || v_ped then raise exception 'fila: %', r; end if;
  r := pc_omie_enfileirar(v_omie, v_ped);   -- 2ª vez: mesma linha
  select count(*) into n from pedidos_compra_omie where pedido_id = v_ped;
  if n <> 1 then raise exception 'linha duplicada na fila'; end if;
  begin perform pc_omie_enfileirar(v_omie_off, v_ped); raise exception 'enfileirou em loja sem opt-in'; exception when sqlstate '22023' then null; end;

  -- 5. precisa_corrigir: enfileirar de novo SEM nova aprovação não zera o teto (revisão I3)
  update pedidos_compra_omie set status = 'precisa_corrigir', tentativas = 3, ultimo_erro = 'Produto não cadastrado',
         ultima_tentativa_em = now() + interval '1 second' where pedido_id = v_ped;
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'precisa_corrigir' or (select tentativas from pedidos_compra_omie where pedido_id = v_ped) <> 3 then raise exception 'zerou sem aprovar de novo: %', r; end if;
  -- reabrir (pendente/precisa_corrigir certo) funciona; aprovar de novo depois da última tentativa zera e volta para pendente
  update pedidos_compra_omie set ultima_tentativa_em = now() - interval '1 minute' where pedido_id = v_ped;
  perform pc_acao(v_omie, v_ped, 'reabrir');
  perform pc_acao(v_omie, v_ped, 'aprovar');
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'pendente' or (select tentativas from pedidos_compra_omie where pedido_id = v_ped) <> 0 then raise exception 'reenfileirar: %', r; end if;

  -- 5b. incerto (inclusão sem resposta): não reabre nem cancela, e nem nova aprovação zera (revisão I2)
  update pedidos_compra_omie set incerto = true, tentativas = 1 where pedido_id = v_ped;
  begin
    perform pc_acao(v_omie, v_ped, 'cancelar', null, null, 'x'); raise exception 'cancelou pedido incerto';
  exception when sqlstate '22023' then
    get stacked diagnostics s = message_text;
    if s not like '%Conferir no Omie%' then raise exception 'mensagem do incerto: %', s; end if;
  end;
  begin perform pc_acao(v_omie, v_ped, 'reabrir'); raise exception 'reabriu pedido incerto'; exception when sqlstate '22023' then null; end;
  update pedidos_compra_omie set status = 'precisa_corrigir', ultima_tentativa_em = now() - interval '1 hour' where pedido_id = v_ped;
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'precisa_corrigir' then raise exception 'incerto voltou para a fila: %', r; end if;

  -- 5c. pc_omie_reivindicar: 'conferir' só no precisa_corrigir incerto, 1 vez a cada 10 min; 'enviar' não pega
  if (pc_omie_reivindicar(v_omie, v_ped, 'enviar')->>'ok')::boolean then raise exception 'enviar pegou precisa_corrigir'; end if;
  r := pc_omie_reivindicar(v_omie, v_ped, 'conferir');
  if not (r->>'ok')::boolean or r->>'status_antes' <> 'precisa_corrigir' or not (r->>'incerto')::boolean then raise exception 'conferir: %', r; end if;
  update pedidos_compra_omie set status = 'precisa_corrigir' where pedido_id = v_ped;   -- (o TS devolve assim depois de consultar)
  if (pc_omie_reivindicar(v_omie, v_ped, 'conferir')->>'ok')::boolean then raise exception 'conferir antes de 10 min'; end if;
  begin perform pc_omie_reivindicar(v_omie, v_ped, 'qualquer'); raise exception 'modo inválido aceito'; exception when sqlstate '22023' then null; end;
  -- conferido: não está no Omie → incerto some → reabrir volta a funcionar e a nova aprovação zera
  update pedidos_compra_omie set incerto = false, ultima_tentativa_em = now() - interval '1 minute' where pedido_id = v_ped;
  perform pc_acao(v_omie, v_ped, 'reabrir');
  if (pc_omie_reivindicar(v_omie, v_ped, 'enviar')->>'ok')::boolean then raise exception 'reivindicou pedido em rascunho'; end if;
  perform pc_acao(v_omie, v_ped, 'aprovar');
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'pendente' then raise exception 'reaprovar depois de conferir: %', r; end if;

  -- 5d. 'enviar': pendente na hora = ok uma vez (vira enviando); de novo = não; próxima tentativa no futuro = não
  r := pc_omie_reivindicar(v_omie, v_ped, 'enviar');
  if not (r->>'ok')::boolean or r->>'cod_int' <> 'NTB-PC-' || v_ped then raise exception 'reivindicar: %', r; end if;
  if (pc_omie_reivindicar(v_omie, v_ped, 'enviar')->>'ok')::boolean then raise exception 'reivindicou duas vezes'; end if;
  update pedidos_compra_omie set status = 'pendente', proxima_tentativa_em = now() + interval '20 minutes' where pedido_id = v_ped;
  if (pc_omie_reivindicar(v_omie, v_ped, 'enviar')->>'ok')::boolean then raise exception 'pulou a espera'; end if;
  update pedidos_compra_omie set status = 'enviando', ultima_tentativa_em = now() - interval '2 hours' where pedido_id = v_ped;
  r := pc_omie_reivindicar(v_omie, v_ped, 'enviar');
  if not (r->>'ok')::boolean or r->>'status_antes' <> 'enviando' then raise exception 'retomar enviando esquecido: %', r; end if;
  update pedidos_compra_omie set status = 'pendente', proxima_tentativa_em = null where pedido_id = v_ped;

  -- 6. enviando/enviado: não reabre nem cancela pelo NTB (gatilho); enfileirar de novo não mexe no enviado
  update pedidos_compra_omie set status = 'enviando' where pedido_id = v_ped;
  begin perform pc_acao(v_omie, v_ped, 'cancelar', null, null, 'x'); raise exception 'cancelou durante o envio'; exception when sqlstate '22023' then null; end;
  update pedidos_compra_omie set status = 'enviado', n_cod_ped = 9988776655, numero_omie = '000123' where pedido_id = v_ped;
  begin
    perform pc_acao(v_omie, v_ped, 'reabrir'); raise exception 'reabriu pedido enviado';
  exception when sqlstate '22023' then
    get stacked diagnostics s = message_text;
    if s not like '%nº 000123%' then raise exception 'mensagem do gatilho: %', s; end if;
  end;
  r := pc_omie_enfileirar(v_omie, v_ped);
  if r->>'status' <> 'enviado' then raise exception 'enfileirar mexeu no enviado'; end if;
  if (select etapa from pedidos_compra where id = v_ped) <> 'aprovado' then raise exception 'etapa mudou'; end if;

  -- 7. nCodPed único por loja; código de integração no formato
  r := pc_salvar(v_omie, '{"fornecedor_nome":"DISTRIB","previsao_entrega":"2026-10-28","itens":[{"codigo_produto":3155667788,"quantidade":1}]}'::jsonb);
  v_ped2 := (r->>'id')::bigint;
  perform pc_acao(v_omie, v_ped2, 'aprovar');
  perform pc_omie_enfileirar(v_omie, v_ped2);
  begin update pedidos_compra_omie set n_cod_ped = 9988776655 where pedido_id = v_ped2; raise exception 'nCodPed repetido'; exception when unique_violation then null; end;
  begin insert into pedidos_compra_omie (pedido_id, loja_id, cod_int) values (v_prop_ped, v_prop, 'OUTRO-1'); raise exception 'cod_int fora do formato'; exception when check_violation then null; end;

  -- 8. loja própria continua cancelando/reabrindo sem passar pelo Omie (gatilho só olha a fila)
  r := pc_salvar(v_prop, '{"fornecedor_nome":"HORTI","itens":[{"codigo_produto":7001,"quantidade":1}]}'::jsonb);
  perform pc_acao(v_prop, (r->>'id')::bigint, 'aprovar');
  perform pc_acao(v_prop, (r->>'id')::bigint, 'reabrir');

  -- 8b. sessão não lê o payload (pode ter o e-mail do aprovador); lê o resto
  if has_column_privilege('authenticated', 'public.pedidos_compra_omie', 'payload', 'select') then raise exception 'authenticated lê payload'; end if;
  if not has_column_privilege('authenticated', 'public.pedidos_compra_omie', 'incerto', 'select') then raise exception 'authenticated não lê incerto'; end if;

  -- 8c. loja 4 nunca liga a gravação (CHECK)
  if exists (select 1 from lojas where id = 4) then
    begin update lojas set omie_gravar_pedidos_compra = true where id = 4; raise exception 'loja 4 ligou'; exception when check_violation then null; end;
  end if;

  -- 9. categoria com formato do Omie
  begin update lojas set omie_pedido_categoria = 'Compras' where id = v_omie; raise exception 'categoria inválida aceita'; exception when check_violation then null; end;
  update lojas set omie_pedido_categoria = '2.01.01' where id = v_omie;

  raise notice '270_pedido_compra_omie: OK';
end $$;
rollback;
