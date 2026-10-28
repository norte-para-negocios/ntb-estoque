-- Teste das migrations 305 + 306 (Financeiro A0, espelho do financeiro do Omie). Só em cópia local, nunca em produção.
-- Uso (banco local do container ntb-teste-sql, cópia com lojas/RLS, ex.: create database fa0 template fin1):
--   docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fa0 < supabase/migrations/305_omie_fin_espelho.sql
--   docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fa0 < supabase/migrations/306_omie_fin_funcoes.sql
--   docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d fa0 < scripts/testes-sql/305_306_omie_fin.sql
-- Roda numa transação e desfaz tudo no fim (rollback). Rerodável.
begin;
do $$
declare
  v_loja bigint; v_teste bigint; v_prop bigint; r jsonb; x record; e text; n bigint;
  t0 timestamptz := '2026-10-27 10:00:00-03'; mes date := '2026-10-01';
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE FIN OMIE A0', '00000000000951', 'omie') returning id into v_loja;
  insert into lojas (nome, cnpj, modo_estoque, is_test) values ('TESTE FIN OMIE A0 (teste)', '00000000000952', 'omie', true) returning id into v_teste;
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE FIN PROPRIA A0', '00000000000953', 'proprio') returning id into v_prop;

  -- 1. lojas recusadas: 4, teste, própria
  foreach n in array array[4::bigint, v_teste, v_prop] loop
    begin perform omie_fin_gravar_titulos(n, '[]'::jsonb); raise exception 'aceitou a loja %', n;
    exception when sqlstate '22023' then get stacked diagnostics e = message_text; if e not like '%não permitida%' then raise exception 'motivo errado: %', e; end if; end;
    begin perform omie_fin_gravar_baixas(n, '[]'::jsonb); raise exception 'baixa aceitou a loja %', n; exception when sqlstate '22023' then null; end;
    begin perform omie_fin_gravar_lancamentos_cc(n, '[]'::jsonb); raise exception 'lançamento aceitou a loja %', n; exception when sqlstate '22023' then null; end;
  end loop;

  -- 2. rateio chega ANTES do título: linha mínima com as categorias
  r := omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P', 'so_rateio', true,
         'categorias', '[{"codigo_categoria":"2.01.72","valor":60,"percentual":60},{"codigo_categoria":"2.01.80","valor":40,"percentual":40}]'::jsonb,
         'categorias_em', t0, 'fonte_em', t0, 'origem_dado', 'rateio', 'webhook_id', 1)));
  if (r->>'rateios')::int <> 1 then raise exception 'rateio não gravado: %', r; end if;
  select * into x from omie_fin_titulos where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.fonte_em is not null or x.origem_dado <> 'rateio' or jsonb_array_length(x.categorias) <> 2 then raise exception 'linha mínima errada: %', row_to_json(x); end if;

  -- 3. aviso do título (Incluido, a vencer) completa a linha e mantém o rateio
  r := omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P',
         'valor_documento', 100, 'data_vencimento', '2026-10-20', 'data_emissao', '2026-10-01', 'codigo_categoria', '2.01.72',
         'status_titulo', 'A VENCER', 'situacao', 'aberto', 'excluido', false, 'origem_dado', 'webhook', 'fonte_em', t0 + interval '1 min', 'webhook_id', 2)));
  if (r->>'gravados')::int <> 1 then raise exception 'título não gravado: %', r; end if;
  select * into x from omie_fin_titulos_atual where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.valor_aberto_atual <> 100 or x.resumo_atual or jsonb_array_length(x.categorias) <> 2 then raise exception 'após aviso: %', row_to_json(x); end if;

  -- 4. mesmo aviso de novo: idempotente (nada muda, nenhuma linha nova)
  perform omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P',
         'valor_documento', 100, 'status_titulo', 'A VENCER', 'situacao', 'aberto', 'excluido', false, 'origem_dado', 'webhook', 'fonte_em', t0 + interval '1 min', 'webhook_id', 2)));
  if (select count(*) from omie_fin_titulos where loja_id = v_loja) <> 1 then raise exception 'duplicou'; end if;

  -- 5. baixa parcial pelo aviso (60): sem resumo da API, o aberto é estimado pelas baixas
  r := omie_fin_gravar_baixas(v_loja, jsonb_build_array(jsonb_build_object('codigo_baixa', 900, 'natureza', 'P', 'codigo_lancamento_omie', 100,
         'data', '2026-10-15', 'data_cred', '2026-10-15', 'valor', 60, 'juros', 0, 'multa', 0, 'desconto', 0, 'tarifa', 1.5, 'cancelada', false,
         'origem_dado', 'webhook', 'fonte_em', t0 + interval '2 min', 'webhook_id', 3)));
  if (r->>'gravados')::int <> 1 then raise exception 'baixa não gravada'; end if;
  select * into x from omie_fin_titulos_atual where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.valor_aberto_atual <> 40 or x.qtd_baixas <> 1 then raise exception 'aberto estimado errado: %', x.valor_aberto_atual; end if;

  -- 6. leitura da API mais nova: resumo do Omie manda (aberto 45: houve juros), status e data de pagamento; rateio não some
  r := omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P',
         'valor_documento', 100, 'data_vencimento', '2026-10-20', 'data_pagamento', '2026-10-15', 'valor_pago', 60, 'valor_aberto', 45, 'liquidado', false,
         'resumo_em', t0 + interval '10 min', 'status_titulo', 'ATRASADO', 'situacao', 'parcial', 'excluido', false,
         'origem_dado', 'api', 'fonte_em', t0 + interval '10 min')));
  select * into x from omie_fin_titulos_atual where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.valor_aberto_atual <> 45 or not x.resumo_atual or x.situacao <> 'parcial' or x.webhook_id <> 2 or jsonb_array_length(x.categorias) <> 2 then
    raise exception 'após API: %', row_to_json(x);
  end if;
  -- a API não traz tarifa: a regravação da baixa pela API mantém a do aviso
  perform omie_fin_gravar_baixas(v_loja, jsonb_build_array(jsonb_build_object('codigo_baixa', 900, 'natureza', 'P', 'codigo_lancamento_omie', 100,
         'data', '2026-10-15', 'valor', 60, 'codigo_mov_cc', 777, 'cancelada', false, 'origem_dado', 'api', 'fonte_em', t0 + interval '10 min')));
  select * into x from omie_fin_baixas where loja_id = v_loja and codigo_baixa = 900;
  if x.tarifa <> 1.5 or x.codigo_mov_cc <> 777 or x.origem_dado <> 'api' then raise exception 'baixa API: %', row_to_json(x); end if;

  -- 7. aviso ATRASADO (mais velho que a API) processado depois: não desfaz
  r := omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P',
         'valor_documento', 999, 'status_titulo', 'A VENCER', 'situacao', 'aberto', 'excluido', false, 'origem_dado', 'webhook', 'fonte_em', t0 + interval '5 min', 'webhook_id', 4)));
  if (r->>'gravados')::int <> 0 then raise exception 'aviso velho regravou'; end if;
  if (select valor_documento from omie_fin_titulos where loja_id = v_loja and codigo_lancamento_omie = 100) <> 100 then raise exception 'valor mudou'; end if;
  -- rateio velho também não volta por cima de rateio novo
  perform omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P', 'so_rateio', true,
         'categorias', '[{"codigo_categoria":"9.99","valor":100,"percentual":100}]'::jsonb, 'categorias_em', t0 - interval '1 h', 'fonte_em', t0 - interval '1 h', 'origem_dado', 'rateio')));
  if (select categorias->0->>'codigo_categoria' from omie_fin_titulos where loja_id = v_loja and codigo_lancamento_omie = 100) <> '2.01.72' then raise exception 'rateio velho venceu'; end if;

  -- 8. baixa cancelada (aviso mais novo): o aberto volta a ser estimado sem ela; a API velha não "descancela"
  perform omie_fin_gravar_baixas(v_loja, jsonb_build_array(jsonb_build_object('codigo_baixa', 900, 'natureza', 'P', 'codigo_lancamento_omie', 100,
         'valor', 60, 'cancelada', true, 'origem_dado', 'webhook', 'fonte_em', t0 + interval '20 min', 'webhook_id', 5)));
  perform omie_fin_gravar_baixas(v_loja, jsonb_build_array(jsonb_build_object('codigo_baixa', 900, 'natureza', 'P', 'valor', 60, 'cancelada', false,
         'origem_dado', 'api', 'fonte_em', t0 + interval '15 min')));
  select * into x from omie_fin_titulos_atual where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.resumo_atual or x.valor_aberto_atual <> 100 or x.qtd_baixas <> 0 then raise exception 'após cancelar: % %', x.resumo_atual, x.valor_aberto_atual; end if;
  if not (select cancelada from omie_fin_baixas where loja_id = v_loja and codigo_baixa = 900) then raise exception 'descancelou'; end if;

  -- 9. título excluído: some do aberto, a linha fica
  perform omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 100, 'natureza', 'P', 'excluido', true,
         'origem_dado', 'webhook', 'fonte_em', t0 + interval '30 min', 'webhook_id', 6)));
  select * into x from omie_fin_titulos_atual where loja_id = v_loja and codigo_lancamento_omie = 100;
  if x.situacao_atual <> 'excluido' or x.valor_aberto_atual <> 0 or x.excluido_em is null or x.status_titulo <> 'ATRASADO' then raise exception 'excluído: %', row_to_json(x); end if;

  -- 10. lote com o mesmo título 2× é recusado; linha sem natureza também
  begin perform omie_fin_gravar_titulos(v_loja, '[{"codigo_lancamento_omie":1,"natureza":"P","origem_dado":"api","excluido":false},{"codigo_lancamento_omie":1,"natureza":"P","origem_dado":"api","excluido":false}]'::jsonb);
    raise exception 'aceitou repetido'; exception when sqlstate '22023' then null; end;
  begin perform omie_fin_gravar_titulos(v_loja, '[{"codigo_lancamento_omie":1,"origem_dado":"api"}]'::jsonb);
    raise exception 'aceitou sem natureza'; exception when sqlstate '22023' then null; end;
  begin perform omie_fin_gravar_baixas(v_loja, '[{"codigo_baixa":1,"natureza":"P"},{"codigo_baixa":1,"natureza":"P"}]'::jsonb);
    raise exception 'aceitou baixa repetida'; exception when sqlstate '22023' then null; end;

  -- 11. varredura de abertos: título aberto não visto nela (e sem mudança depois) vira candidato a conferir
  perform omie_fin_gravar_titulos(v_loja, jsonb_build_array(
    jsonb_build_object('codigo_lancamento_omie', 200, 'natureza', 'R', 'valor_documento', 50, 'valor_aberto', 50, 'valor_pago', 0, 'resumo_em', t0,
      'situacao', 'aberto', 'data_vencimento', '2026-10-01', 'excluido', false, 'origem_dado', 'api', 'fonte_em', t0),
    jsonb_build_object('codigo_lancamento_omie', 201, 'natureza', 'R', 'valor_documento', 30, 'valor_aberto', 30, 'valor_pago', 0, 'resumo_em', t0 + interval '2 h',
      'situacao', 'aberto', 'data_vencimento', '2026-11-30', 'excluido', false, 'visto_aberto_em', t0 + interval '2 h', 'origem_dado', 'api', 'fonte_em', t0 + interval '2 h'),
    jsonb_build_object('codigo_lancamento_omie', 202, 'natureza', 'P', 'valor_documento', 70, 'valor_aberto', 0, 'valor_pago', 70, 'resumo_em', t0,
      'situacao', 'liquidado', 'excluido', false, 'origem_dado', 'api', 'fonte_em', t0)));
  if (select array_agg(codigo_lancamento_omie order by 1) from omie_fin_abertos_nao_vistos(v_loja, t0 + interval '1 h', 10)) is distinct from array[200::bigint] then
    raise exception 'não vistos errados: %', (select array_agg(codigo_lancamento_omie) from omie_fin_abertos_nao_vistos(v_loja, t0 + interval '1 h', 10));
  end if;
  -- "visto aberto" grava mesmo quando a linha não é regravada (dado mais novo já gravado)
  perform omie_fin_gravar_titulos(v_loja, jsonb_build_array(jsonb_build_object('codigo_lancamento_omie', 200, 'natureza', 'R', 'excluido', false,
    'visto_aberto_em', t0 + interval '3 h', 'origem_dado', 'api', 'fonte_em', t0 - interval '1 h')));
  if exists (select 1 from omie_fin_abertos_nao_vistos(v_loja, t0 + interval '1 h', 10)) then raise exception 'visto não marcado'; end if;

  -- 12. lançamento de conta corrente: grava, idempotente, excluído
  r := omie_fin_gravar_lancamentos_cc(v_loja, jsonb_build_array(jsonb_build_object('n_cod_lanc', 55, 'tipo', 'lancamento', 'n_cod_cc', 9,
         'd_dt_lanc', '2026-10-06', 'n_valor_lanc', 600, 'c_cod_categ', '2.01.04', 'excluido', false, 'origem_dado', 'webhook', 'fonte_em', t0, 'webhook_id', 7)));
  if (r->>'gravados')::int <> 1 then raise exception 'lançamento não gravado'; end if;
  perform omie_fin_gravar_lancamentos_cc(v_loja, jsonb_build_array(jsonb_build_object('n_cod_lanc', 55, 'tipo', 'lancamento', 'excluido', true,
         'origem_dado', 'webhook', 'fonte_em', t0 + interval '1 min', 'webhook_id', 8)));
  select * into x from omie_fin_lancamentos_cc where loja_id = v_loja and n_cod_lanc = 55;
  if not x.excluido or x.n_valor_lanc <> 600 then raise exception 'lançamento excluído: %', row_to_json(x); end if;

  -- 13. conferência: a pagar em aberto 0 (o 100 foi excluído, o 202 pago); a receber 80 (vencido 50); baixas do mês: 0 (cancelada)
  perform omie_fin_gravar_baixas(v_loja, jsonb_build_array(jsonb_build_object('codigo_baixa', 901, 'natureza', 'P', 'codigo_lancamento_omie', 202,
         'data', '2026-10-10', 'valor', 70, 'cancelada', false, 'origem_dado', 'api', 'fonte_em', t0)));
  for x in select * from omie_fin_conferencia(mes, v_loja) loop
    if x.natureza = 'P' and (x.abertos_valor <> 0 or x.baixas_mes_valor <> 70 or x.baixas_mes_qtd <> 1) then raise exception 'conferência P: %', row_to_json(x); end if;
    if x.natureza = 'R' and (x.abertos_valor <> 80 or x.abertos_qtd <> 2 or x.vencidos_valor <> 50) then raise exception 'conferência R: %', row_to_json(x); end if;
  end loop;
  if (select count(*) from omie_fin_conferencia(mes, v_loja)) <> 2 then raise exception 'conferência sem as 2 naturezas'; end if;
  raise notice 'omie_fin: dados OK';
end $$;

-- 14. segurança: authenticated/anon não leem nem executam nada (dado sigiloso; só o servidor)
do $$ declare t text; f text; begin
  foreach t in array array['omie_fin_titulos', 'omie_fin_baixas', 'omie_fin_lancamentos_cc', 'omie_fin_categorias', 'omie_fin_dre',
                           'omie_fin_contas_correntes', 'omie_fin_titulos_atual'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'select') then
      raise exception '% legível por authenticated/anon', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') then raise exception '% sem service_role', t; end if;
  end loop;
  foreach t in array array['omie_fin_titulos', 'omie_fin_baixas', 'omie_fin_lancamentos_cc', 'omie_fin_categorias', 'omie_fin_dre', 'omie_fin_contas_correntes'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception '% sem RLS', t; end if;
    if not exists (select 1 from pg_policies where tablename = t and qual like '%( SELECT usuario_e_admin()%') then raise exception '% sem política initplan', t; end if;
  end loop;
  foreach f in array array['omie_fin_gravar_titulos(bigint,jsonb)', 'omie_fin_gravar_baixas(bigint,jsonb)', 'omie_fin_gravar_lancamentos_cc(bigint,jsonb)',
                           'omie_fin_abertos_nao_vistos(bigint,timestamptz,int)', 'omie_fin_conferencia(date,bigint)'] loop
    if has_function_privilege('authenticated', 'public.' || f, 'execute') or has_function_privilege('anon', 'public.' || f, 'execute') then
      raise exception '% executável por authenticated/anon', f; end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then raise exception '% sem service_role', f; end if;
  end loop;
  raise notice 'omie_fin: segurança OK';
end $$;

-- 15. como usuário logado (authenticated), a leitura direta falha
set local role authenticated;
do $$ begin
  perform 1 from omie_fin_titulos limit 1;
  raise exception 'authenticated leu omie_fin_titulos';
exception when insufficient_privilege then raise notice 'omie_fin: authenticated barrado OK';
end $$;
reset role;
rollback;
