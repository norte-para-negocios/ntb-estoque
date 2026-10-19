-- Teste da migration 220 (histórico campo a campo). Banco LOCAL g1 com fase_g_setup.sql + 220. Nunca em produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d g1 < scripts/testes-sql/220_historico_alteracoes.sql
begin;
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, full_object) values (9001, 22001, 'H22001', 'TOMATE', 'KG', '{"extras":{"cest":"0100100"}}');
insert into ordens_producao (loja_id, identificacao_n_qtde, identificacao_d_dt_previsao, concluida) values (9001, 5, '2026-10-19', false);
insert into fornecedores (loja_id, razao_social) values (9001, 'FORN A');

-- 1. insert sem autor = 1 linha (campo nulo, origem sistema); OP sem autor não grava
do $$ declare n int; begin
  select count(*) into n from historico_alteracoes where entidade = 'produto' and entidade_id = '22001';
  if n <> 1 then raise exception '1: insert sem autor deveria gravar 1 linha, gravou %', n; end if;
  if (select campo from historico_alteracoes where entidade = 'produto' and entidade_id = '22001') is not null then raise exception '1: campo'; end if;
  if (select origem from historico_alteracoes where entidade = 'produto' and entidade_id = '22001') <> 'sistema' then raise exception '1: origem'; end if;
  select count(*) into n from historico_alteracoes where entidade = 'op';
  if n <> 0 then raise exception '1: OP sem autor gravou % linhas', n; end if;
end $$;

-- 2. update sem mudança em campo rastreado (só updated_at/full_object fora de extras) não grava
update produtos set updated_at = now(), full_object = full_object || '{"x":1}' where loja_id = 9001 and codigo_produto = 22001;
do $$ begin
  if (select count(*) from historico_alteracoes where entidade = 'produto' and entidade_id = '22001') <> 1 then raise exception '2: gravou update sem mudança'; end if;
end $$;

-- 3. service_role + cabeçalho x-ntb-autor = autor e nome; campo a campo, inclusive full_object.extras.*
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"x-ntb-autor":"00000000-0000-4000-8000-000000009001"}', true);
update produtos set descricao = 'TOMATE ITALIANO', ean = '7891234567895', full_object = '{"extras":{"cest":"0100200","origem":"1"}}'
  where loja_id = 9001 and codigo_produto = 22001;
do $$ declare r record; n int; begin
  select count(*) into n from historico_alteracoes where entidade = 'produto' and entidade_id = '22001' and operacao = 'update';
  if n <> 4 then raise exception '3: esperava 4 campos (descricao, ean, extras.cest, extras.origem), veio %', n; end if;
  select * into r from historico_alteracoes where entidade = 'produto' and entidade_id = '22001' and campo = 'descricao';
  if r.valor_de <> 'TOMATE' or r.valor_para <> 'TOMATE ITALIANO' or r.autor_nome <> 'Ana Própria' or r.origem <> 'app' then raise exception '3: %', r; end if;
  select * into r from historico_alteracoes where entidade = 'produto' and campo = 'full_object.extras.cest';
  if r.valor_de <> '0100100' or r.valor_para <> '0100200' then raise exception '3: cest %', r; end if;
  select * into r from historico_alteracoes where entidade = 'produto' and campo = 'full_object.extras.origem';
  if r.valor_de is not null or r.valor_para <> '1' then raise exception '3: origem %', r; end if;
end $$;

-- 4. OP com autor grava; delete de fornecedor com autor grava os campos não nulos
update ordens_producao set identificacao_n_qtde = 7 where loja_id = 9001;
delete from fornecedores where loja_id = 9001 and razao_social = 'FORN A';
do $$ declare n int; begin
  select count(*) into n from historico_alteracoes where entidade = 'op' and campo = 'identificacao_n_qtde' and valor_de::numeric = 5 and valor_para::numeric = 7;
  if n <> 1 then raise exception '4: OP com autor não gravou'; end if;
  select count(*) into n from historico_alteracoes where entidade = 'fornecedor' and operacao = 'delete' and campo is not null;
  if n < 2 then raise exception '4: delete com autor deveria gravar os campos (razao_social, pessoa_fisica, inativo), veio %', n; end if;
end $$;

-- 5. pedido de compra: itens com linha; mesmo txid no apagar-e-recriar
do $$ declare r jsonb; v_ped bigint; n int; begin
  insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade) values (9001, 22002, 'H22002', 'CEBOLA', 'KG');
  r := pc_salvar(9001, '{"fornecedor_nome":"HORTI","itens":[{"codigo_produto":22002,"quantidade":3,"preco_unitario":2}]}'::jsonb);
  v_ped := (r->>'id')::bigint;
  perform pc_salvar(9001, jsonb_build_object('id', v_ped, 'fornecedor_nome', 'HORTI', 'itens', '[{"codigo_produto":22002,"quantidade":4,"preco_unitario":2}]'::jsonb));
  select count(*) into n from historico_alteracoes where entidade = 'pedido_compra' and entidade_id = v_ped::text and tabela = 'pedidos_compra_itens' and linha = '1';
  if n < 4 then raise exception '5: itens do pedido não gravados (%)', n; end if;
end $$;

-- 6. usuário comum forjando o cabeçalho: vale o auth.uid() dele, não o cabeçalho
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000009002"}', true);
select set_config('request.headers', '{"x-ntb-autor":"00000000-0000-4000-8000-000000009001"}', true);
update produtos set descricao = 'TOMATE 2' where loja_id = 9001 and codigo_produto = 22001;
do $$ begin
  if (select autor_nome from historico_alteracoes where entidade = 'produto' and valor_para = 'TOMATE 2') <> 'Bruno Omie' then raise exception '6: cabeçalho forjado aceito'; end if;
end $$;

-- 7. RLS: Bruno (loja 9002) não vê o histórico da 9001; Ana vê
set local role authenticated;
do $$ begin
  if (select count(*) from historico_alteracoes) <> 0 then raise exception '7: usuário de outra loja leu o histórico'; end if;
end $$;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000009001"}', true);
do $$ begin
  if (select count(*) from historico_alteracoes where loja_id = 9001) = 0 then raise exception '7: dono da loja não lê'; end if;
end $$;
-- 8. append-only para quem não é dono
do $$ begin
  begin delete from historico_alteracoes; raise exception '8: authenticated apagou'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin update historico_alteracoes set campo = 'x'; raise exception '8: service_role alterou'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 9. erro dentro do gatilho não aborta a escrita (cabeçalho com JSON quebrado)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{quebrado', true);
update produtos set descricao = 'TOMATE 3' where loja_id = 9001 and codigo_produto = 22001;
do $$ begin
  if (select descricao from produtos where loja_id = 9001 and codigo_produto = 22001) <> 'TOMATE 3' then raise exception '9: escrita abortada'; end if;
end $$;

-- 10. sync com sessão (revisão I1): service role SEM o cabeçalho de autor = produto como "sistema", OP não grava
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.headers', '{"accept":"application/json"}', true);
update produtos set descricao = 'TOMATE DO OMIE' where loja_id = 9001 and codigo_produto = 22001;
update ordens_producao set identificacao_n_qtde = 9 where loja_id = 9001;
do $$ begin
  if (select origem from historico_alteracoes where entidade = 'produto' and valor_para = 'TOMATE DO OMIE') <> 'sistema' then raise exception '10: sync gravou autor'; end if;
  if exists (select 1 from historico_alteracoes where entidade = 'op' and valor_para::numeric = 9) then raise exception '10: OP do sync gravou'; end if;
end $$;

-- 11. retenção: apaga só o que passou do prazo, em lote; prazo menor que 90 dias recusado; authenticated não chama
do $$ declare n int; begin
  update historico_alteracoes set created_at = now() - interval '401 days' where entidade = 'fornecedor';
  n := historico_podar(400, 1);
  if n <> 1 then raise exception '11: lote %', n; end if;
  n := historico_podar(400, 5000);
  if exists (select 1 from historico_alteracoes where entidade = 'fornecedor') then raise exception '11: sobrou vencido'; end if;
  if not exists (select 1 from historico_alteracoes where entidade = 'produto') then raise exception '11: apagou o que está no prazo'; end if;
  begin perform historico_podar(30, 10); raise exception '11: aceitou 30 dias'; exception when sqlstate '22023' then null; end;
end $$;
set local role authenticated;
do $$ begin
  begin perform historico_podar(400, 10); raise exception '11: authenticated podou'; exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'OK 220' as resultado;
rollback;
