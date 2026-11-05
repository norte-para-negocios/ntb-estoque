-- Teste da migration 308 (ledger blindado). Roda numa CÓPIA local (Postgres 17 em Docker, pg_dump --schema-only da
-- produção), nunca em produção. Tudo dentro de BEGIN … ROLLBACK:
--   psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres <<'SQL'
--   begin;
--   \i supabase/migrations/308_ledger_blindado.sql
--   \i scripts/testes-sql/308_ledger_blindado.sql
--   rollback;
--   SQL
-- Espera: NOTICE "LEDGER BLINDADO OK".
insert into lojas (id, cnpj, nome, ativo, modo_estoque) values (99308, '00000000099308', 'TESTE 308', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values (99308, 8000000030801, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99308, 8000000030901, '90308', 'Chopp 308', 'UN', '00');

do $$
declare r jsonb; r2 jsonb; n int; s numeric; msg text; L bigint := 8000000030801; P bigint := 8000000030901;
begin
  -- 1ª gravação
  r := registrar_movimento(99308, L, P, 'ENT', 'TESTE308', 'e1', 10, 5.00);
  assert (r->>'duplicado')::boolean = false, 'primeira gravação não é duplicado';

  -- repetido IGUAL = duplicado, mesmo id, saldo intacto
  r2 := registrar_movimento(99308, L, P, 'ENT', 'TESTE308', 'e1', 10, 5.00);
  assert (r2->>'duplicado')::boolean = true, 'repetido igual deveria ser duplicado';
  assert (r2->>'id') = (r->>'id'), 'duplicado devolve o mesmo id';
  select saldo into s from estoque_saldos where loja_id = 99308 and codigo_local_estoque = L and codigo_produto = P;
  assert s = 10, 'saldo depois do duplicado ' || s;

  -- repetido igual com casas além da escala da coluna (numeric 18,6) continua duplicado
  perform registrar_movimento(99308, L, P, 'SAI', 'TESTE308', 's1', 1.0000001);
  r2 := registrar_movimento(99308, L, P, 'SAI', 'TESTE308', 's1', 1.0000001);
  assert (r2->>'duplicado')::boolean = true, 'repetido igual (arredondado) deveria ser duplicado';

  -- repetido com OUTRA quantidade = conflito de idempotência (PF002), nada gravado
  begin
    perform registrar_movimento(99308, L, P, 'ENT', 'TESTE308', 'e1', 12, 5.00);
    assert false, 'outra quantidade deveria falhar';
  exception when sqlstate 'PF002' then
    get stacked diagnostics msg = message_text;
    assert msg like 'conflito de idempotência: TESTE308/e1 linha 0%já gravado com outra quantidade', 'mensagem: ' || msg;
  end;
  -- repetido com OUTRO tipo e mesma quantidade absoluta (ENT 10 x SAI 10) também é conflito
  begin
    perform registrar_movimento(99308, L, P, 'SAI', 'TESTE308', 'e1', 10);
    assert false, 'outro tipo deveria falhar';
  exception when sqlstate 'PF002' then null; end;
  select count(*) into n from estoque_movimentos where loja_id = 99308 and origem = 'TESTE308';
  assert n = 2, 'só os 2 movimentos originais no ledger, achou ' || n;
  select saldo into s from estoque_saldos where loja_id = 99308 and codigo_local_estoque = L and codigo_produto = P;
  assert abs(s - 9) < 0.000001, 'saldo depois dos conflitos ' || s;

  -- estorno continua funcionando; estornar de novo = mesma chave e mesma quantidade = duplicado (não devolve duas vezes)
  r2 := estornar_movimento((r->>'id')::bigint, 'teste', 'estorno 308');
  assert (r2->>'duplicado')::boolean = false, 'primeiro estorno grava';
  r2 := estornar_movimento((r->>'id')::bigint, 'teste', 'estorno 308');
  assert (r2->>'duplicado')::boolean = true, 'estorno repetido deveria ser duplicado';

  -- TRUNCATE recusado nas 3 tabelas (cascade para o gatilho disparar mesmo com FKs apontando para elas)
  begin
    truncate estoque_movimentos cascade;
    assert false, 'truncate estoque_movimentos deveria falhar';
  exception when sqlstate '55000' then
    get stacked diagnostics msg = message_text;
    assert msg like '%TRUNCATE não é permitido%', 'mensagem do truncate: ' || msg;
  end;
  begin
    truncate estoque_saldos cascade;
    assert false, 'truncate estoque_saldos deveria falhar';
  exception when sqlstate '55000' then null; end;
  begin
    truncate estoque_custos cascade;
    assert false, 'truncate estoque_custos deveria falhar';
  exception when sqlstate '55000' then null; end;
  select count(*) into n from estoque_movimentos where loja_id = 99308;
  assert n = 3, 'ledger intacto depois dos truncates, achou ' || n;

  -- escrita direta: service_role não grava mais em movimentos/custos; em saldos ainda grava (definirMinimo)
  assert not has_table_privilege('service_role', 'public.estoque_movimentos', 'INSERT'), 'service_role ainda insere em estoque_movimentos';
  assert not has_table_privilege('service_role', 'public.estoque_movimentos', 'TRUNCATE'), 'service_role ainda trunca estoque_movimentos';
  assert not has_table_privilege('service_role', 'public.estoque_custos', 'UPDATE'), 'service_role ainda altera estoque_custos';
  assert has_table_privilege('service_role', 'public.estoque_movimentos', 'SELECT'), 'service_role perdeu a leitura';
  assert has_table_privilege('service_role', 'public.estoque_saldos', 'UPDATE'), 'definirMinimo precisa de update em estoque_saldos';
  assert has_function_privilege('service_role', 'public.registrar_movimento(bigint,bigint,bigint,text,text,text,numeric,numeric,text,text,integer,bigint,text,date)', 'EXECUTE'),
    'service_role perdeu o execute de registrar_movimento';

  -- registrar_movimento continua gravando chamado como service_role (security definer)
  set local role service_role;
  r := registrar_movimento(99308, L, P, 'ENT', 'TESTE308', 'e2', 1, 5.00);
  assert (r->>'duplicado')::boolean = false, 'service_role grava pelo ledger';
  begin
    insert into estoque_movimentos (loja_id, codigo_local_estoque, codigo_produto, tipo, origem, ref, linha, quantidade)
    values (99308, L, P, 'ENT', 'TESTE308', 'direto', 0, 1);
    assert false, 'insert direto como service_role deveria falhar';
  exception when insufficient_privilege then null; end;
  reset role;

  raise notice 'LEDGER BLINDADO OK';
end $$;
