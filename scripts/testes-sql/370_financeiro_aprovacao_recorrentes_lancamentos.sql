-- Teste das migrations 370/371 (Fase 4 passo 2 do financeiro: aprovação, recorrentes, avulso e transferência). Roda na loja 19
-- "ZZ NORTE ERP LAB" (proprio, is_test), TUDO dentro de BEGIN … ROLLBACK (nada fica gravado). Rodar com scripts/testes-sql/370_rodar.sh.
-- A ODARA (loja 15) só é LIDA (o gerador com p_loja null não pode criar nada nela). Estado mexido: só a configuração da loja 19
-- (fin_config_loja, por loja) e linhas fin_* da loja 19; nada global (nenhum mês fechado, nenhuma chave de outra loja).
-- Caminho da nota: gravar_nota_sefaz → registrar_compra_sefaz → lancar_compra (gatilho da 340/360). Nada fala com Omie nem SEFAZ.
-- Espera: NOTICE "370 APROVACAO RECORRENTES LANCAMENTOS OK".

create temp table _t370 (k text primary key, v text) on commit drop;

create function pg_temp.erro370(sql text, padrao text) returns void language plpgsql as $$
declare m text;
begin
  begin
    execute sql;
  exception when sqlstate '22023' then
    get stacked diagnostics m = message_text;
    if m !~* padrao then raise exception 'mensagem inesperada para [%]: % (esperava %)', sql, m, padrao; end if;
    return;
  end;
  raise exception 'devia ter falhado: %', sql;
end $$;

create function pg_temp.saldo370(conta bigint) returns numeric language sql as $$
  select (x->>'saldo_atual')::numeric from jsonb_array_elements(fin_contas_saldo(19)) x where (x->>'id')::bigint = conta
$$;
create function pg_temp.consolidado370() returns numeric language sql as $$
  select coalesce(sum((x->>'saldo_atual')::numeric), 0) from jsonb_array_elements(fin_contas_saldo(19)) x
$$;
create function pg_temp.titulo370(forn bigint, valor numeric, venc date, chave text, usr text default 'u-autor') returns bigint language sql as $$
  select (fin_titulo_pagar_salvar(19, null, jsonb_build_object('fornecedor_id', forn, 'valor', valor::text, 'data_vencimento', venc,
    'documento', 'T370'), usr, 'Autor 370', chave)->>'id')::bigint
$$;
create function pg_temp.pagar370(tit bigint, conta bigint, chave text) returns jsonb language sql as $$
  select fin_pagamento_registrar(19, tit, jsonb_build_object('conta_id', conta, 'data_pagamento', fin_hoje()), 'u-pag', 'Pagador 370', chave)
$$;

-- nota de entrada da loja 19 (mesmo molde do teste da 360)
create function pg_temp.nota370(seq text, emissao date, valor numeric, itens jsonb) returns bigint language plpgsql as $$
declare ch text := '29261199370000019155001' || lpad(seq, 21, '0'); r jsonb; v_nota bigint; cnpj text := '99370000000191';
begin
  r := gravar_nota_sefaz(19, jsonb_build_object('chave', ch, 'numero', seq, 'serie', '1', 'modelo', '55', 'emissao', emissao,
         'valor', valor, 'fornecedor_cnpj', cnpj, 'fornecedor_nome', 'FORNECEDOR TESTE 370 LTDA', 'ambiente', '2', 'etapa', '40',
         'full_object', '{}'::jsonb), '[]'::jsonb);
  v_nota := (r->>'nota_id')::bigint;
  r := registrar_compra_sefaz(jsonb_build_object('loja_id', 19, 'chave_acesso', ch, 'numero', seq, 'serie', '1', 'fornecedor_cnpj', cnpj,
         'fornecedor_nome', 'FORNECEDOR TESTE 370 LTDA', 'emissao', emissao, 'nota_fiscal_id', v_nota, 'itens', itens), 8000000000019);
  r := lancar_compra(jsonb_build_object('loja_id', 19, 'id', (r->>'compra_id')::bigint, 'itens', '[]'::jsonb, 'data_entrada', '2026-11-05'),
         8000000000019, null);
  if r->>'status' <> 'lancada' then raise exception 'nota não lançou: %', r; end if;
  return v_nota;
end $$;

do $$
declare
  L constant bigint := 19; A constant bigint := 8000000000258;
  F1 bigint; F2 bigint; F_OUTRA bigint; v_alug bigint; v_ener bigint; v_rec bigint;
  c1 bigint; c2 bigint; t_800 bigint; t_2000 bigint; t_8000 bigint; t_6000 bigint; t_off bigint; t bigint; r jsonb; x record;
  v_nota bigint; rec_m bigint; rec_s bigint; rec_31 bigint; rec_fim bigint; rec_ruim bigint; v_cons numeric; v_lanc bigint; v_tr bigint;
  n15 int; n int;
begin
  assert (select modo_estoque = 'proprio' and is_test from lojas where id = L), 'loja 19 é o laboratório';
  select id into F1 from fornecedores where loja_id = L and not inativo order by id limit 1;
  select id into F2 from fornecedores where loja_id = L and not inativo order by id offset 1 limit 1;
  select id into F_OUTRA from fornecedores where loja_id = 15 order by id limit 1;
  select id into v_alug from fin_categorias where loja_id = L and padrao = 'oper_aluguel';
  select id into v_ener from fin_categorias where loja_id = L and padrao = 'oper_energia';
  select id into v_rec from fin_categorias where loja_id = L and padrao = 'rec_outras';
  assert F1 is not null and F2 is not null and F_OUTRA is not null and v_alug is not null and v_rec is not null, 'dados do laboratório';

  -- contas correntes: C1 com R$ 10.000,00, C2 zerada (saldo inicial em 01/11)
  c1 := (fin_conta_salvar(L, null, jsonb_build_object('nome', 'Banco 370', 'tipo', 'banco', 'saldo_inicial', '10000.00', 'data_saldo_inicial', '2026-11-01'))->>'id')::bigint;
  c2 := (fin_conta_salvar(L, null, jsonb_build_object('nome', 'Caixa 370', 'tipo', 'caixa', 'saldo_inicial', '0', 'data_saldo_inicial', '2026-11-01'))->>'id')::bigint;

  -- ========== 1) configuração: padrão do dono, validação, evento
  r := fin_config_ler(L);
  assert not (r->>'aprovacao_ativa')::boolean and (r->>'aprovacao_ate')::numeric = 1000 and (r->>'aprovacao_alto_acima')::numeric = 5000
    and (r->>'aprovacao_autor_pode_aprovar')::boolean and (r->>'recorrentes_dias')::int = 45 and not (r->>'salva')::boolean, 'padrão: ' || r::text;
  assert fin_aprovacao_nivel(L, 999999) = 0, 'desligada: nada exige aprovação';
  -- desligada: conta alta não exige e é paga normalmente
  t_off := pg_temp.titulo370(F1, 9000, '2026-11-20', '370-off');
  assert (select aprovacao = 'nao_exige' and aprovacao_nivel = 0 from fin_titulos_pagar where id = t_off), 'desligada = não exige';
  assert (pg_temp.pagar370(t_off, c1, '370-pg-off')->>'status') = 'pago', 'paga sem aprovação';
  perform pg_temp.erro370(format('select fin_config_salvar(%s, %L)', L, '{"aprovacao_ativa":true,"aprovacao_ate":"6000","aprovacao_alto_acima":"5000"}'), 'não pode ser menor');
  perform pg_temp.erro370(format('select fin_config_salvar(%s, %L)', L, '{"recorrentes_dias":"0"}'), '1 a 366');
  perform pg_temp.erro370(format('select fin_config_salvar(%s, %L)', L, '{"aprovacao_ate":"-1"}'), 'negativ');
  perform pg_temp.erro370('select fin_config_salvar(5, ''{}''::jsonb)', 'estoque próprio');
  r := fin_config_salvar(L, '{"aprovacao_ativa":true,"aprovacao_ate":"1000","aprovacao_alto_acima":"5000","aprovacao_autor_pode_aprovar":false}'::jsonb, 'u-dono', 'Dono 370');
  assert (r->>'aprovacao_ativa')::boolean and (r->>'salva')::boolean and not (r->>'aprovacao_autor_pode_aprovar')::boolean, 'salvou: ' || r::text;
  assert exists (select 1 from fin_eventos where loja_id = L and entidade = 'config' and tipo = 'editada' and user_nome = 'Dono 370'), 'evento da config';
  assert (fin_aprovacao_nivel(L, 1000), fin_aprovacao_nivel(L, 1000.01), fin_aprovacao_nivel(L, 5000), fin_aprovacao_nivel(L, 5000.01)) = (0, 1, 1, 2), 'faixas';
  assert (select aprovacao from fin_titulos_pagar where id = t_off) = 'nao_exige', 'ligar não mexe nas contas que já existiam';

  -- ========== 2) aprovação na conta manual
  t_800 := pg_temp.titulo370(F1, 800, '2026-11-20', '370-800');
  t_2000 := pg_temp.titulo370(F1, 2000, '2026-11-20', '370-2000');
  t_8000 := pg_temp.titulo370(F2, 8000, '2026-11-25', '370-8000');
  assert (select aprovacao from fin_titulos_pagar where id = t_800) = 'nao_exige', '800 não exige';
  assert (select (aprovacao, aprovacao_nivel) = ('pendente', 1::smallint) from fin_titulos_pagar where id = t_2000), '2000 = gerente';
  assert (select (aprovacao, aprovacao_nivel) = ('pendente', 2::smallint) from fin_titulos_pagar where id = t_8000), '8000 = admin/dono';
  assert exists (select 1 from fin_eventos where entidade = 'titulo_pagar' and entidade_id = t_2000 and tipo = 'aprovacao_exigida'), 'evento aprovação exigida';
  -- não paga antes de aprovar (e o pagamento recusado não deixa nada no extrato)
  v_cons := pg_temp.saldo370(c1);
  perform pg_temp.erro370(format('select pg_temp.pagar370(%s, %s, %L)', t_2000, c1, '370-pg-2000a'), 'aguardando aprovação');
  assert pg_temp.saldo370(c1) = v_cons and not exists (select 1 from fin_pagamentos where titulo_id = t_2000), 'nada gravado';
  -- regras de quem decide
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''aprovar'', 0, null, ''u-x'', ''X'')', L, t_2000), 'Sem permissão');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''aprovar'', 1, null, ''u-ger'', ''Gerente'')', L, t_8000), 'só admin/dono');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''aprovar'', 2, null, ''u-autor'', ''Autor'')', L, t_2000), 'Quem lançou');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''aprovar'', 1, null, ''u-ger'', ''Gerente'')', L, t_800), 'não está aguardando');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''reprovar'', 2, '' x '', ''u-dono'', ''Dono'')', L, t_8000), 'motivo');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''talvez'', 2, null, ''u-dono'', ''Dono'')', L, t_8000), 'inválida');
  -- gerente aprova o de 2000 → paga
  r := fin_titulo_aprovacao_decidir(L, t_2000, 'aprovar', 1, null, 'u-ger', 'Gerente 370');
  assert r->>'aprovacao' = 'aprovado' and not (r->>'duplicado')::boolean, 'aprovou';
  assert (fin_titulo_aprovacao_decidir(L, t_2000, 'aprovar', 1, null, 'u-ger', 'Gerente 370')->>'duplicado')::boolean, 'aprovar de novo = duplicado';
  assert (select aprovacao_por_nome = 'Gerente 370' and aprovacao_em is not null and aprovacao_nivel_aprovado = 1 from fin_titulos_pagar where id = t_2000), 'quem/quando';
  assert exists (select 1 from fin_eventos where entidade = 'titulo_pagar' and entidade_id = t_2000 and tipo = 'aprovada' and user_nome = 'Gerente 370'), 'evento aprovada';
  assert (pg_temp.pagar370(t_2000, c1, '370-pg-2000b')->>'status') = 'pago', 'aprovada paga';
  -- dono reprova o de 8000 com motivo → não paga, valor não muda, cancela
  r := fin_titulo_aprovacao_decidir(L, t_8000, 'reprovar', 2, 'Orçamento acima do combinado', 'u-dono', 'Dono 370');
  assert r->>'aprovacao' = 'reprovado', 'reprovou';
  assert (select aprovacao_motivo = 'Orçamento acima do combinado' and aprovacao_por = 'u-dono' from fin_titulos_pagar where id = t_8000), 'motivo gravado';
  assert exists (select 1 from fin_eventos where entidade_id = t_8000 and entidade = 'titulo_pagar' and tipo = 'reprovada'
                 and detalhe->>'motivo' = 'Orçamento acima do combinado'), 'evento reprovada com motivo';
  perform pg_temp.erro370(format('select pg_temp.pagar370(%s, %s, %L)', t_8000, c1, '370-pg-8000'), 'reprovada');
  perform pg_temp.erro370(format('select fin_titulo_pagar_salvar(%s, %s, %L)', L, t_8000,
    jsonb_build_object('fornecedor_id', F2, 'valor', '7000', 'data_vencimento', '2026-11-25')), 'reprovada');
  perform pg_temp.erro370(format('select fin_titulo_aprovacao_decidir(%s, %s, ''aprovar'', 2, null, ''u-dono'', ''Dono'')', L, t_8000), 'não está aguardando');
  assert (fin_titulo_pagar_cancelar(L, t_8000, 'Reprovada', 'u-dono', 'Dono')->>'ok')::boolean, 'reprovada pode ser cancelada';
  -- mudou o valor: aprovada só volta se subir de faixa; pendente recalcula
  t_6000 := pg_temp.titulo370(F1, 3000, '2026-11-28', '370-3000');
  perform fin_titulo_aprovacao_decidir(L, t_6000, 'aprovar', 1, null, 'u-ger', 'Gerente 370');
  perform fin_titulo_pagar_salvar(L, t_6000, jsonb_build_object('fornecedor_id', F1, 'valor', '4000', 'data_vencimento', '2026-11-28'));
  assert (select aprovacao from fin_titulos_pagar where id = t_6000) = 'aprovado', 'mesma faixa: segue aprovada';
  perform fin_titulo_pagar_salvar(L, t_6000, jsonb_build_object('fornecedor_id', F1, 'valor', '6000', 'data_vencimento', '2026-11-28'));
  assert (select (aprovacao, aprovacao_nivel, aprovacao_nivel_aprovado) is not distinct from ('pendente', 2::smallint, null::smallint) from fin_titulos_pagar where id = t_6000), 'subiu de faixa: volta';
  assert exists (select 1 from fin_eventos where entidade_id = t_6000 and entidade = 'titulo_pagar' and tipo = 'aprovacao_recalculada'), 'evento recalculada';
  perform fin_titulo_pagar_salvar(L, t_6000, jsonb_build_object('fornecedor_id', F1, 'valor', '900', 'data_vencimento', '2026-11-28'));
  assert (select (aprovacao, aprovacao_nivel) = ('nao_exige', 0::smallint) from fin_titulos_pagar where id = t_6000), 'pendente que caiu abaixo de X';
  -- listagem das pendentes
  t := pg_temp.titulo370(F2, 1500, '2026-11-29', '370-1500');
  assert exists (select 1 from jsonb_array_elements(fin_titulos_aprovacao_listar(L)) e where (e->>'id')::bigint = t), 'lista pendentes';
  assert not exists (select 1 from jsonb_array_elements(fin_titulos_aprovacao_listar(L)) e where (e->>'id')::bigint in (t_2000, t_8000, t_800)), 'só pendentes não canceladas';
  assert exists (select 1 from jsonb_array_elements(fin_titulos_aprovacao_listar(L, 'decididas')) e where (e->>'id')::bigint = t_2000), 'decididas';
  -- autor pode aprovar quando a config deixa
  perform fin_config_salvar(L, '{"aprovacao_autor_pode_aprovar":true}'::jsonb, 'u-dono', 'Dono 370');
  assert (fin_titulo_aprovacao_decidir(L, t, 'aprovar', 1, null, 'u-autor', 'Autor')->>'aprovacao') = 'aprovado', 'autor aprova com a config';

  -- ========== 3) aprovação na conta gerada pela nota de entrada (gatilho da 340/360)
  v_nota := pg_temp.nota370('370001', '2026-11-04', 3000, jsonb_build_array(jsonb_build_object('linha', 1, 'c_prod', 'P1',
    'descricao', 'ITEM 370', 'quantidade', 1, 'valor_unitario', 3000, 'valor_total', 3000, 'codigo_produto', A, 'fator', 1)));
  select * into x from fin_titulos_pagar where loja_id = L and origem_tipo = 'nota_entrada' and origem_id = v_nota;
  assert found, 'a nota gerou a conta';
  assert x.aprovacao = 'pendente' and x.aprovacao_nivel = 1, 'conta da nota aguardando aprovação: ' || x.aprovacao;
  perform pg_temp.erro370(format('select pg_temp.pagar370(%s, %s, %L)', x.id, c1, '370-pg-nota'), 'aguardando aprovação');
  perform fin_titulo_aprovacao_decidir(L, x.id, 'aprovar', 1, null, 'u-ger', 'Gerente 370');
  assert (pg_temp.pagar370(x.id, c1, '370-pg-nota2')->>'status') = 'pago', 'conta da nota aprovada paga';

  -- ========== 4) recorrentes
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Aluguel', 'fornecedor_id', F1,
    'valor', '3500', 'periodicidade', 'mensal', 'dia', 32, 'data_inicio', '2026-11-01')), '1 a 31');
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Gás', 'fornecedor_id', F1,
    'valor', '200', 'periodicidade', 'semanal', 'dia', 8, 'data_inicio', '2026-11-01')), 'dia da semana');
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Aluguel', 'fornecedor_id', F1,
    'valor', '3500', 'dia', 5, 'data_inicio', '2026-11-01', 'data_fim', '2026-10-01')), 'fim');
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Aluguel', 'fornecedor_id', F1,
    'valor', '3500', 'dia', 5, 'data_inicio', '2026-11-01', 'categoria_id', v_rec)), 'despesa');
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Aluguel', 'fornecedor_id', F_OUTRA,
    'valor', '3500', 'dia', 5, 'data_inicio', '2026-11-01')), 'fornecedor');
  perform pg_temp.erro370(format('select fin_recorrente_salvar(%s, null, %L)', L, jsonb_build_object('descricao', 'Aluguel', 'fornecedor_id', F1,
    'valor', '0', 'dia', 5, 'data_inicio', '2026-11-01')), 'valor');
  rec_m := (fin_recorrente_salvar(L, null, jsonb_build_object('descricao', 'Aluguel 370', 'fornecedor_id', F1, 'categoria_id', v_alug,
    'valor', '3500', 'periodicidade', 'mensal', 'dia', 10, 'data_inicio', '2026-11-01'), 'u-autor', 'Autor 370')->>'id')::bigint;
  rec_s := (fin_recorrente_salvar(L, null, jsonb_build_object('descricao', 'Gás 370', 'fornecedor_id', F2, 'categoria_id', v_ener,
    'valor', '200', 'valor_estimado', true, 'periodicidade', 'semanal', 'dia', 1, 'data_inicio', '2026-11-01'), 'u-autor', 'Autor 370')->>'id')::bigint;
  rec_31 := (fin_recorrente_salvar(L, null, jsonb_build_object('descricao', 'Internet 370', 'fornecedor_id', F1, 'valor', '150',
    'dia', 31, 'data_inicio', '2026-11-01'))->>'id')::bigint;
  rec_fim := (fin_recorrente_salvar(L, null, jsonb_build_object('descricao', 'Contrato curto 370', 'fornecedor_id', F1, 'valor', '100',
    'dia', 15, 'data_inicio', '2026-11-01', 'data_fim', '2026-11-30'))->>'id')::bigint;
  assert exists (select 1 from fin_eventos where entidade = 'recorrente' and entidade_id = rec_m and tipo = 'criada'), 'evento criada';
  -- datas (mesmos casos de lib/financeiro/recorrentes-puro.test.ts)
  assert array(select fin_recorrente_datas('mensal', 31, '2026-01-01', null, '2027-01-15', '2027-04-30')) = '{2027-01-31,2027-02-28,2027-03-31,2027-04-30}'::date[], 'dia 31';
  assert array(select fin_recorrente_datas('mensal', 29, '2026-01-01', null, '2028-02-01', '2028-02-29')) = '{2028-02-29}'::date[], 'bissexto';
  assert array(select fin_recorrente_datas('semanal', 1, '2026-11-01', null, '2026-11-05', '2026-11-30')) = '{2026-11-09,2026-11-16,2026-11-23,2026-11-30}'::date[], 'segundas';
  assert array(select fin_recorrente_datas('semanal', 7, '2026-11-01', null, '2026-11-05', '2026-11-16')) = '{2026-11-08,2026-11-15}'::date[], 'domingos';
  assert array(select fin_recorrente_datas('mensal', 5, '2026-01-01', '2027-01-05', '2026-11-01', '2027-03-01')) = '{2026-11-05,2026-12-05,2027-01-05}'::date[], 'fim corta';
  assert not exists (select fin_recorrente_datas('mensal', 5, '2026-12-01', '2026-11-01', '2026-01-01', '2027-01-01')), 'fim antes do início';
  -- gerador: 05/11 + 45 dias = 20/12
  select count(*) into n15 from fin_titulos_pagar where loja_id = 15;
  r := fin_recorrentes_gerar(null, 45, '2026-11-05');
  assert (select count(*) from fin_titulos_pagar where loja_id = 15) = n15, 'gerador não toca a ODARA';
  assert not exists (select 1 from jsonb_array_elements(r->'lojas') e where (e->>'loja_id')::int = 4), 'nunca a loja 4';
  assert (select (e->>'gerados')::int from jsonb_array_elements(r->'lojas') e where (e->>'loja_id')::int = L) = 2 + 6 + 1 + 1, 'gerados: ' || r::text;
  assert array(select o.data_vencimento from fin_recorrentes_ocorrencias o where o.recorrente_id = rec_m order by 1) = '{2026-11-10,2026-12-10}'::date[], 'aluguel';
  assert array(select o.data_vencimento from fin_recorrentes_ocorrencias o where o.recorrente_id = rec_31 order by 1) = '{2026-11-30}'::date[], 'dia 31 em novembro';
  assert array(select o.data_vencimento from fin_recorrentes_ocorrencias o where o.recorrente_id = rec_fim order by 1) = '{2026-11-15}'::date[], 'respeita o fim';
  for x in select tp.* from fin_recorrentes_ocorrencias o join fin_titulos_pagar tp on tp.id = o.titulo_id where o.recorrente_id = rec_m loop
    assert x.origem_tipo = 'recorrente' and x.valor = 3500 and x.categoria_id = v_alug and x.data_competencia = date_trunc('month', x.data_vencimento)::date
      and x.aprovacao = 'pendente' and x.aprovacao_nivel = 1 and not x.valor_a_confirmar, 'conta do aluguel: ' || row_to_json(x)::text;
  end loop;
  assert (select bool_and(tp.valor_a_confirmar and tp.aprovacao = 'nao_exige') and count(*) = 6
          from fin_recorrentes_ocorrencias o join fin_titulos_pagar tp on tp.id = o.titulo_id where o.recorrente_id = rec_s), 'gás: valor a confirmar';
  -- idempotente
  r := fin_recorrentes_gerar(L, 45, '2026-11-05');
  assert (r->'lojas'->0->>'gerados')::int = 0, 'rodar de novo não duplica';
  -- valor estimado: não paga antes de confirmar
  select tp.id into t from fin_recorrentes_ocorrencias o join fin_titulos_pagar tp on tp.id = o.titulo_id
    where o.recorrente_id = rec_s order by o.data_vencimento limit 1;
  perform pg_temp.erro370(format('select pg_temp.pagar370(%s, %s, %L)', t, c1, '370-pg-gas'), 'Confirme o valor');
  perform pg_temp.erro370(format('select fin_titulo_valor_confirmar(%s, %s, ''0'')', L, t), 'maior que zero');
  r := fin_titulo_valor_confirmar(L, t, '231.40', 'u-autor', 'Autor 370');
  assert (r->>'valor')::numeric = 231.40 and (select not valor_a_confirmar from fin_titulos_pagar where id = t), 'confirmou: ' || r::text;
  assert (fin_titulo_valor_confirmar(L, t, '231.40')->>'duplicado')::boolean, 'confirmar de novo = duplicado';
  assert exists (select 1 from fin_eventos where entidade = 'titulo_pagar' and entidade_id = t and tipo = 'valor_confirmado'), 'evento';
  assert (pg_temp.pagar370(t, c1, '370-pg-gas2')->>'status') = 'pago', 'confirmado paga';
  -- conta cancelada não volta; horizonte maior gera só o que falta; inativa não gera
  select o.titulo_id into t from fin_recorrentes_ocorrencias o where o.recorrente_id = rec_m and o.data_vencimento = '2026-12-10';
  perform fin_titulo_pagar_cancelar(L, t, 'Pago por fora', 'u-autor', 'Autor');
  perform fin_recorrente_salvar(L, rec_31, jsonb_build_object('descricao', 'Internet 370', 'fornecedor_id', F1, 'valor', '150', 'dia', 31,
    'data_inicio', '2026-11-01', 'ativa', false));
  r := fin_recorrentes_gerar(L, 90, '2026-11-05'); -- até 03/02/2027
  assert array(select o.data_vencimento from fin_recorrentes_ocorrencias o where o.recorrente_id = rec_m order by 1) = '{2026-11-10,2026-12-10,2027-01-10}'::date[], 'cancelada não volta, janeiro entra';
  assert (select status from fin_titulos_pagar where id = t) = 'cancelado', 'a cancelada fica cancelada';
  assert (select count(*) from fin_recorrentes_ocorrencias where recorrente_id = rec_31) = 1, 'inativa não gera';
  -- falha numa recorrente não para as outras (fornecedor de outra loja gravado à força)
  rec_ruim := (fin_recorrente_salvar(L, null, jsonb_build_object('descricao', 'Ruim 370', 'fornecedor_id', F1, 'valor', '50', 'dia', 20,
    'data_inicio', '2026-11-01'))->>'id')::bigint;
  update fin_recorrentes set fornecedor_id = F_OUTRA where id = rec_ruim;
  perform fin_recorrente_salvar(L, rec_fim, jsonb_build_object('descricao', 'Contrato curto 370', 'fornecedor_id', F1, 'valor', '100', 'dia', 15,
    'data_inicio', '2026-11-01', 'data_fim', '2026-12-31'));
  r := fin_recorrentes_gerar(L, 45, '2026-11-05');
  assert (r->'lojas'->0->>'falhas')::int = 2 and (r->'lojas'->0->>'gerados')::int = 1, 'uma falha, as outras seguem: ' || r::text;
  assert not exists (select 1 from fin_recorrentes_ocorrencias where recorrente_id = rec_ruim), 'falha não deixa ocorrência';
  assert (select count(*) from fin_eventos where entidade = 'recorrente' and entidade_id = rec_ruim and tipo = 'geracao_falha') = 1, 'um evento de falha por rodada';
  assert exists (select 1 from jsonb_array_elements(fin_recorrentes_listar(L)) e where (e->>'id')::bigint = rec_ruim and e->>'ultima_falha' is not null), 'lista mostra a falha';
  assert (select (e->>'geradas')::int from jsonb_array_elements(fin_recorrentes_listar(L)) e where (e->>'id')::bigint = rec_m) = 3, 'lista conta as geradas';
  perform pg_temp.erro370('select fin_recorrentes_gerar(4)', 'Loja 4');
  perform pg_temp.erro370('select fin_recorrentes_gerar(5)', 'estoque próprio');

  -- ========== 5) lançamento avulso
  v_cons := pg_temp.saldo370(c2);
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, null)', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '10', 'descricao', 'x x', 'categoria_id', v_ener)), 'Chave');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a1'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '10', 'descricao', 'Gás', 'categoria_id', v_rec)), 'despesa');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a2'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'entrada', 'valor', '10', 'descricao', 'Venda', 'categoria_id', v_ener)), 'receita');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a3'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '10', 'descricao', 'Gás')), 'categoria');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a4'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '10', 'descricao', 'Gás', 'categoria_id', v_ener, 'data', fin_hoje() + 1)), 'futura');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a5'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '10', 'descricao', 'Gás', 'categoria_id', v_ener, 'data', '2026-10-31')), 'saldo inicial');
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''a6'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '0', 'descricao', 'Gás', 'categoria_id', v_ener)), 'maior que zero');
  r := fin_lancamento_avulso_registrar(L, jsonb_build_object('conta_id', c2, 'tipo', 'entrada', 'valor', '500', 'descricao', 'Venda de sucata', 'categoria_id', v_rec, 'data', '2026-11-03'), 'u-fin', 'Fin 370', '370-av-1');
  v_lanc := (r->>'id')::bigint;
  assert pg_temp.saldo370(c2) = v_cons + 500, 'entrada no saldo';
  assert (fin_lancamento_avulso_registrar(L, jsonb_build_object('conta_id', c2, 'tipo', 'entrada', 'valor', '500', 'descricao', 'Venda de sucata', 'categoria_id', v_rec, 'data', '2026-11-03'), 'u-fin', 'Fin 370', '370-av-1')->>'duplicado')::boolean, 'mesma chave = duplicado';
  perform pg_temp.erro370(format('select fin_lancamento_avulso_registrar(%s, %L, null, null, ''370-av-1'')', L, jsonb_build_object('conta_id', c2, 'tipo', 'entrada', 'valor', '600', 'descricao', 'Venda de sucata', 'categoria_id', v_rec, 'data', '2026-11-03')), 'outros dados');
  r := fin_lancamento_avulso_registrar(L, jsonb_build_object('conta_id', c2, 'tipo', 'saida', 'valor', '120.50', 'descricao', 'Gás de cozinha', 'categoria_id', v_ener), 'u-fin', 'Fin 370', '370-av-2');
  assert pg_temp.saldo370(c2) = v_cons + 379.50, 'saída no saldo';
  assert (select origem_tipo = 'manual' and categoria_id = v_ener from fin_lancamentos where id = (r->>'id')::bigint), 'lançamento manual com categoria';
  perform pg_temp.erro370(format('select fin_lancamento_avulso_estornar(%s, %s, ''x'')', L, v_lanc), 'motivo');
  r := fin_lancamento_avulso_estornar(L, v_lanc, 'Lançado errado', 'u-fin', 'Fin 370');
  assert pg_temp.saldo370(c2) = v_cons - 120.50, 'estorno tira a entrada';
  assert (select tipo = 'saida' and origem_tipo = 'estorno_manual' and estorno_de = v_lanc and data = fin_hoje() from fin_lancamentos where id = (r->>'id')::bigint), 'estorno ligado';
  assert (fin_lancamento_avulso_estornar(L, v_lanc, 'De novo', 'u-fin', 'Fin 370')->>'duplicado')::boolean, 'estornar de novo = duplicado';
  assert exists (select 1 from fin_eventos where entidade = 'lancamento' and entidade_id = v_lanc and tipo = 'avulso_estornado' and detalhe->>'motivo' = 'Lançado errado'), 'evento do estorno';
  select lancamento_id into v_lanc from fin_pagamentos where titulo_id = t_2000;
  perform pg_temp.erro370(format('select fin_lancamento_avulso_estornar(%s, %s, ''Tentativa'')', L, v_lanc), 'Só lançamento avulso');

  -- ========== 6) transferência entre contas: os dois lados se anulam no consolidado
  v_cons := pg_temp.consolidado370();
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, ''tr0'')', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c1, 'valor', '10')), 'mesma conta');
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, ''tr1'')', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '-5')), 'Valor numérico inválido|maior que zero');
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, ''tr2'')', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '10', 'data', fin_hoje() + 1)), 'futura');
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, null)', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '10')), 'Chave');
  n := (select count(*) from fin_lancamentos where loja_id = L);
  r := fin_transferencia_registrar(L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '1000', 'descricao', 'Troco do caixa'), 'u-fin', 'Fin 370', '370-tr-1');
  v_tr := (r->>'id')::bigint;
  assert (select count(*) from fin_lancamentos where loja_id = L) = n + 2, 'dois lançamentos';
  assert (select count(*) = 2 and count(*) filter (where tipo = 'saida' and conta_id = c1) = 1 and count(*) filter (where tipo = 'entrada' and conta_id = c2) = 1
            and bool_and(categoria_id is null and valor = 1000)
          from fin_lancamentos where origem_tipo = 'transferencia' and origem_id = v_tr), 'saída na origem, entrada no destino, sem categoria';
  assert pg_temp.consolidado370() = v_cons, 'consolidado não muda com a transferência';
  assert (fin_transferencia_registrar(L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '1000', 'descricao', 'Troco do caixa'), 'u-fin', 'Fin 370', '370-tr-1')->>'duplicado')::boolean, 'mesma chave = duplicado';
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, ''370-tr-1'')', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '999')), 'outros dados');
  begin update fin_transferencias set valor = 1 where id = v_tr; raise exception 'transferência editável';
  exception when sqlstate '55000' then null; end;
  begin update fin_lancamentos set valor = 1 where origem_tipo = 'transferencia' and origem_id = v_tr; raise exception 'lançamento editável';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.erro370(format('select fin_transferencia_estornar(%s, %s, '''')', L, v_tr), 'motivo');
  r := fin_transferencia_estornar(L, v_tr, 'Conta errada', 'u-fin', 'Fin 370');
  assert pg_temp.consolidado370() = v_cons, 'consolidado não muda com o estorno';
  assert (select count(*) = 2 and bool_and(estorno_de is not null and data = fin_hoje())
          from fin_lancamentos where origem_tipo = 'estorno_transferencia' and origem_id = v_tr), 'dois estornos ligados';
  assert (select estornada_em is not null and motivo_estorno = 'Conta errada' and estornada_por_nome = 'Fin 370' from fin_transferencias where id = v_tr), 'marcada';
  assert (fin_transferencia_estornar(L, v_tr, 'De novo', 'u-fin', 'Fin 370')->>'duplicado')::boolean, 'estornar de novo = duplicado';
  -- conta inativa não recebe transferência
  perform fin_conta_salvar(L, c2, jsonb_build_object('nome', 'Caixa 370', 'tipo', 'caixa', 'saldo_inicial', '0', 'data_saldo_inicial', '2026-11-01', 'ativa', false));
  perform pg_temp.erro370(format('select fin_transferencia_registrar(%s, %L, null, null, ''tr9'')', L, jsonb_build_object('conta_origem_id', c1, 'conta_destino_id', c2, 'valor', '10')), 'inativa');
  r := fin_avulsos_transferencias_listar(L);
  assert jsonb_array_length(r->'avulsos') = 2 and jsonb_array_length(r->'transferencias') = 1, 'listagem: ' || r::text;
  assert exists (select 1 from jsonb_array_elements(r->'avulsos') e where e->>'estorno_id' is not null), 'listagem mostra o estorno';
  -- o check novo de fin_lancamentos: estorno sempre ligado
  begin
    insert into fin_lancamentos (loja_id, conta_id, data, tipo, valor, origem_tipo) values (L, c1, fin_hoje(), 'entrada', 1, 'estorno_manual');
    raise exception 'estorno sem estorno_de aceito';
  exception when check_violation then null; end;

  -- ========== 7) segurança e permissões
  assert not has_function_privilege('authenticated', 'fin_titulo_aprovacao_decidir(bigint,bigint,text,int,text,text,text)', 'execute'), 'sem grant authenticated';
  assert not has_function_privilege('anon', 'fin_recorrentes_gerar(bigint,int,date)', 'execute'), 'sem grant anon';
  assert has_function_privilege('service_role', 'fin_transferencia_registrar(bigint,jsonb,text,text,text)', 'execute'), 'service_role chama';
  assert not has_table_privilege('authenticated', 'fin_recorrentes', 'select'), 'tabela sem grant authenticated';
  assert not has_table_privilege('anon', 'fin_transferencias', 'select'), 'tabela sem grant anon';
  assert (select count(*) from permissoes where nome in ('Financeiro - Aprovar pagamento', 'Financeiro - Aprovar pagamento alto valor',
    'Financeiro - Configurar aprovacao', 'Financeiro - Contas recorrentes', 'Financeiro - Lancamentos e transferencias')) = 5, 'permissões';
  assert (select count(*) from cargo_permissao cp join cargos c on c.id = cp.cargo_id join permissoes p on p.id = cp.permissao_id
          where c.nome = 'Gerente' and p.nome in ('Financeiro - Aprovar pagamento', 'Financeiro - Contas recorrentes')) = 2, 'Gerente (371)';
  assert not exists (select 1 from cargo_permissao cp join permissoes p on p.id = cp.permissao_id
          where p.nome in ('Financeiro - Aprovar pagamento alto valor', 'Financeiro - Configurar aprovacao', 'Financeiro - Lancamentos e transferencias')), 'só admin';
  raise notice '370 APROVACAO RECORRENTES LANCAMENTOS OK';
end $$;
