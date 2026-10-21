-- Teste das migrations 285 + 286 (financeiro, etapa 1). Só em cópia local (container ntb-teste-sql). Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fin1 < scripts/testes-sql/286_financeiro_contas_pagar.sql
-- Roda numa transação e desfaz tudo no fim (rollback).
begin;
do $$
declare
  v_loja bigint; v_omie bigint; v_forn bigint; v_inativo bigint; v_conta bigint; v_conta2 bigint; v_cat bigint;
  r jsonb; t bigint; p1 bigint; p2 bigint; s jsonb; x record; v_hoje date := fin_hoje();
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE FIN', '00000000000901', 'proprio') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE FIN OMIE', '00000000000902', 'omie') returning id into v_omie;
  insert into fornecedores (loja_id, razao_social) values (v_loja, 'ATACADO LTDA') returning id into v_forn;
  insert into fornecedores (loja_id, razao_social, inativo) values (v_loja, 'FECHADO LTDA', true) returning id into v_inativo;

  -- loja Omie: nada de financeiro
  begin perform fin_conta_salvar(v_omie, null, '{"nome":"Caixa"}'::jsonb); raise exception 'loja omie criou conta';
  exception when sqlstate '22023' then null; end;

  -- categorias padrão (semear é idempotente)
  if fin_categorias_semear(v_loja) <> 17 then raise exception 'semear 1ª vez'; end if;
  if fin_categorias_semear(v_loja) <> 0 then raise exception 'semear 2ª vez deveria ser 0'; end if;
  select id into v_cat from fin_categorias where loja_id = v_loja and nome = 'Aluguel e condomínio';
  r := fin_categoria_salvar(v_loja, null, '{"nome":"Gás de cozinha","tipo":"despesa","grupo_dre":"despesa_operacional"}'::jsonb);
  begin perform fin_categoria_salvar(v_loja, null, '{"nome":"gás de cozinha"}'::jsonb); raise exception 'nome duplicado aceito';
  exception when sqlstate '22023' then null; end;
  begin perform fin_categoria_salvar(v_loja, null, '{"nome":"X1","grupo_dre":"inventado"}'::jsonb); raise exception 'grupo inválido aceito';
  exception when sqlstate '22023' then null; end;

  -- contas correntes e saldo inicial
  r := fin_conta_salvar(v_loja, null, jsonb_build_object('nome', 'Caixa da loja', 'tipo', 'caixa', 'saldo_inicial', 1000, 'data_saldo_inicial', v_hoje - 30));
  v_conta := (r->>'id')::bigint;
  r := fin_conta_salvar(v_loja, null, jsonb_build_object('nome', 'Banco principal', 'tipo', 'banco', 'saldo_inicial', 5000.555, 'data_saldo_inicial', v_hoje - 30));
  v_conta2 := (r->>'id')::bigint;
  if (select saldo_inicial from fin_contas_correntes where id = v_conta2) <> 5000.56 then raise exception 'arredondamento do saldo inicial'; end if;
  begin perform fin_conta_salvar(v_loja, null, '{"nome":"caixa da loja"}'::jsonb); raise exception 'conta duplicada';
  exception when sqlstate '22023' then null; end;

  -- título: validações
  begin perform fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 0, 'data_vencimento', v_hoje)); raise exception 'valor 0';
  exception when sqlstate '22023' then null; end;
  begin perform fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_inativo, 'valor', 10, 'data_vencimento', v_hoje)); raise exception 'fornecedor inativo';
  exception when sqlstate '22023' then null; end;
  begin perform fin_titulo_pagar_salvar(v_omie, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 10, 'data_vencimento', v_hoje)); raise exception 'loja omie';
  exception when sqlstate '22023' then null; end;

  -- incluir + idempotência por chave
  r := fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 300, 'data_vencimento', v_hoje + 5, 'categoria_id', v_cat,
        'documento', 'NF 10', 'data_competencia', to_char(v_hoje, 'YYYY-MM')), 'u1', 'Ana', 'k-t1');
  t := (r->>'id')::bigint;
  if (r->>'numero')::int <> 1 then raise exception 'numero %', r; end if;
  r := fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 999, 'data_vencimento', v_hoje), 'u1', 'Ana', 'k-t1');
  if (r->>'duplicado')::boolean is not true or (r->>'id')::bigint <> t then raise exception 'idempotência do título %', r; end if;
  if (select data_competencia from fin_titulos_pagar where id = t) <> date_trunc('month', v_hoje)::date then raise exception 'competência'; end if;

  -- situação derivada
  if fin_situacao_titulo('aberto', v_hoje, v_hoje) <> 'aberto' then raise exception 'vence hoje não é atrasado'; end if;
  if fin_situacao_titulo('aberto', v_hoje - 1, v_hoje) <> 'atrasado' then raise exception 'atrasado'; end if;
  if fin_situacao_titulo('parcial', v_hoje - 1, v_hoje) <> 'atrasado' then raise exception 'parcial atrasado'; end if;
  if fin_situacao_titulo('pago', v_hoje - 10, v_hoje) <> 'pago' then raise exception 'pago nunca atrasa'; end if;
  if fin_situacao_titulo('cancelado', v_hoje - 10, v_hoje) <> 'cancelado' then raise exception 'cancelado'; end if;

  -- pagamento: validações
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta), 'u1', 'Ana', null); raise exception 'sem chave';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'valor_principal', 300.01), 'u1', 'Ana', 'k-a'); raise exception 'passou do saldo';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'valor_principal', 100, 'desconto', 100.01), 'u1', 'Ana', 'k-a'); raise exception 'desconto > principal';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'valor_principal', 100, 'desconto', 100), 'u1', 'Ana', 'k-a'); raise exception 'valor pago zero';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'data_pagamento', v_hoje + 1), 'u1', 'Ana', 'k-a'); raise exception 'data futura';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'data_pagamento', v_hoje - 31), 'u1', 'Ana', 'k-a'); raise exception 'antes do saldo inicial';
  exception when sqlstate '22023' then null; end;
  begin perform fin_pagamento_registrar(v_omie, t, jsonb_build_object('conta_id', v_conta), 'u1', 'Ana', 'k-a'); raise exception 'loja errada';
  exception when sqlstate '22023' then null; end;
  if (select count(*) from fin_pagamentos) <> 0 or (select count(*) from fin_lancamentos) <> 0 then raise exception 'validação deixou rastro'; end if;

  -- baixa parcial: 100 + juros 5 − desconto 2 = 103 de saída; título fica parcial com 100 quitado
  r := fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'valor_principal', 100, 'juros', 5, 'desconto', 2, 'forma', 'pix'), 'u1', 'Ana', 'k-p1');
  p1 := (r->>'id')::bigint;
  if r->>'status' <> 'parcial' or (r->>'valor_quitado')::numeric <> 100 or (r->>'restante')::numeric <> 200 then raise exception 'baixa parcial %', r; end if;
  select * into x from fin_lancamentos where origem_tipo = 'pagamento' and origem_id = p1;
  if x.valor <> 103 or x.tipo <> 'saida' or x.conta_id <> v_conta then raise exception 'lançamento da baixa %', x; end if;
  -- idempotência do pagamento: mesma chave não baixa de novo
  r := fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta, 'valor_principal', 100), 'u1', 'Ana', 'k-p1');
  if (r->>'duplicado')::boolean is not true or (r->>'id')::bigint <> p1 then raise exception 'idempotência do pagamento %', r; end if;
  if (select count(*) from fin_lancamentos) <> 1 then raise exception 'idempotência duplicou lançamento'; end if;
  if (select valor_quitado from fin_titulos_pagar where id = t) <> 100 then raise exception 'idempotência mexeu no título'; end if;
  -- mesma chave em outro título
  r := fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 50, 'data_vencimento', v_hoje - 3), 'u1', 'Ana', 'k-t2');
  begin perform fin_pagamento_registrar(v_loja, (r->>'id')::bigint, jsonb_build_object('conta_id', v_conta), 'u1', 'Ana', 'k-p1'); raise exception 'chave de outro título';
  exception when sqlstate '22023' then null; end;

  -- editar com pagamento: valor não pode ficar abaixo do quitado; fornecedor travado
  begin perform fin_titulo_pagar_salvar(v_loja, t, jsonb_build_object('fornecedor_id', v_forn, 'valor', 99, 'data_vencimento', v_hoje + 5)); raise exception 'valor < quitado';
  exception when sqlstate '22023' then null; end;
  perform fin_titulo_pagar_salvar(v_loja, t, jsonb_build_object('fornecedor_id', v_forn, 'valor', 250, 'data_vencimento', v_hoje + 6, 'observacao', 'renegociado',
        'categoria_id', v_cat, 'documento', 'NF 10'), 'u1', 'Ana');
  if (select valor from fin_titulos_pagar where id = t) <> 250 or (select status from fin_titulos_pagar where id = t) <> 'parcial' then raise exception 'edição'; end if;
  -- não cancela com pagamento ativo
  begin perform fin_titulo_pagar_cancelar(v_loja, t, 'engano'); raise exception 'cancelou com pagamento';
  exception when sqlstate '22023' then null; end;

  -- quita o restante (150) pela outra conta
  r := fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta2), 'u1', 'Ana', 'k-p2');
  p2 := (r->>'id')::bigint;
  if r->>'status' <> 'pago' or (r->>'restante')::numeric <> 0 then raise exception 'quitação %', r; end if;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta), 'u1', 'Ana', 'k-p3'); raise exception 'pagou título pago';
  exception when sqlstate '22023' then null; end;
  begin perform fin_titulo_pagar_salvar(v_loja, t, jsonb_build_object('fornecedor_id', v_forn, 'valor', 251, 'data_vencimento', v_hoje + 6)); raise exception 'editou valor de título pago';
  exception when sqlstate '22023' then null; end;

  -- saldos: caixa 1000 − 103 = 897; banco 5000,56 − 150 = 4850,56
  s := fin_contas_saldo(v_loja);
  if (select (j->>'saldo_atual')::numeric from jsonb_array_elements(s) j where (j->>'id')::bigint = v_conta) <> 897 then raise exception 'saldo caixa %', s; end if;
  if (select (j->>'saldo_atual')::numeric from jsonb_array_elements(s) j where (j->>'id')::bigint = v_conta2) <> 4850.56 then raise exception 'saldo banco %', s; end if;

  -- estorno do 1º pagamento: volta a entrada de 103, título vira parcial (150 quitado de 250); depois estorno do 2º: aberto
  r := fin_pagamento_estornar(v_loja, p1, 'pago na conta errada', 'u1', 'Ana');
  if r->>'status' <> 'parcial' or (r->>'valor_quitado')::numeric <> 150 then raise exception 'estorno 1 %', r; end if;
  r := fin_pagamento_estornar(v_loja, p1, 'de novo', 'u1', 'Ana');
  if (r->>'duplicado')::boolean is not true then raise exception 'estorno repetido deveria ser idempotente'; end if;
  s := fin_contas_saldo(v_loja);
  if (select (j->>'saldo_atual')::numeric from jsonb_array_elements(s) j where (j->>'id')::bigint = v_conta) <> 1000 then raise exception 'saldo caixa após estorno %', s; end if;
  r := fin_pagamento_estornar(v_loja, p2, 'teste', 'u1', 'Ana');
  if r->>'status' <> 'aberto' or (r->>'valor_quitado')::numeric <> 0 then raise exception 'estorno 2 %', r; end if;
  if (select count(*) from fin_pagamentos where titulo_id = t) <> 2 or (select count(*) from fin_lancamentos) <> 4 then raise exception 'nada deve ser apagado'; end if;
  begin perform fin_pagamento_estornar(v_loja, p1, 'x'); raise exception 'motivo curto aceito';
  exception when sqlstate '22023' then null; end;

  -- imutabilidade
  begin delete from fin_lancamentos; raise exception 'apagou lançamento'; exception when sqlstate '55000' then null; end;
  begin update fin_pagamentos set valor_pago = 1 where id = p1; raise exception 'reescreveu pagamento'; exception when sqlstate '55000' then null; end;
  begin delete from fin_pagamentos; raise exception 'apagou pagamento'; exception when sqlstate '55000' then null; end;
  begin delete from fin_eventos; raise exception 'apagou evento'; exception when sqlstate '55000' then null; end;

  -- rede de segurança: situação incoerente com o valor quitado é recusada pelo banco
  begin update fin_titulos_pagar set status = 'pago' where id = t; raise exception 'aceitou pago sem quitar';
  exception when check_violation then null; end;

  -- cancelar (sem pagamento ativo) + idempotência; cancelado não recebe pagamento nem edição
  perform fin_titulo_pagar_cancelar(v_loja, t, 'lançado em duplicidade', 'u1', 'Ana');
  r := fin_titulo_pagar_cancelar(v_loja, t, 'de novo');
  if (r->>'duplicado')::boolean is not true then raise exception 'cancelar repetido'; end if;
  begin perform fin_pagamento_registrar(v_loja, t, jsonb_build_object('conta_id', v_conta), 'u1', 'Ana', 'k-p9'); raise exception 'pagou cancelado';
  exception when sqlstate '22023' then null; end;
  begin perform fin_titulo_pagar_salvar(v_loja, t, jsonb_build_object('fornecedor_id', v_forn, 'valor', 250, 'data_vencimento', v_hoje)); raise exception 'editou cancelado';
  exception when sqlstate '22023' then null; end;

  -- listagem: filtros e totais (hoje = v_hoje)
  perform fin_titulo_pagar_salvar(v_loja, null, jsonb_build_object('fornecedor_id', v_forn, 'valor', 80, 'data_vencimento', v_hoje + 2));
  r := fin_titulos_pagar_listar(v_loja, '{}'::jsonb);
  if (r->'totais'->>'quantidade')::int <> 3 then raise exception 'listar total %', r; end if;
  -- t2 (50, venceu há 3 dias, aberto → atrasado) e t3 (80, futuro); cancelado fora dos valores
  if (r->'totais'->>'valor_restante')::numeric <> 130 or (r->'totais'->>'valor_atrasado')::numeric <> 50 then raise exception 'totais %', r->'totais'; end if;
  r := fin_titulos_pagar_listar(v_loja, '{"situacao":"atrasado"}'::jsonb);
  if (r->'totais'->>'quantidade')::int <> 1 then raise exception 'filtro atrasado %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, '{"situacao":"em_aberto"}'::jsonb);
  if (r->'totais'->>'quantidade')::int <> 2 then raise exception 'filtro em_aberto %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, '{"situacao":"cancelado"}'::jsonb);
  if (r->'totais'->>'quantidade')::int <> 1 or (r->'totais'->>'valor_total')::numeric <> 0 then raise exception 'filtro cancelado %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, jsonb_build_object('venc_de', v_hoje, 'venc_ate', v_hoje + 10));
  if (r->'totais'->>'quantidade')::int <> 2 then raise exception 'filtro vencimento %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, jsonb_build_object('categoria_id', v_cat));
  if (r->'totais'->>'quantidade')::int <> 1 then raise exception 'filtro categoria %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, jsonb_build_object('fornecedor_id', v_forn, 'q', 'NF 10'));
  if (r->'totais'->>'quantidade')::int <> 1 then raise exception 'filtro fornecedor+busca %', r; end if;
  r := fin_titulos_pagar_listar(v_loja, '{}'::jsonb, 1, 0);
  if jsonb_array_length(r->'itens') <> 1 or (r->'totais'->>'quantidade')::int <> 3 then raise exception 'paginação mantém o total %', r; end if;

  -- extrato com saldo corrido
  r := fin_extrato(v_loja, v_conta);
  if jsonb_array_length(r->'itens') <> 2 or (r->>'saldo_final')::numeric <> 1000 then raise exception 'extrato %', r; end if;
  if (r->'itens'->1->>'saldo_apos')::numeric <> 1000 or (r->'itens'->0->>'saldo_apos')::numeric <> 897 then raise exception 'saldo corrido %', r; end if;
  r := fin_extrato(v_loja, v_conta, v_hoje, v_hoje);
  if (r->>'saldo_anterior')::numeric <> 1000 then raise exception 'saldo anterior %', r; end if;

  -- detalhe
  r := fin_titulo_pagar_detalhe(v_loja, t);
  if jsonb_array_length(r->'pagamentos') <> 2 or jsonb_array_length(r->'eventos') < 5 then raise exception 'detalhe %', r; end if;
  if fin_titulo_pagar_detalhe(v_omie, t) is not null then raise exception 'detalhe vazou entre lojas'; end if;

  raise notice 'financeiro 285/286 OK';
end $$;
rollback;
