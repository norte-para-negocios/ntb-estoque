-- Teste da migration 311 (revisões de custo + visão efetiva). Roda numa CÓPIA local (Postgres 17, pg_dump --schema-only
-- da produção + roles do Supabase), nunca em produção. Tudo dentro de BEGIN … ROLLBACK:
--   psql -v ON_ERROR_STOP=1 -U supabase_admin -d <copia> <<'SQL'
--   begin;
--   \i supabase/migrations/311_custo_revisao.sql
--   \i scripts/testes-sql/311_custo_revisao.sql
--   rollback;
--   SQL
-- Espera: NOTICE "311 CUSTO REVISAO OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values
  (99311, '00000000099311', 'TESTE 311', true, 'proprio'),
  (99312, '00000000099312', 'TESTE 311 OUTRA', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99311, 8000000031101, 'Geral', 'S'), (99312, 8000000031201, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99311, 8000000031111, '90311', 'Arroz 311', 'KG', '00'),
  (99312, 8000000031211, '90312', 'Feijão 311', 'KG', '00');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000031101', 'u311@teste'), ('00000000-0000-0000-0000-000000031201', 'u312@teste');
insert into profiles (id, name, perfil) values
  ('00000000-0000-0000-0000-000000031101', 'Usuário 311', 'Usuario'), ('00000000-0000-0000-0000-000000031201', 'Usuário 312', 'Usuario');
insert into loja_user (loja_id, user_id) values (99311, '00000000-0000-0000-0000-000000031101'), (99312, '00000000-0000-0000-0000-000000031201');

do $$
declare L bigint := 8000000031101; P bigint := 8000000031111; r jsonb; v_id bigint; v_lote uuid := gen_random_uuid();
        e record; n int; msg text;
begin
  r := registrar_movimento(99311, L, P, 'ENT', 'TESTE311', 'e1', 10, 5.00, null, null, 0, null, null, '2026-10-10');
  v_id := (r->>'id')::bigint;
  perform registrar_movimento(99312, 8000000031201, 8000000031211, 'ENT', 'TESTE311', 'e2', 4, 2.00);

  -- 1) sem revisão: a visão devolve o movimento igual ao ledger
  select * into e from estoque_movimentos_efetivo where id = v_id;
  assert not e.revisado, 'sem revisão não pode aparecer revisado';
  assert e.custo_unitario = 5 and e.custo_original = 5 and e.cmc_apos = 5 and e.saldo_apos = 10 and e.saldo_total_apos = 10,
    'sem revisão os números são os do ledger';
  assert e.data_ref = '2026-10-10' and not e.custo_estimado, 'sem revisão a data é a do ledger';
  assert (select count(*) from estoque_movimentos_efetivo where loja_id = 99311) = (select count(*) from estoque_movimentos where loja_id = 99311),
    'a visão tem uma linha por movimento';

  -- 2) duas revisões: vale a última
  perform _revisar_movimento(v_id, v_lote, '2026-10-09', 4.00, 4.00, 10, 10, false, 'teste 1');
  perform _revisar_movimento(v_id, v_lote, '2026-10-08', 3.50, 3.60, 9, 11, true, 'teste 2');
  select * into e from estoque_movimentos_efetivo where id = v_id;
  assert e.revisado, 'com revisão aparece revisado';
  assert e.custo_unitario = 3.5 and e.cmc_apos = 3.6 and e.saldo_apos = 9 and e.saldo_total_apos = 11 and e.custo_estimado,
    'vale a última revisão: ' || row_to_json(e)::text;
  assert e.data_ref = '2026-10-08' and e.data_ref_original = '2026-10-10', 'data efetiva = a da última revisão';
  assert e.custo_original = 5, 'custo original continua o do ledger';
  assert e.quantidade = 10, 'quantidade nunca muda';
  assert e.motivo_revisao = 'teste 2' and e.revisado_em is not null, 'motivo e data da revisão';
  -- o ledger em si não mudou
  assert (select custo_unitario from estoque_movimentos where id = v_id) = 5, 'ledger intacto';

  -- 3) UPDATE / DELETE / TRUNCATE na revisão recusados
  begin
    update estoque_mov_revisao set custo_unitario = 1 where movimento_id = v_id;
    raise exception 'UPDATE deveria falhar';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg like '%append-only%', 'UPDATE recusado: ' || msg;
  end;
  begin
    delete from estoque_mov_revisao where movimento_id = v_id;
    raise exception 'DELETE deveria falhar';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg like '%append-only%', 'DELETE recusado: ' || msg;
  end;
  begin
    truncate estoque_mov_revisao;
    raise exception 'TRUNCATE deveria falhar';
  exception when others then
    get stacked diagnostics msg = message_text;
    assert msg like '%TRUNCATE não é permitido%', 'TRUNCATE recusado: ' || msg;
  end;

  -- 4) revisão em mês fechado é recusada (PF001)
  insert into estoque_periodo_fechado (loja_id, mes, fechado_por) values (99311, '2026-09-01', 'teste');
  begin
    perform _revisar_movimento(v_id, v_lote, '2026-09-30', 1, 1, 1, 1, false, 'mês fechado');
    raise exception 'revisão em mês fechado deveria falhar';
  exception when sqlstate 'PF001' then null;
  end;

  -- 5) revisão sem motivo é recusada
  begin
    perform _revisar_movimento(v_id, v_lote, '2026-10-08', 1, 1, 1, 1, false, ' ');
    raise exception 'revisão sem motivo deveria falhar';
  exception when sqlstate '22023' then null;
  end;

  -- 6) só funções escrevem: authenticated/service_role sem INSERT nem EXECUTE da função interna
  assert not has_table_privilege('authenticated', 'estoque_mov_revisao', 'insert'), 'authenticated não insere';
  assert not has_table_privilege('service_role', 'estoque_mov_revisao', 'insert'), 'service_role não insere';
  assert not has_function_privilege('authenticated', '_revisar_movimento(bigint,uuid,date,numeric,numeric,numeric,numeric,boolean,text)', 'execute'),
    'authenticated não executa _revisar_movimento';
  assert has_table_privilege('authenticated', 'estoque_movimentos_efetivo', 'select'), 'authenticated lê a visão';
  raise notice '311 parte 1 ok';
end $$;

-- 7) RLS: usuário de outra loja não vê o movimento nem a revisão; o da loja vê
grant select on estoque_movimentos, profiles, loja_user to authenticated;  -- como em produção (rollback desfaz)
set local role authenticated;
do $$ begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000031201', true); end $$;
do $$
begin
  assert (select count(*) from estoque_movimentos_efetivo where loja_id = 99311) = 0, 'outra loja não vê os movimentos';
  assert (select count(*) from estoque_mov_revisao) = 0, 'outra loja não vê as revisões';
  assert (select count(*) from estoque_movimentos_efetivo where loja_id = 99312) = 1, 'vê a própria loja';
end $$;
do $$ begin perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000031101', true); end $$;
do $$
begin
  assert (select count(*) from estoque_mov_revisao) = 2, 'a loja vê as 2 revisões dela';
  assert (select bool_and(revisado) from estoque_movimentos_efetivo where loja_id = 99311), 'a loja vê o movimento revisado';
end $$;
reset role;

do $$ begin raise notice '311 CUSTO REVISAO OK'; end $$;
