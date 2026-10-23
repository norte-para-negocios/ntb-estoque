-- Teste da migration 296 (posicao_saldo_a_conferir). Banco local com as fotos e notas REAIS da loja 5 e a 282 aplicada
-- (ex.: p29, ver 295), da raiz do repo: psql -d p29 -f scripts/testes-sql/296_posicao_saldo_a_conferir.sql (rerodável).
set client_min_messages = notice;
\set ON_ERROR_STOP 1
\i supabase/migrations/296_posicao_saldo_a_conferir.sql

do $$
declare n int; v numeric;
begin
  select count(*) filter (where acumulado), sum(valor) filter (where acumulado) into n, v from posicao_saldo_a_conferir(5);
  raise notice '296: loja 5 (dados locais): % produtos acumulados, R$ %', n, v;
  -- coerência: todo acumulado tem saldo > comprado > 0 e valor ≥ 1.000
  select count(*) into n from posicao_saldo_a_conferir(5) where acumulado and not (saldo > comprado_12m and comprado_12m > 0 and valor >= 1000);
  if n <> 0 then raise exception '296: % acumulados incoerentes', n; end if;
end $$;

begin;
set local session_replication_role = replica;
insert into produtos (loja_id, codigo_produto, codigo, descricao, unidade, tipo_item, inativo) values
  (5, -929601, 'T601', 'TESTE GLP', 'KG', '07', false),
  (5, -929602, 'T602', 'TESTE FILE GIRA', 'KG', '01', false),
  (5, -929603, 'T603', 'TESTE INATIVO', 'KG', '99', true),
  (5, -929604, 'T604', 'TESTE BARATO', 'KG', '01', false);
-- notas: uma antiga (> 365 dias: histórico completo) e duas recentes
insert into notas_fiscais (id, loja_id, n_id_receb, c_etapa, c_numero_nfe, d_emissao_nfe, full_object) values
  (-929601, 5, 'r-929601', '60', '1', (select max(data_posicao) from posicao_estoques where loja_id = 5) - 400, '{}'),
  (-929602, 5, 'r-929602', '60', '2', (select max(data_posicao) from posicao_estoques where loja_id = 5) - 30, '{}'),
  (-929603, 5, 'r-929603', '60', '3', (select max(data_posicao) from posicao_estoques where loja_id = 5) - 10, '{"infoCadastro": {"cCancelada": "S"}}');
insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_produto, n_qtde_nfe, n_preco_unit, full_object) values
  (5, -929601, 'r-929601', 1, -929601, 5000, 10, '{"itensAjustes": {"nQtdeRecebida": 5000}}'),   -- fora dos 12 meses
  (5, -929602, 'r-929602', 1, -929601, 320, 16.5, '{"itensAjustes": {"nQtdeRecebida": 320}}'),
  (5, -929602, 'r-929602', 2, -929602, 100, 70, '{"itensAjustes": {"nQtdeRecebida": 100}}'),
  (5, -929603, 'r-929603', 1, -929601, 9000, 16.5, '{"itensAjustes": {"nQtdeRecebida": 9000}}'),  -- cancelada: não conta
  (5, -929602, 'r-929602', 3, -929604, 10, 5, '{"itensAjustes": {"nQtdeRecebida": 10}}');
insert into posicao_estoques (loja_id, codigo_local_estoque, n_cod_prod, data_posicao, n_saldo, n_cmc)
select 5, l, p, (select max(data_posicao) from posicao_estoques where loja_id = 5 and codigo_local_estoque <> 0), s, c
from (values
  (1, -929601, 1000.0, 14.13),   -- 1.000 kg > 320 kg comprados em 12 meses → acumulado
  (1, -929602, 50.0, 70.0),      -- 50 kg < 100 comprados → não
  (1, -929603, 720.0, 41.74),    -- inativo com saldo
  (1, -929604, 50.0, 5.0)        -- saldo > comprado, mas valor < 1.000 → não
) v(l, p, s, c);
do $$
declare r record; n int;
begin
  select * into r from posicao_saldo_a_conferir(5) where n_cod_prod = -929601;
  if r is null or not r.acumulado or r.comprado_12m <> 320 or r.valor <> 14130 or r.inativo then raise exception '296: GLP %', row_to_json(r); end if;
  select count(*) into n from posicao_saldo_a_conferir(5) where n_cod_prod in (-929602, -929604);
  if n <> 0 then raise exception '296: marcou produto que não devia'; end if;
  select * into r from posicao_saldo_a_conferir(5) where n_cod_prod = -929603;
  if r is null or not r.inativo or r.acumulado then raise exception '296: inativo %', row_to_json(r); end if;
  raise notice '296: sintéticos OK';
end $$;
rollback;

-- loja sem histórico de 12 meses: ninguém é "acumulado"
begin;
set local session_replication_role = replica;
update notas_fiscais set deleted_at = now() where loja_id = 5 and d_emissao_nfe <= (select max(data_posicao) from posicao_estoques where loja_id = 5) - 365;
do $$
begin
  if exists (select 1 from posicao_saldo_a_conferir(5) where acumulado) then raise exception '296: sem 12 meses de notas não pode marcar acumulado'; end if;
  raise notice '296: sem histórico de 12 meses OK';
end $$;
rollback;
\echo 296 OK
