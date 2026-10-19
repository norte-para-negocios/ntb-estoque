-- Teste de relatorio_ops_periodo (migration 211). Cópia local, nunca em produção:
--   docker exec -i ntb-teste-sql psql -U postgres -d d6 -v ON_ERROR_STOP=1 < scripts/testes-sql/211_relatorio_ops_periodo.sql
-- Loja 9 = Omie (ficha gravada na OP), loja 18 = própria (o que a produção baixou).
begin;
set local session_replication_role = replica;  -- a trava de troca de modo e as FKs não interessam aqui
update lojas set modo_estoque = 'omie' where id = 9;
update lojas set modo_estoque = 'proprio' where id = 18;
-- o teste não depende do que já existe nas duas lojas do banco local
delete from ordens_producao where loja_id in (9, 18);
delete from kardex_omie where loja_id in (9, 18);
delete from ordens_producao_proprio_itens where ordem_id in (select id from ordens_producao_proprio where loja_id in (9, 18));
delete from ordens_producao_proprio where loja_id in (9, 18);
-- a função devolve um jsonb (produtos e dias); aqui vira tabela para conferir
create function pg_temp.opp(l bigint, i date, f date, fonte text default 'ops', prods bigint[] default null)
returns table (papel text, n_cod_prod bigint, ops int, qtde numeric, custo numeric, dias int) language sql as $f$
  select * from jsonb_to_recordset(public.relatorio_ops_periodo(l, i, f, fonte, prods)->'produtos')
    as x(papel text, n_cod_prod bigint, ops int, qtde numeric, custo numeric, dias int) $f$;
create function pg_temp.opd(l bigint, i date, f date, fonte text default 'ops', prods bigint[] default null)
returns table (dia date, ops int, qtde numeric) language sql as $f$
  select * from jsonb_to_recordset(public.relatorio_ops_periodo(l, i, f, fonte, prods)->'dias') as x(dia date, ops int, qtde numeric) $f$;
insert into ordens_producao (id, loja_id, concluida, dt_conclusao_real, identificacao_n_cod_produto, identificacao_n_qtde, full_object, producao_ref, custo_total) values
 (990001, 9, true, '2026-10-01', 100, 2, '{"itensDetalhes": [{"nIdProdutoMalha": 200, "nQtde": 0.4}, {"nIdProdutoMalha": 201, "nQtde": 3}, {"nIdProdutoMalha": 200, "nQtde": 0.1}]}', null, null),
 (990002, 9, true, '2026-10-01', 100, 1, '{"itensDetalhes": [{"nIdProdutoMalha": 200, "nQtde": 0.25}]}', null, null),
 (990003, 9, true, '2026-10-02', 101, 4, '{}', null, null),                                    -- sem ficha gravada: só produção
 (990004, 9, false, null, 100, 9, '{"itensDetalhes": [{"nIdProdutoMalha": 200, "nQtde": 9}]}', null, null),  -- aberta
 (990005, 9, true, '2026-11-01', 100, 9, '{}', null, null),                                    -- fora do período
 (990011, 18, true, '2026-10-03', 300, 5, '{"itensDetalhes": [{"nIdProdutoMalha": 400, "nQtde": 99}]}', 'OP:990011:2', 12.5),
 (990012, 18, false, null, 300, 5, '{}', 'OP:990012:1', 7);                                    -- revertida (não concluída)
insert into ordens_producao_proprio (id, loja_id, ref, codigo_produto, ficha_id, quantidade, local_consumo, local_destino, custo_total, custo_unitario, status) overriding system value values
 (990101, 18, 'OP:990011:1', 300, 1, 5, 1, 1, 50, 10, 'estornada'),   -- conclusão antiga (revertida depois): não conta
 (990102, 18, 'OP:990011:2', 300, 1, 5, 1, 1, 12.5, 2.5, 'concluida'),
 (990103, 18, 'OP:990012:1', 300, 1, 5, 1, 1, 7, 1.4, 'concluida');
insert into ordens_producao_proprio_itens (ordem_id, codigo_insumo, quantidade, custo_unitario) values
 (990101, 400, 10, 5), (990102, 400, 2, 5), (990102, 401, 1, 2.5), (990103, 400, 7, 1);

do $$
declare r record; n int;
begin
  select * into r from pg_temp.opp(9, '2026-10-01', '2026-10-31') where papel = 'produzido' and n_cod_prod = 100;
  if r.ops <> 2 or r.qtde <> 3 or r.dias <> 1 or r.custo is not null then raise exception 'produzido 100: %', row_to_json(r); end if;
  select * into r from pg_temp.opp(9, '2026-10-01', '2026-10-31') where papel = 'consumido' and n_cod_prod = 200;
  if r.ops <> 2 or r.qtde <> 0.75 then raise exception 'consumido 200: %', row_to_json(r); end if;
  select * into r from pg_temp.opp(9, '2026-10-01', '2026-10-31') where papel = 'produzido' and n_cod_prod = 101;
  if r.qtde <> 4 then raise exception 'sem ficha: %', row_to_json(r); end if;
  select count(*) into n from pg_temp.opp(9, '2026-10-01', '2026-10-31');
  if n <> 4 then raise exception 'loja Omie: esperava 4 produto × papel (100 e 101 produzidos, 200 e 201 consumidos), veio %', n; end if;
  -- loja própria: só a conclusão atual da OP concluída, com custo; a ficha gravada (itensDetalhes) não é usada
  select * into r from pg_temp.opp(18, '2026-10-01', '2026-10-31') where papel = 'produzido';
  if r.qtde <> 5 or r.custo <> 12.5 or r.ops <> 1 then raise exception 'produzido próprio: %', row_to_json(r); end if;
  select * into r from pg_temp.opp(18, '2026-10-01', '2026-10-31') where papel = 'consumido' and n_cod_prod = 400;
  if r.qtde <> 2 or r.custo <> 10 then raise exception 'consumido próprio 400: %', row_to_json(r); end if;
  select count(*) into n from pg_temp.opp(18, '2026-10-01', '2026-10-31');
  if n <> 3 then raise exception 'loja própria: esperava 3 linhas, veio %', n; end if;
  -- fonte kardex (loja Omie com espelho): OPE/OPS do kardex, cancelado fora, custo = quantidade × valor do movimento
  insert into kardex_omie (loja_id, id_mov, n_cod_prod, codigo_local_estoque, data_mov, cod_origem, des_origem, quantidade, valor_unit, cancelado) values
   (9, 9001, 100, 1, '2026-10-01', 'OPE', 'Entrada da Ordem de Produção', 2, 4, false),
   (9, 9002, 100, 1, '2026-10-01', 'OPE', 'Entrada da Ordem de Produção', 5, 4, false),
   (9, 9003, 200, 1, '2026-10-01', 'OPS', 'Consumo da Ordem de Produção', -0.5, 10, false),
   (9, 9004, 200, 1, '2026-10-01', 'OPS', 'Consumo da Ordem de Produção', -7, 10, true),
   (9, 9005, 200, 1, '2026-10-01', 'PDV', 'Movimento Gerado pelo PDV', -1, 10, false);
  select * into r from pg_temp.opp(9, '2026-10-01', '2026-10-31', 'kardex') where papel = 'produzido';
  if r.ops <> 2 or r.qtde <> 7 or r.custo <> 28 then raise exception 'kardex produzido: %', row_to_json(r); end if;
  select * into r from pg_temp.opp(9, '2026-10-01', '2026-10-31', 'kardex') where papel = 'consumido';
  if r.qtde <> 0.5 or r.custo <> 5 then raise exception 'kardex consumido: %', row_to_json(r); end if;
  select count(*) into n from pg_temp.opp(9, '2026-10-01', '2026-10-31', 'kardex');
  if n <> 2 then raise exception 'kardex: esperava 2 linhas (não lê as OPs), veio %', n; end if;
  -- série por dia (só produção) e filtro de produtos
  select count(*) into n from pg_temp.opd(9, '2026-10-01', '2026-10-31');
  if n <> 2 then raise exception 'dias: esperava 2, veio %', n; end if;
  select * into r from pg_temp.opd(9, '2026-10-01', '2026-10-31') where dia = '2026-10-01';
  if r.ops <> 2 or r.qtde <> 3 then raise exception 'dia 01/10: %', row_to_json(r); end if;
  select count(*) into n from pg_temp.opp(9, '2026-10-01', '2026-10-31', 'ops', array[200]::bigint[]);
  if n <> 1 then raise exception 'filtro de produtos: esperava 1, veio %', n; end if;
  select count(*) into n from pg_temp.opd(9, '2026-10-01', '2026-10-31', 'ops', array[200]::bigint[]);
  if n <> 0 then raise exception 'filtro só com insumo não tem produção por dia, veio %', n; end if;
  if relatorio_ops_periodo(7, '2026-10-01', '2026-10-31') <> '{"dias": [], "produtos": []}'::jsonb then raise exception 'loja sem OP'; end if;
  raise notice 'relatorio_ops_periodo OK';
end $$;
rollback;
