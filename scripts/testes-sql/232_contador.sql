-- Teste da migration 232 (posição do estoque próprio numa data). Banco LOCAL (230_preparar_banco.sh), nunca produção.
-- Uso: docker exec -i ntb-teste-sql psql -v ON_ERROR_STOP=1 -U postgres -d f1 < scripts/testes-sql/232_contador.sql
begin;
do $$
declare v_loja bigint; r record; n int;
begin
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 232', '00000000000233', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, 1, 'DEPOSITO'), (v_loja, 2, 'BAR');
  -- 01/09: entra 10 a R$ 10 no 1; 05/09: entra 10 a R$ 20 no 2 (CMC 15); 10/09: sai 4 do 1; 02/10: entra 10 a R$ 30 no 1
  perform registrar_movimento(v_loja, 1, 501, 'ENT', 'T', 'a', 10, 10, null, null, 0, null, null, '2026-09-01');
  perform registrar_movimento(v_loja, 2, 501, 'ENT', 'T', 'b', 10, 20, null, null, 0, null, null, '2026-09-05');
  perform registrar_movimento(v_loja, 1, 501, 'SAI', 'T', 'c', 4, null, null, null, 0, null, null, '2026-09-10');
  perform registrar_movimento(v_loja, 1, 501, 'ENT', 'T', 'd', 10, 30, null, null, 0, null, null, '2026-10-02');
  -- 30/09: só o que entrou até lá; custo do último movimento até a data
  select * into r from posicao_proprio_em_data(v_loja, '2026-09-30') where codigo_local_estoque = 1;
  if r.saldo <> 6 or r.cmc <> 15 then raise exception 'local 1 em 30/09: % %', r.saldo, r.cmc; end if;
  select * into r from posicao_proprio_em_data(v_loja, '2026-09-30') where codigo_local_estoque = 2;
  if r.saldo <> 10 then raise exception 'local 2 em 30/09: %', r.saldo; end if;
  -- 03/09: só a 1ª entrada
  select count(*) into n from posicao_proprio_em_data(v_loja, '2026-09-03');
  if n <> 1 then raise exception 'linhas em 03/09: %', n; end if;
  select * into r from posicao_proprio_em_data(v_loja, '2026-09-03');
  if r.saldo <> 10 or r.cmc <> 10 then raise exception '03/09: % %', r.saldo, r.cmc; end if;
  -- hoje: bate com estoque_saldos
  select * into r from posicao_proprio_em_data(v_loja, '2026-12-31') where codigo_local_estoque = 1;
  if r.saldo <> (select saldo from estoque_saldos where loja_id = v_loja and codigo_local_estoque = 1 and codigo_produto = 501) then raise exception 'saldo atual'; end if;
  if r.cmc <> (select cmc from estoque_custos where loja_id = v_loja and codigo_produto = 501) then raise exception 'cmc atual'; end if;
  -- Movimento retroativo gravado depois (revisão I3): 02/10 entra 5 a R$ 20 (gravado primeiro); depois se grava uma
  -- entrada de 10 a R$ 10 com data 01/09. O cmc_apos dela é o do momento da gravação (13,33); na data 30/09 o custo
  -- certo é 10 (só ela existia). O custo vem da reconstrução na ordem da data.
  insert into lojas (nome, cnpj, modo_estoque) values ('TESTE 232 RETRO', '00000000000234', 'proprio') returning id into v_loja;
  insert into local_estoques (loja_id, codigo_local_estoque, descricao) values (v_loja, 1, 'DEPOSITO');
  perform registrar_movimento(v_loja, 1, 777, 'ENT', 'T', 'r1', 5, 20, null, null, 0, null, null, '2026-10-02');
  perform registrar_movimento(v_loja, 1, 777, 'ENT', 'T', 'r2', 10, 10, null, null, 0, null, null, '2026-09-01');
  if (select cmc_apos from estoque_movimentos where loja_id = v_loja and ref = 'r2') <> 13.333333 then raise exception 'premissa: cmc_apos gravado'; end if;
  select * into r from posicao_proprio_em_data(v_loja, '2026-09-30');
  if r.saldo <> 10 or r.cmc <> 10 then raise exception 'retroativo em 30/09: saldo % custo %', r.saldo, r.cmc; end if;
  select * into r from posicao_proprio_em_data(v_loja, '2026-10-31');
  if r.saldo <> 15 or r.cmc <> 13.333333 then raise exception 'retroativo em 31/10: saldo % custo %', r.saldo, r.cmc; end if;
  -- saída não muda o custo; saldo zerado + entrada nova assume o custo da entrada
  perform registrar_movimento(v_loja, 1, 777, 'SAI', 'T', 'r3', 15, null, null, null, 0, null, null, '2026-10-03');
  perform registrar_movimento(v_loja, 1, 777, 'ENT', 'T', 'r4', 2, 7, null, null, 0, null, null, '2026-10-04');
  select * into r from posicao_proprio_em_data(v_loja, '2026-10-31');
  if r.saldo <> 2 or r.cmc <> 7 then raise exception 'depois de zerar: saldo % custo %', r.saldo, r.cmc; end if;
  -- devolução ao fornecedor (231) refaz o custo sem as unidades, igual à função de saída
  perform _saida_ao_custo_da_entrada(v_loja, 1, 777, 'dev:t', 1, 1, 7);
  perform registrar_movimento(v_loja, 1, 777, 'ENT', 'T', 'r5', 1, 13, null, null, 0, null, null, '2026-10-05');
  select * into r from posicao_proprio_em_data(v_loja, '2026-12-31');
  if r.cmc <> (select cmc from estoque_custos where loja_id = v_loja and codigo_produto = 777) then raise exception 'custo reconstruído % ≠ atual', r.cmc; end if;
  raise notice '232: todos os testes passaram';
end $$;
do $$ begin
  if has_function_privilege('anon', 'public.posicao_proprio_em_data(bigint,date)', 'execute') then raise exception 'anon executa'; end if;
  if (select prosecdef from pg_proc where proname = 'posicao_proprio_em_data') then raise exception 'deveria ser security invoker'; end if;
  raise notice '232: grants ok';
end $$;
rollback;
