-- Teste da migration 318 (estoque_mov_revisao no canal do desktop). Roda numa CÓPIA local (Postgres 17, pg_dump
-- --schema-only da produção + desktop/schema/base.sql + auth.users), nunca em produção. Tudo dentro de BEGIN … ROLLBACK:
--   psql -v ON_ERROR_STOP=1 -U postgres -d <copia> <<'SQL'
--   begin;
--   \i scripts/testes-sql/318_offline_mov_revisao.sql
--   rollback;
--   SQL
-- O próprio arquivo aplica a 318 duas vezes (tem que ser reaplicável). Espera: NOTICE "318 OFFLINE MOV REVISAO OK".
set client_min_messages = warning;

-- estado de produção que o dump não traz (só estrutura): meta do canal e as linhas de offline_tabelas que importam
insert into offline_meta values ('ultimo_outbox', to_jsonb((select coalesce(max(id), 0) from outbox))), ('piso_versao', '0'::jsonb)
on conflict (chave) do nothing;
insert into offline_meta values ('triggers_criados', '["estoque_movimentos"]'::jsonb) on conflict (chave) do nothing;
insert into offline_tabelas (tabela, pk_cols, pk_tipos, regra, loja_col, pai_tabela, pai_fk, ocultas, modo) values
  ('estoque_movimentos', array['id'], array['bigint'], 'loja', 'loja_id', null, null, '{}', 'log'),
  ('vendas_proprio_itens', array['id'], array['bigint'], 'pai', null, 'vendas_proprio', 'venda_id', '{}', 'log')
on conflict (tabela) do nothing;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estoque_movimentos'::regclass and tgname = 'outbox_trigger') then
    create trigger outbox_trigger after insert or delete or update on public.estoque_movimentos for each row execute function outbox_capture();
  end if;
end $$;

\i supabase/migrations/318_offline_mov_revisao.sql
\i supabase/migrations/318_offline_mov_revisao.sql

insert into lojas (id, cnpj, nome, ativo, modo_estoque) values
  (99318, '00000000099318', 'TESTE 318', true, 'proprio'),
  (99319, '00000000099319', 'TESTE 318 OUTRA', true, 'proprio');
insert into local_estoques (loja_id, codigo_local_estoque, descricao, padrao) values
  (99318, 8000000031801, 'Geral', 'S'), (99319, 8000000031901, 'Geral', 'S');
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item) values
  (99318, 8000000031811, '90318', 'Arroz 318', 'KG', '00'),
  (99319, 8000000031911, '90319', 'Feijão 318', 'KG', '00');

set client_min_messages = notice;
do $$
declare r jsonb; v_mov bigint; v_mov2 bigint; v_rev bigint; v_rev2 bigint; v_lote uuid := gen_random_uuid(); n int; v record;
begin
  -- 1) allowlist e gatilho
  select * into v from offline_tabelas where tabela = 'estoque_mov_revisao';
  assert found and v.regra = 'pai' and v.pai_tabela = 'estoque_movimentos' and v.pai_fk = 'movimento_id'
         and v.pk_cols = array['id'] and v.pk_tipos = array['bigint'] and v.modo = 'log', 'linha de offline_tabelas: ' || row_to_json(v)::text;
  assert (select count(*) from pg_trigger where tgrelid = 'public.estoque_mov_revisao'::regclass and tgname = 'outbox_trigger') = 1,
    'um outbox_trigger em estoque_mov_revisao (reaplicar não duplica)';
  assert (select valor from offline_meta where chave = 'triggers_criados') ? 'estoque_mov_revisao', 'trigger registrado para reverter';
  assert (select count(*) from offline_meta m, jsonb_array_elements_text(m.valor) x where m.chave = 'triggers_criados' and x = 'estoque_mov_revisao') = 1,
    'registrado uma vez só';

  -- 2) movimento + revisão em duas lojas; a revisão passa pela outbox e o compactar acha a loja pelo movimento
  r := registrar_movimento(99318, 8000000031801, 8000000031811, 'ENT', 'TESTE318', 'e1', 10, 5.00);
  v_mov := (r->>'id')::bigint;
  r := registrar_movimento(99319, 8000000031901, 8000000031911, 'ENT', 'TESTE318', 'e2', 4, 2.00);
  v_mov2 := (r->>'id')::bigint;
  v_rev := _revisar_movimento(v_mov, v_lote, current_date, 4.00, 4.00, 10, 10, false, 'teste 318');
  v_rev2 := _revisar_movimento(v_mov2, v_lote, current_date, 1.50, 1.50, 4, 4, false, 'teste 318 outra');
  assert (select count(*) from outbox where table_name = 'estoque_mov_revisao' and operation = 'INSERT'
          and (row_data->>'id')::bigint in (v_rev, v_rev2)) = 2, 'as duas revisões entraram na outbox';

  perform offline_compactar();
  select * into v from offline_versoes where tabela = 'estoque_mov_revisao' and pk = jsonb_build_object('id', v_rev);
  assert found and v.loja_id = 99318 and not v.apagado, 'versão com a loja do movimento: ' || coalesce(row_to_json(v)::text, 'sem versão');
  assert (select loja_id from offline_versoes where tabela = 'estoque_mov_revisao' and pk = jsonb_build_object('id', v_rev2)) = 99319,
    'revisão da outra loja com a loja dela';
  -- os casos antigos do compactar continuam lá: movimento pela coluna loja_id
  assert (select loja_id from offline_versoes where tabela = 'estoque_movimentos' and pk = jsonb_build_object('id', v_mov)) = 99318,
    'estoque_movimentos segue pela regra loja';

  -- 3) pull: cada loja só recebe a revisão dela, com o dado completo
  select count(*) into n from offline_puxar(array[99318]::bigint[], null, 0, 5000) p
   where p.tabela = 'estoque_mov_revisao' and p.dado is not null;
  assert n = 1, 'loja 99318 recebe 1 revisão no pull, recebeu ' || n;
  assert (select (p.dado->>'custo_unitario')::numeric from offline_puxar(array[99318]::bigint[], null, 0, 5000) p
           where p.tabela = 'estoque_mov_revisao' and p.pk = jsonb_build_object('id', v_rev)) = 4, 'dado da revisão no pull';
  assert not exists (select 1 from offline_puxar(array[99318]::bigint[], null, 0, 5000) p
                      where p.tabela = 'estoque_mov_revisao' and p.pk = jsonb_build_object('id', v_rev2)),
    'revisão de outra loja não aparece no pull';

  -- 4) snapshot (carga inicial) e linhas (reconciliação) pela regra pai
  select count(*) into n from offline_snapshot('estoque_mov_revisao', array[99318]::bigint[], null, null, 1000) s
   where (s.dado->>'movimento_id')::bigint in (v_mov, v_mov2);
  assert n = 1, 'snapshot da loja 99318 traz só a revisão dela, trouxe ' || n;
  select count(*) into n from offline_buscar_linhas('estoque_mov_revisao', jsonb_build_array(jsonb_build_object('id', v_rev), jsonb_build_object('id', v_rev2)),
                                                    array[99319]::bigint[], null);
  assert n = 1, 'buscar_linhas da loja 99319 só devolve a revisão dela, devolveu ' || n;

  -- 5) ação reexecutada pelo desktop: as revisões criadas pelo intent aparecem em offline_criados (pareamento)
  perform set_config('request.headers', '{"x-ntb-intent":"00000000-0000-0000-0000-000000000318"}', true);
  v_rev := _revisar_movimento(v_mov, v_lote, current_date, 3.00, 3.00, 10, 10, false, 'teste 318 intent');
  perform set_config('request.headers', '', true);
  assert exists (select 1 from offline_criados('00000000-0000-0000-0000-000000000318') c
                  where c.tabela = 'estoque_mov_revisao' and c.pk = jsonb_build_object('id', v_rev)), 'revisão no offline_criados do intent';

  raise notice '318 OFFLINE MOV REVISAO OK';
end $$;
