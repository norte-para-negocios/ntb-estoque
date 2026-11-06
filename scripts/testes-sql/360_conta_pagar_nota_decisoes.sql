-- Teste da migration 360 (decisões do dono de 05/11 sobre a conta a pagar da nota de entrada). Roda na loja 19
-- "ZZ NORTE ERP LAB" (proprio, is_test) e numa loja Omie criada aqui, TUDO dentro de BEGIN … ROLLBACK (nada fica gravado).
-- Rodar com scripts/testes-sql/360_rodar.sh. A ODARA (loja 15) só é LIDA (lista de notas sem conta).
-- Caminho real: gravar_nota_sefaz → registrar_compra_sefaz → lancar_compra → estornar_compra. Nada fala com Omie nem SEFAZ.
-- Espera: NOTICE "360 DECISOES CONTA A PAGAR DA NOTA OK".

create temp table _t360 (k text primary key, v text) on commit drop;

-- nota + compra pendente na loja 19 (devolve compra_id; a nota fica em _t360 com a chave k)
create function pg_temp.nota360(k text, seq text, emissao date, valor numeric, parcelas jsonb, itens jsonb, cnpj text default '99360000000191')
returns bigint language plpgsql as $$
declare ch text := '29261199360000019155001' || lpad(seq, 21, '0'); r jsonb; v_nota bigint;
begin
  r := gravar_nota_sefaz(19, jsonb_build_object('chave', ch, 'numero', seq, 'serie', '1', 'modelo', '55', 'emissao', emissao,
         'valor', valor, 'fornecedor_cnpj', cnpj, 'fornecedor_nome', 'FORNECEDOR TESTE 360 LTDA', 'ambiente', '2', 'etapa', '40',
         'full_object', case when parcelas is null then '{}'::jsonb else jsonb_build_object('parcelas', jsonb_build_object('parcelasLista', parcelas)) end),
         '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', 19, 'chave_acesso', ch, 'numero', seq, 'serie', '1', 'fornecedor_cnpj', cnpj,
         'fornecedor_nome', 'FORNECEDOR TESTE 360 LTDA', 'emissao', emissao, 'nota_fiscal_id', v_nota, 'itens', itens), 8000000000019);
  insert into _t360 values (k, v_nota::text);
  return (r->>'compra_id')::bigint;
end $$;

create function pg_temp.item360(linha int, prod bigint, valor numeric) returns jsonb language sql as $$
  select jsonb_build_object('linha', linha, 'c_prod', 'P' || linha, 'descricao', 'ITEM 360 ' || linha, 'quantidade', 1,
    'valor_unitario', valor, 'valor_total', valor, 'codigo_produto', prod, 'fator', 1)
$$;

create function pg_temp.lancar360(comp bigint, entrada date default null) returns jsonb language sql as $$
  select lancar_compra(jsonb_strip_nulls(jsonb_build_object('loja_id', 19, 'id', comp, 'itens', '[]'::jsonb, 'data_entrada', entrada)), 8000000000019, null)
$$;

create function pg_temp.nota(k text) returns bigint language sql as $$ select v::bigint from _t360 where k = $1 $$;

do $$
declare
  L constant bigint := 19;
  A constant bigint := 8000000000258; FA constant bigint := 8000000000257; -- Atacado
  B constant bigint := 8000000000261; FB constant bigint := 8000000000260; -- Horti - Frut
  C constant bigint := 8000000000485;                                       -- produto sem família
  v_ins bigint; v_rev bigint; v_rec bigint; r jsonb; v_comp bigint; v_nota bigint; t record; x record;
begin
  assert (select modo_estoque = 'proprio' and is_test and fin_cp_da_nota_ativo from lojas where id = L), 'loja 19 laboratório com a chave ligada';
  assert (select codigo_familia from produtos where loja_id = L and codigo_produto = A) = FA, 'produto A na família Atacado';
  assert (select codigo_familia from produtos where loja_id = L and codigo_produto = B) = FB, 'produto B na família Horti';
  assert (select codigo_familia from produtos where loja_id = L and codigo_produto = C) is null, 'produto C sem família';
  select id into v_ins from fin_categorias where loja_id = L and padrao = 'cmv_insumos';
  select id into v_rev from fin_categorias where loja_id = L and padrao = 'cmv_revenda';
  select id into v_rec from fin_categorias where loja_id = L and padrao = 'rec_vendas';
  insert into _t360 values ('cat_ins', v_ins::text), ('cat_rev', v_rev::text);

  -- ========== 1) mapa família → categoria
  r := fin_familia_categoria_salvar(L, FA, v_ins, 'u-teste', 'Teste 360');
  assert (r->>'mudou')::boolean, 'liga Atacado → insumos';
  assert (fin_familia_categoria_salvar(L, FA, v_ins)->>'mudou')::boolean = false, 'mesma categoria: nada muda';
  begin perform fin_familia_categoria_salvar(L, FB, v_rec); raise exception 'aceitou categoria de receita';
  exception when sqlstate '22023' then null; end;
  begin perform fin_familia_categoria_salvar(L, 123456789, v_ins); raise exception 'aceitou família inexistente';
  exception when sqlstate '22023' then null; end;
  begin perform fin_familia_categoria_salvar(L, FA, (select id from fin_categorias where loja_id = 15 limit 1)); raise exception 'aceitou categoria de outra loja';
  exception when sqlstate '22023' then null; end;
  r := fin_familia_categoria_salvar(L, FB, v_rev); r := fin_familia_categoria_salvar(L, FB, null);
  assert not exists (select 1 from fin_familia_categoria where loja_id = L and codigo_familia = FB), 'desligar apaga o vínculo';
  assert (select count(*) from fin_eventos where loja_id = L and entidade = 'familia_categoria') = 3, 'cada mudança vira evento';
  assert exists (select 1 from fin_familia_categoria_listar(L) f where f.codigo_familia = FA and f.categoria_id = v_ins and f.categoria_ok), 'listar mostra o vínculo';
  assert exists (select 1 from fin_familia_categoria_listar(L) f where f.codigo_familia = FB and f.categoria_id is null), 'listar mostra família sem categoria';

  -- ========== 2) nota com duplicatas: categoria da família predominante (Atacado 200 > Horti 100), competência pela ENTRADA
  v_comp := pg_temp.nota360('n1', '360001', '2026-10-30', 300,
    jsonb_build_array(jsonb_build_object('nSequencia', 1, 'dVencimento', '20/11/2026', 'vParcela', 150),
                      jsonb_build_object('nSequencia', 2, 'dVencimento', '20/12/2026', 'vParcela', 150)),
    jsonb_build_array(pg_temp.item360(1, A, 200), pg_temp.item360(2, B, 100)));
  r := pg_temp.lancar360(v_comp, '2026-11-05'); -- a loja 19 começa o ledger em 04/11: antes disso a 313 puxa para 04/11
  assert r->>'status' = 'lancada' and r->>'data_entrada' = '2026-11-05', 'entrada em 05/11: ' || r::text;
  v_nota := pg_temp.nota('n1');
  assert fin_data_entrada_da_nota(L, v_nota) = '2026-11-05', 'data de entrada pelos movimentos';
  for x in select * from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota order by parcela loop
    assert x.categoria_id = v_ins and x.data_competencia = '2026-11-01' and x.data_emissao = '2026-10-30' and x.status = 'aberto',
      'parcela ' || x.parcela || ': ' || row_to_json(x)::text;
  end loop;
  assert (select array_agg(data_vencimento order by parcela) from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota)
       = array['2026-11-20', '2026-12-20']::date[], 'vencimento continua o da duplicata';
  assert exists (select 1 from fin_eventos where loja_id = L and entidade = 'nota_entrada' and entidade_id = v_nota and tipo = 'titulos_gerados'
                 and (detalhe->>'manual')::boolean = false and (detalhe->>'familia')::bigint = FA), 'evento com família e automático';

  -- ========== 3) família predominante SEM categoria (Horti 250 > Atacado 50): sem categoria, sem padrão; sem duplicata = à vista
  v_comp := pg_temp.nota360('n2', '360002', '2026-11-01', 300, null, jsonb_build_array(pg_temp.item360(1, A, 50), pg_temp.item360(2, B, 250)));
  r := pg_temp.lancar360(v_comp);
  select * into t from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = pg_temp.nota('n2');
  assert t.categoria_id is null, 'família predominante sem categoria = sem categoria: ' || row_to_json(t)::text;
  assert t.data_vencimento = '2026-11-01' and t.total_parcelas = 1 and t.observacao like '%à vista%', 'sem duplicata: à vista na emissão';
  assert t.data_competencia = '2026-11-01', 'competência';
  select * into x from fin_categoria_da_nota(L, pg_temp.nota('n2'));
  assert x.motivo = 'familia_sem_categoria' and x.codigo_familia = FB, 'motivo: ' || row_to_json(x)::text;

  -- ========== 4) produto sem família predominante; empate família × sem família = família; item sem conta a pagar fora
  v_comp := pg_temp.nota360('n3', '360003', '2026-11-01', 100, null, jsonb_build_array(pg_temp.item360(1, C, 70), pg_temp.item360(2, A, 30)));
  select * into x from fin_categoria_da_nota(L, pg_temp.nota('n3'));
  assert x.categoria_id is null and x.motivo = 'sem_familia', 'sem família predominante: ' || row_to_json(x)::text;
  update compras_proprio_itens set gera_conta_pagar = false where compra_id = v_comp and codigo_produto = C;
  select * into x from fin_categoria_da_nota(L, pg_temp.nota('n3'));
  assert x.categoria_id = v_ins, 'item que não gera conta fica fora: ' || row_to_json(x)::text;
  update compras_proprio_itens set gera_conta_pagar = true, valor_total = 30 where compra_id = v_comp and codigo_produto = C;
  select * into x from fin_categoria_da_nota(L, pg_temp.nota('n3'));
  assert x.categoria_id = v_ins and x.motivo = 'mapeada', 'empate: a família ganha de "sem família"';
  -- nenhuma família mapeada
  perform fin_familia_categoria_salvar(L, FA, null);
  select * into x from fin_categoria_da_nota(L, pg_temp.nota('n1'));
  assert x.categoria_id is null, 'nenhuma família mapeada = sem categoria';
  perform fin_familia_categoria_salvar(L, FA, v_ins);
  -- categoria desativada depois de ligada não vale
  update fin_categorias set ativa = false where id = v_ins;
  assert (select categoria_id from fin_categoria_da_nota(L, pg_temp.nota('n1'))) is null, 'categoria inativa não vale';
  update fin_categorias set ativa = true where id = v_ins;
end $$;

-- ========== 5) chave DESLIGADA: nada automático; a nota aparece em "Notas sem conta"; gerar à mão vale; desfazer estorna
do $$
declare L constant bigint := 19; A constant bigint := 8000000000258; r jsonb; v_comp bigint; v_nota bigint; v_n int; x record;
begin
  update lojas set fin_cp_da_nota_ativo = false where id = L;
  v_comp := pg_temp.nota360('n4', '360004', '2026-11-03', 90,
    jsonb_build_array(jsonb_build_object('nSequencia', 1, 'dVencimento', '25/11/2026', 'vParcela', 90)), jsonb_build_array(pg_temp.item360(1, A, 90)));
  r := pg_temp.lancar360(v_comp);
  v_nota := pg_temp.nota('n4');
  assert r->>'status' = 'lancada', 'entrada normal sem a chave';
  assert not exists (select 1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota), 'sem a chave: nada automático';
  select * into x from fin_notas_sem_conta(L) s where s.nota_id = v_nota;
  assert found, 'nota confirmada sem conta aparece na lista';
  assert x.valor_total = 90 and x.chave_ligada = false and x.regra = 'duplicatas' and jsonb_array_length(x.parcelas) = 1
     and x.parcelas->0->>'vencimento' = '2026-11-25' and x.categoria_id = (select v::bigint from _t360 where k = 'cat_ins')
     and x.data_entrada = '2026-11-04' and x.status_compra = 'lancada', 'prévia da lista: ' || row_to_json(x)::text;
  -- as notas com conta da seção 2/3 não aparecem
  assert not exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id in (pg_temp.nota('n1'), pg_temp.nota('n2'))), 'nota com conta fica fora';
  -- nota pendente (n3 não foi confirmada) fica fora
  assert not exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id = pg_temp.nota('n3')), 'nota não confirmada fica fora';

  r := fin_titulos_da_nota_gerar(L, v_nota);
  assert (r->>'gerados')::int = 0 and r->>'motivo' like '%não está ligada%', 'automático respeita a chave: ' || r::text;
  r := fin_titulos_da_nota_gerar_manual(L, v_nota, 'u-teste', 'Teste 360');
  assert (r->>'gerados')::int = 1, 'à mão gera com a chave desligada: ' || r::text;
  assert (select observacao from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota) like 'Gerada à mão%', 'marca à mão';
  assert exists (select 1 from fin_eventos where entidade = 'nota_entrada' and entidade_id = v_nota and tipo = 'titulos_gerados' and (detalhe->>'manual')::boolean), 'evento manual';
  r := fin_titulos_da_nota_gerar_manual(L, v_nota);
  assert (r->>'gerados')::int = 0 and (r->>'ja_existiam')::int = 1, 'à mão é idempotente';
  assert not exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id = v_nota), 'gerada some da lista';

  -- desfazer com a chave desligada: a conta gerada à mão é cancelada (não fica órfã)
  r := estornar_compra(v_comp, null);
  assert (select status from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota) = 'cancelado', 'estorno sem a chave cancela a conta à mão';
  assert not exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id = v_nota), 'desfeita (pendente) fica fora da lista';
  -- confirmar de novo sem a chave: volta para a lista (rodada nova sem conta)
  r := pg_temp.lancar360(v_comp);
  assert exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id = v_nota), 'reconfirmada sem a chave volta para a lista';
  -- conta cancelada à mão na rodada atual = decisão tomada, não volta para a lista
  r := fin_titulos_da_nota_gerar_manual(L, v_nota);
  perform fin_titulo_pagar_cancelar(L, (select id from fin_titulos_pagar where loja_id = L and origem_id = v_nota and status = 'aberto'), 'teste cancelar à mão');
  assert not exists (select 1 from fin_notas_sem_conta(L) s where s.nota_id = v_nota), 'cancelada à mão na rodada não volta';

  -- desfazer nota SEM conta numa loja sem a chave: nenhum evento novo
  select count(*) into v_n from fin_eventos where loja_id = L;
  v_comp := pg_temp.nota360('n5', '360005', '2026-11-03', 10, null, jsonb_build_array(pg_temp.item360(1, A, 10)));
  r := pg_temp.lancar360(v_comp); r := estornar_compra(v_comp, null);
  assert (select count(*) from fin_eventos where loja_id = L) = v_n, 'desfazer sem conta não grava nada';
  update lojas set fin_cp_da_nota_ativo = true where id = L;
end $$;

-- ========== 6) parcela paga em nota desfeita: pendência do gerente; "manter" e "estornar"
do $$
declare
  L constant bigint := 19; A constant bigint := 8000000000258; r jsonb; v_comp bigint; v_comp2 bigint; v_nota bigint; v_conta bigint;
  v_t1 bigint; v_t2 bigint; v_saldo numeric;
begin
  r := fin_conta_salvar(L, null, jsonb_build_object('nome', 'Caixa teste 360', 'tipo', 'caixa', 'saldo_inicial', 1000));
  v_conta := (r->>'id')::bigint;
  -- nota P1: paga a parcela 1 e desfaz
  v_comp := pg_temp.nota360('p1', '360011', '2026-11-03', 200,
    jsonb_build_array(jsonb_build_object('nSequencia', 1, 'dVencimento', '10/11/2026', 'vParcela', 100),
                      jsonb_build_object('nSequencia', 2, 'dVencimento', '10/12/2026', 'vParcela', 100)), jsonb_build_array(pg_temp.item360(1, A, 200)));
  r := pg_temp.lancar360(v_comp);
  v_nota := pg_temp.nota('p1');
  select id into v_t1 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota and parcela = 1;
  assert not exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t1), 'nota lançada: sem pendência';
  r := fin_pagamento_registrar(L, v_t1, jsonb_build_object('conta_id', v_conta), null, 'teste', 'pg-360-1');
  r := estornar_compra(v_comp, null);
  assert exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t1 and p.status_compra = 'pendente' and p.pagamentos = 1), 'pendência aparece';
  begin perform fin_nota_desfeita_decidir(L, v_t1, 'manter', ''); raise exception 'aceitou sem motivo';
  exception when sqlstate '22023' then null; end;
  begin perform fin_nota_desfeita_decidir(L, v_t1, 'apagar', 'x x x'); raise exception 'aceitou ação inválida';
  exception when sqlstate '22023' then null; end;
  r := fin_nota_desfeita_decidir(L, v_t1, 'manter', 'Fornecedor vai trocar a nota', 'u-gerente', 'Gerente 360');
  assert (r->>'duplicado')::boolean = false and r->>'status' = 'pago', 'manter: ' || r::text;
  assert not exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t1), 'manter tira da lista';
  assert (select status from fin_titulos_pagar where id = v_t1) = 'pago', 'manter não mexe na conta';
  assert (fin_nota_desfeita_decidir(L, v_t1, 'manter', 'de novo')->>'duplicado')::boolean, 'manter de novo = duplicado';
  begin perform fin_nota_desfeita_decidir(L, v_t1, 'estornar', 'mudei de ideia'); raise exception 'estornou sem pendência';
  exception when sqlstate '22023' then null; end;
  -- confirmar e desfazer de novo com a parcela ainda paga: a pendência volta
  r := pg_temp.lancar360(v_comp); r := estornar_compra(v_comp, null);
  assert exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t1), 'desfeita de novo: pendência volta';

  -- nota P2: paga parcialmente em 2 pagamentos e desfaz; o gerente estorna
  v_comp2 := pg_temp.nota360('p2', '360012', '2026-11-03', 80,
    jsonb_build_array(jsonb_build_object('nSequencia', 1, 'dVencimento', '15/11/2026', 'vParcela', 80)), jsonb_build_array(pg_temp.item360(1, A, 80)));
  r := pg_temp.lancar360(v_comp2);
  select id into v_t2 from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = pg_temp.nota('p2');
  r := fin_pagamento_registrar(L, v_t2, jsonb_build_object('conta_id', v_conta, 'valor_principal', 30), null, 'teste', 'pg-360-2a');
  r := fin_pagamento_registrar(L, v_t2, jsonb_build_object('conta_id', v_conta, 'valor_principal', 20), null, 'teste', 'pg-360-2b');
  select saldo_atual into v_saldo from jsonb_to_recordset(fin_contas_saldo(L)) as c(id bigint, saldo_atual numeric) where id = v_conta;
  r := estornar_compra(v_comp2, null);
  assert exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t2 and p.valor_quitado = 50 and p.pagamentos = 2), 'pendência da parcial';
  r := fin_nota_desfeita_decidir(L, v_t2, 'estornar', 'Nota devolvida ao fornecedor', 'u-gerente', 'Gerente 360');
  assert r->>'status' = 'cancelado' and (r->>'pagamentos_estornados')::int = 2, 'estornar: ' || r::text;
  assert (select status from fin_titulos_pagar where id = v_t2) = 'cancelado' and (select valor_quitado from fin_titulos_pagar where id = v_t2) = 0, 'conta cancelada';
  assert (select count(*) from fin_pagamentos where titulo_id = v_t2 and estornado_em is not null) = 2, 'os 2 pagamentos estornados (nada apagado)';
  assert (select saldo_atual from jsonb_to_recordset(fin_contas_saldo(L)) as c(id bigint, saldo_atual numeric) where id = v_conta) = v_saldo + 50, 'dinheiro volta ao extrato';
  assert not exists (select 1 from fin_pendencias_nota_desfeita(L) p where p.titulo_id = v_t2), 'estornar tira da lista';
  assert (fin_nota_desfeita_decidir(L, v_t2, 'estornar', 'de novo')->>'duplicado')::boolean, 'estornar de novo = duplicado';
  assert exists (select 1 from fin_eventos where entidade = 'titulo_pagar' and entidade_id = v_t2 and tipo = 'nota_desfeita_estornada'), 'evento da decisão';
  -- reconfirmar a P2 depois do estorno: gera conta nova (rodada nova), sem pendência
  r := pg_temp.lancar360(v_comp2);
  assert (select count(*) from fin_titulos_pagar where loja_id = L and origem_id = pg_temp.nota('p2') and status = 'aberto') = 1, 'reconfirmada gera de novo';
end $$;

-- ========== 7) loja Omie, ODARA (só leitura), grants e permissão
do $$
declare v_omie bigint; v_c bigint; v_odara int; v_odara_lancadas int;
begin
  insert into lojas (nome, cnpj, modo_estoque, is_test) values ('TESTE 360 OMIE', '99360000000434', 'omie', true) returning id into v_omie;
  insert into compras_proprio (loja_id, origem, numero, nota_fiscal_id, status) values (v_omie, 'manual', 'X', 999999999, 'lancada') returning id into v_c;
  update compras_proprio set status = 'pendente' where id = v_c; -- estorno em loja Omie: gatilho ignora, sem erro
  assert not exists (select 1 from fin_eventos where loja_id = v_omie), 'loja omie intocada';
  begin perform fin_titulos_da_nota_gerar_manual(v_omie, 999999999); raise exception 'gerou em loja omie';
  exception when sqlstate '22023' then null; end;
  assert not exists (select 1 from fin_notas_sem_conta(null) s where s.loja_id = v_omie), 'lista só de loja própria';

  -- ODARA (15): todas as notas confirmadas sem conta aparecem (só leitura; a chave dela segue desligada)
  assert not (select fin_cp_da_nota_ativo from lojas where id = 15), 'ODARA desligada';
  select count(*) into v_odara from fin_notas_sem_conta(15);
  select count(*) into v_odara_lancadas from compras_proprio c join notas_fiscais n on n.id = c.nota_fiscal_id and n.deleted_at is null
    where c.loja_id = 15 and c.status in ('lancada', 'parcial');
  assert v_odara > 0, 'ODARA aparece na lista';
  raise notice '360: ODARA % notas sem conta de % confirmadas; todas as lojas próprias: %', v_odara, v_odara_lancadas, (select count(*) from fin_notas_sem_conta(null));

  assert not has_function_privilege('authenticated', 'fin_titulos_da_nota_gerar_manual(bigint,bigint,text,text)', 'execute'), 'sem grant authenticated';
  assert not has_function_privilege('anon', 'fin_nota_desfeita_decidir(bigint,bigint,text,text,text,text)', 'execute'), 'sem grant anon';
  assert has_function_privilege('service_role', 'fin_notas_sem_conta(bigint,int)', 'execute'), 'service_role chama';
  assert not has_table_privilege('authenticated', 'fin_familia_categoria', 'select'), 'tabela nova sem grant authenticated';
  assert exists (select 1 from cargo_permissao cp join cargos c on c.id = cp.cargo_id join permissoes p on p.id = cp.permissao_id
                 where c.nome = 'Gerente' and p.nome = 'Financeiro - Decidir nota desfeita'), 'Gerente decide';
  assert (select count(*) from pg_proc where proname = 'fin_titulos_da_nota_gerar') = 1, 'um overload só';
  raise notice '360 DECISOES CONTA A PAGAR DA NOTA OK';
end $$;
