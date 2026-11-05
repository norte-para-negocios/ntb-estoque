-- Teste da migration 340 (conta a pagar gerada pela nota de entrada). Roda na loja 19 "ZZ NORTE ERP LAB" (proprio, is_test)
-- e numa loja Omie criada aqui mesmo, TUDO dentro de BEGIN … ROLLBACK (nada fica gravado). Rodar com
-- scripts/testes-sql/340_rodar.sh (aplica a 340 sem o begin/commit dela dentro da mesma transação e desfaz no fim).
-- Usa o caminho real: gravar_nota_sefaz → registrar_compra_sefaz → lancar_compra ("Confirmar entrada") → estornar_compra
-- ("Desfazer entrada") → sefaz_marcar_cancelada. Espera: NOTICE "340 CONTA A PAGAR DA NOTA OK".
-- NUNCA rodar em loja real; nada aqui fala com Omie nem com a SEFAZ.

create temp table _t340 (k text primary key, v text) on commit drop;
grant select on _t340 to service_role;

do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; PROD constant bigint := 8000000000258;
  CNPJ constant text := '99340000000191';
  CH1 constant text := '29261199340000019155001' || lpad('340001', 21, '0');
  r jsonb; v_nota bigint; v_comp bigint; v_n int; v_forn bigint; v_cat bigint; v_conta bigint; v_t1 bigint; x record;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 tem de ser a loja-laboratório própria';
  assert length(CH1) = 44, 'chave de teste com 44 dígitos';
  assert (select fin_cp_da_nota_ativo from lojas where id = L), 'a 340 liga a chave na loja 19';
  assert not exists (select 1 from lojas where fin_cp_da_nota_ativo and (not is_test or id <> L)), 'nenhuma outra loja ligada (ODARA e reais desligadas)';
  assert not (select fin_cp_da_nota_ativo from lojas where id = 15), 'ODARA desligada';

  -- ========== 1) nota com 3 duplicatas (cobr/dup), confirmada pela tela
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH1, 'numero', '000340', 'serie', '1', 'modelo', '55', 'emissao', '2026-11-03',
         'valor', 300, 'fornecedor_cnpj', CNPJ, 'fornecedor_nome', 'ATACADO TESTE 340 LTDA', 'ambiente', '2', 'etapa', '40',
         'full_object', jsonb_build_object('parcelas', jsonb_build_object('parcelasLista', jsonb_build_array(
            jsonb_build_object('nSequencia', 1, 'dVencimento', '10/11/2026', 'vParcela', 100),
            jsonb_build_object('nSequencia', 2, 'dVencimento', '17/11/2026', 'vParcela', 100),
            jsonb_build_object('nSequencia', 3, 'dVencimento', '24/11/2026', 'vParcela', 100))))), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH1, 'numero', '000340', 'serie', '1', 'fornecedor_cnpj', CNPJ,
         'fornecedor_nome', 'ATACADO TESTE 340 LTDA', 'emissao', '2026-11-03', 'nota_fiscal_id', v_nota,
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'A340', 'descricao', 'ACUCAR 340', 'quantidade', 10,
            'valor_unitario', 30, 'valor_total', 300, 'codigo_produto', PROD, 'fator', 1))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  -- nota pendente: sem conta a pagar ainda
  assert not exists (select 1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota), 'pendente não gera';

  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'entrada confirmada: ' || r::text;
  select count(*) into v_n from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status = 'aberto';
  if v_n <> 3 then raise notice 'DEBUG % | %', r, (select jsonb_agg(detalhe) from fin_eventos where loja_id = L and entidade = 'nota_entrada' and entidade_id = v_nota); end if;
  assert v_n = 3, '3 duplicatas = 3 contas a pagar, veio ' || v_n;
  select id into v_forn from fornecedores where loja_id = L and cnpj_cpf = CNPJ;
  select id into v_cat from fin_categorias where loja_id = L and padrao = 'cmv_revenda';
  for x in select * from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota order by parcela loop
    assert x.valor = 100 and x.total_parcelas = 3 and x.fornecedor_id = v_forn and x.categoria_id = v_cat and x.documento = 'NF 340'
       and x.data_emissao = '2026-11-03' and x.data_competencia = '2026-11-01'
       and x.chave_idempotencia = 'nota_entrada:' || v_nota || ':0:' || x.parcela, 'dados da parcela ' || x.parcela || ': ' || row_to_json(x)::text;
  end loop;
  assert (select array_agg(data_vencimento order by parcela) from fin_titulos_pagar where loja_id = L and origem_id = v_nota and origem_tipo = 'nota_entrada')
       = array['2026-11-10', '2026-11-17', '2026-11-24']::date[], 'vencimentos das duplicatas';
  assert exists (select 1 from fin_eventos where loja_id = L and entidade = 'nota_entrada' and entidade_id = v_nota and tipo = 'titulos_gerados'), 'evento da nota';

  -- idempotente: gerar de novo e confirmar de novo não duplicam
  r := fin_titulos_da_nota_gerar(L, v_nota);
  assert (r->>'gerados')::int = 0 and (r->>'ja_existiam')::int = 3, 'gerar de novo: ' || r::text;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota) = 3, 'confirmar de novo não duplica';

  -- ========== 2) desfazer: as 3 abertas são canceladas; confirmar de novo gera a rodada 1
  r := estornar_compra(v_comp, null);
  assert (select status from compras_proprio where id = v_comp) = 'pendente', 'desfeita reabre a compra';
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status = 'cancelado') = 3, 'desfazer cancela as 3';
  assert (select bool_and(motivo_cancelamento = 'Entrada da nota desfeita') from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota), 'motivo';
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'confirmada de novo: ' || r::text;
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status = 'aberto') = 3, 'rodada 1 com 3 ativas';
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota) = 6, '3 canceladas + 3 ativas, nada apagado';

  -- ========== 3) parcela paga + desfazer: a paga fica (decisão humana), as outras saem; confirmar de novo reaproveita a paga
  r := fin_conta_salvar(L, null, jsonb_build_object('nome', 'Caixa teste 340', 'tipo', 'caixa', 'saldo_inicial', 1000));
  v_conta := (r->>'id')::bigint;
  select id into v_t1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status = 'aberto' and parcela = 1;
  r := fin_pagamento_registrar(L, v_t1, jsonb_build_object('conta_id', v_conta), null, 'teste', 'pg-340-1');
  assert r->>'status' = 'pago', 'parcela 1 paga: ' || r::text;
  r := estornar_compra(v_comp, null);
  assert (select status from fin_titulos_pagar where id = v_t1) = 'pago', 'parcela paga não é tocada';
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status <> 'cancelado') = 1, 'só a paga fica ativa';
  assert exists (select 1 from fin_eventos where entidade = 'titulo_pagar' and entidade_id = v_t1 and tipo = 'nota_desfeita_com_pagamento'), 'evento da paga';
  assert exists (select 1 from fin_eventos where entidade = 'nota_entrada' and entidade_id = v_nota and tipo = 'titulos_estornados'
                 and (detalhe->>'com_pagamento')::int = 1 and (detalhe->>'cancelados')::int = 2), 'resumo do estorno';
  assert (select saldo_atual from jsonb_to_recordset(fin_contas_saldo(L)) as c(id bigint, saldo_atual numeric) where id = v_conta) = 900, 'pagamento continua no extrato';
  r := fin_titulos_da_nota_estornar(L, v_nota);
  assert (r->>'cancelados')::int = 0 and (r->>'com_pagamento')::int = 1, 'estornar de novo é idempotente: ' || r::text;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert (select array_agg(parcela order by parcela) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and status <> 'cancelado')
       = array[1, 2, 3], 'confirmar de novo: a paga + parcelas 2 e 3 novas (sem duplicar a 1)';
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and chave_idempotencia like 'nota_entrada:%:2:%') = 2, 'rodada 2 só com 2 e 3';

  insert into _t340 values ('nota1', v_nota::text), ('comp1', v_comp::text);
end $$;

do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; PROD constant bigint := 8000000000258;
  CH2 constant text := '29261199340000019155001' || lpad('340002', 21, '0');
  CH3 constant text := '29261199340000019155001' || lpad('340003', 21, '0');
  CH4 constant text := '29261199340000019155001' || lpad('340004', 21, '0');
  r jsonb; v_nota bigint; v_comp bigint; t record; v_omie bigint; v_c bigint;
begin
  -- ========== 4) nota SEM duplicata: uma conta no total, vencendo na emissão
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH2, 'numero', '340002', 'serie', '1', 'modelo', '55', 'emissao', '2026-11-02',
         'valor', 512.4, 'fornecedor_cnpj', '99340000000272', 'fornecedor_nome', 'SEM DUP 340 LTDA', 'ambiente', '2', 'etapa', '40',
         'full_object', '{}'::jsonb), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH2, 'numero', '340002', 'fornecedor_cnpj', '99340000000272',
         'emissao', '2026-11-02', 'nota_fiscal_id', v_nota, 'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1,
         'valor_unitario', 512.4, 'valor_total', 512.4, 'codigo_produto', PROD, 'fator', 1))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  select * into t from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota;
  assert t.valor = 512.40 and t.parcela = 1 and t.total_parcelas = 1 and t.data_vencimento = '2026-11-02' and t.observacao like '%sem duplicata%',
    'sem duplicata: ' || row_to_json(t)::text;

  -- ========== 5) cancelada na SEFAZ: a conta aberta sai
  r := sefaz_marcar_cancelada(L, CH2);
  assert (select status from compras_proprio where id = v_comp) = 'cancelada', 'compra cancelada';
  assert (select status from fin_titulos_pagar where id = t.id) = 'cancelado', 'conta da nota cancelada na SEFAZ foi cancelada';

  -- ========== 6) falha (nota sem CNPJ) não impede a entrada: motivo registrado
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH3, 'numero', '340003', 'emissao', '2026-11-02', 'valor', 50, 'ambiente', '2', 'etapa', '40',
         'full_object', '{}'::jsonb), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH3, 'numero', '340003', 'emissao', '2026-11-02', 'nota_fiscal_id', v_nota,
         'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 50, 'valor_total', 50, 'codigo_produto', PROD, 'fator', 1))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'entrada no estoque segue mesmo sem conta a pagar: ' || r::text;
  assert not exists (select 1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota), 'sem CNPJ, sem conta';
  assert exists (select 1 from fin_eventos where entidade = 'nota_entrada' and entidade_id = v_nota and tipo = 'titulos_falha'
                 and detalhe->>'erro' like '%CNPJ%'), 'motivo da falha gravado';

  -- ========== 7) nenhum item gera conta a pagar: nada
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH4, 'numero', '340004', 'emissao', '2026-11-02', 'valor', 20, 'fornecedor_cnpj', '99340000000353',
         'fornecedor_nome', 'BONIFICACAO 340', 'ambiente', '2', 'etapa', '40', 'full_object', '{}'::jsonb), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH4, 'numero', '340004', 'fornecedor_cnpj', '99340000000353', 'emissao', '2026-11-02',
         'nota_fiscal_id', v_nota, 'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 20, 'valor_total', 20,
         'codigo_produto', PROD, 'fator', 1, 'gera_conta_pagar', false))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert not exists (select 1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota), 'item sem conta a pagar';

  -- ========== 8) loja Omie: nada muda (gatilho ignora; função recusa)
  insert into lojas (nome, cnpj, modo_estoque, is_test) values ('TESTE 340 OMIE', '99340000000434', 'omie', true) returning id into v_omie;
  insert into compras_proprio (loja_id, origem, numero, nota_fiscal_id, status) values (v_omie, 'manual', 'X', 999999999, 'pendente') returning id into v_c;
  update compras_proprio set status = 'lancada' where id = v_c;
  assert not exists (select 1 from fin_titulos_pagar where loja_id = v_omie) and not exists (select 1 from fin_eventos where loja_id = v_omie), 'loja omie intocada';
  begin perform fin_titulos_da_nota_gerar(v_omie, 999999999); raise exception 'gerou em loja omie';
  exception when sqlstate '22023' then null; end;
end $$;

-- ========== 10) loja própria SEM a chave (loja 19 com a chave desligada aqui dentro): não gera nem estorna nada
do $$
declare
  L constant bigint := 19; LOC constant bigint := 8000000000019; PROD constant bigint := 8000000000258;
  CH5 constant text := '29261199340000019155001' || lpad('340005', 21, '0');
  r jsonb; v_nota bigint; v_comp bigint; v_ev int; v_tit int;
begin
  update lojas set fin_cp_da_nota_ativo = false where id = L;
  select count(*) into v_ev from fin_eventos where loja_id = L;
  select count(*) into v_tit from fin_titulos_pagar where loja_id = L;
  r := gravar_nota_sefaz(L, jsonb_build_object('chave', CH5, 'numero', '340005', 'emissao', '2026-11-02', 'valor', 90, 'fornecedor_cnpj', '99340000000515',
         'fornecedor_nome', 'SEM CHAVE 340', 'ambiente', '2', 'etapa', '40', 'full_object', jsonb_build_object('parcelas', jsonb_build_object('parcelasLista',
         jsonb_build_array(jsonb_build_object('nSequencia', 1, 'dVencimento', '20/11/2026', 'vParcela', 90))))), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', L, 'chave_acesso', CH5, 'numero', '340005', 'fornecedor_cnpj', '99340000000515', 'emissao', '2026-11-02',
         'nota_fiscal_id', v_nota, 'itens', jsonb_build_array(jsonb_build_object('linha', 1, 'quantidade', 1, 'valor_unitario', 90, 'valor_total', 90,
         'codigo_produto', PROD, 'fator', 1))), LOC);
  v_comp := (r->>'compra_id')::bigint;
  r := lancar_compra(jsonb_build_object('loja_id', L, 'id', v_comp, 'itens', '[]'::jsonb), LOC, null);
  assert r->>'status' = 'lancada', 'entrada segue normal sem a chave: ' || r::text;
  r := fin_titulos_da_nota_gerar(L, v_nota);
  assert (r->>'gerados')::int = 0 and r->>'motivo' like '%não está ligada%', '"Gerar agora" também respeita a chave: ' || r::text;
  -- estorno com a chave desligada: as contas abertas da nota 1 (gerada com a chave ligada) NÃO são tocadas
  r := fin_titulos_da_nota_estornar(L, (select v::bigint from _t340 where k = 'nota1'));
  assert (r->>'desligado')::boolean and (r->>'cancelados')::int = 0, 'estorno respeita a chave: ' || r::text;
  r := estornar_compra(v_comp, null);
  assert (select count(*) from fin_titulos_pagar where loja_id = L) = v_tit, 'sem a chave: nenhuma conta criada ou mexida';
  assert (select count(*) from fin_eventos where loja_id = L) = v_ev, 'sem a chave: nenhum evento';
  update lojas set fin_cp_da_nota_ativo = true where id = L;
end $$;

-- ========== 9) o servidor (service_role) mexendo direto no status (excluirNotaProprio) dispara o gatilho sem erro de permissão
set local role service_role;
update compras_proprio set status = 'cancelada' where id = (select v::bigint from _t340 where k = 'comp1');
reset role;
do $$
declare v_nota bigint := (select v::bigint from _t340 where k = 'nota1');
begin
  -- a compra estava lançada: a exclusão cancela as contas abertas (2 e 3 da rodada 2) e deixa a paga
  assert (select count(*) from fin_titulos_pagar where loja_id = 19 and origem_tipo = 'nota_entrada' and origem_id = v_nota and status <> 'cancelado') = 1,
    'excluir pelo servidor: só a paga continua';
  assert (select count(*) from fin_titulos_pagar where loja_id = 19 and origem_tipo = 'nota_entrada' and origem_id = v_nota and motivo_cancelamento = 'Nota cancelada ou excluída') = 2,
    'motivo da exclusão';
  -- anon/authenticated não chamam as funções novas
  assert not has_function_privilege('authenticated', 'fin_titulos_da_nota_gerar(bigint,bigint,text,text)', 'execute'), 'sem grant para authenticated';
  assert not has_function_privilege('anon', 'fin_titulos_da_nota_estornar(bigint,bigint,text,text,text)', 'execute'), 'sem grant para anon';
  raise notice '340 CONTA A PAGAR DA NOTA OK';
end $$;
