-- Teste de relatorio_produtos_fornecedor (migration 210). Cópia local, nunca em produção:
--   docker exec -i ntb-teste-sql psql -U postgres -d d6 -v ON_ERROR_STOP=1 < scripts/testes-sql/210_relatorio_produtos_fornecedor.sql
-- Loja 9 = Omie (notas), loja 18 = própria (compras_proprio).
begin;
set local session_replication_role = replica;  -- a trava de troca de modo e as FKs não interessam aqui
update lojas set modo_estoque = 'omie' where id = 9;
update lojas set modo_estoque = 'proprio' where id = 18;
insert into notas_fiscais (id, loja_id, n_id_receb, n_id_fornecedor, c_razao_social, c_nome, c_etapa, c_numero_nfe, d_emissao_nfe, full_object) values
 (900001, 9, 'r1', 77, 'FORNECEDOR A LTDA', 'A FANTASIA', '60', '100', '2026-09-01', '{"infoCadastro": {"cCancelada": "N", "dRec": "03/09/2026"}}'),
 -- mais nova pela emissão, mas recebida antes: a última é a de recebimento mais recente (r1 tem dRec 03/09)
 (900002, 9, 'r2', 77, 'FORNECEDOR A LTDA', 'A FANTASIA', '60', '101', '2026-09-02', '{"infoCadastro": {"cCancelada": "N", "dRec": "02/09/2026"}}'),
 -- cancelada e pendente nunca contam
 (900003, 9, 'r3', 77, 'FORNECEDOR A LTDA', 'A FANTASIA', '60', '102', '2026-09-20', '{"infoCadastro": {"cCancelada": "S", "dRec": "20/09/2026"}}'),
 (900004, 9, 'r4', 77, 'FORNECEDOR A LTDA', 'A FANTASIA', '40', '103', '2026-09-21', '{"infoCadastro": {"cCancelada": "N"}}'),
 -- fornecedor sem cadastro (sem n_id_fornecedor): agrupa pelo nome; sem dRec usa a emissão
 (900005, 9, 'r5', null, 'SEM CADASTRO ME', null, '60', '200', '2026-09-05', '{"infoCadastro": {"cCancelada": "N"}}');
insert into nota_fiscal_items (loja_id, nota_fiscal_id, n_id_receb, n_sequencia, n_id_produto, c_codigo_produto, n_qtde_nfe, c_unidade_nfe, n_preco_unit, c_ignorar_item, full_object) values
 (9, 900001, 'r1', 1, 500, 'X-1', 2, 'CX', 30, 'N', '{"itensAjustes": {"nQtdeRecebida": 24, "cUnidade": "UN"}}'),
 (9, 900002, 'r2', 1, 500, 'X-1', 1, 'CX', 99, 'N', '{"itensAjustes": {"nQtdeRecebida": 12, "cUnidade": "UN"}}'),
 (9, 900003, 'r3', 1, 500, 'X-1', 5, 'CX', 10, 'N', '{}'),
 (9, 900004, 'r4', 1, 500, 'X-1', 5, 'CX', 10, 'N', '{}'),
 (9, 900005, 'r5', 1, 500, 'Z9', 3, 'UN', 4, 'N', '{}'),
 (9, 900005, 'r5', 2, 501, 'Z8', 1, 'UN', 7, 'S', '{}'),   -- item ignorado
 (9, 900005, 'r5', 3, null, 'Z7', 1, 'UN', 7, 'N', '{}');  -- sem produto
-- loja própria
insert into compras_proprio (id, loja_id, origem, numero, fornecedor_cnpj, fornecedor_nome, emissao, status) overriding system value values
 (900101, 18, 'manual', 'P1', '11.222.333/0001-44', 'DISTRIBUIDORA B', '2026-09-10', 'lancada'),
 (900102, 18, 'manual', 'P2', '11.222.333/0001-44', 'DISTRIBUIDORA B', '2026-09-15', 'cancelada'),
 (900103, 18, 'manual', 'P3', '11.222.333/0001-44', 'DISTRIBUIDORA B', '2026-09-12', 'pendente');
insert into compras_proprio_itens (compra_id, loja_id, linha, c_prod, quantidade, valor_unitario, valor_total, desconto, fator, codigo_produto, custo_unitario_base, lancado) values
 (900101, 18, 1, 'B-7', 2, 50, 100, 10, 6, 700, 7.5, true),
 (900102, 18, 1, 'B-7', 9, 1, 9, 0, 1, 700, 1, true),
 (900103, 18, 1, 'B-7', 9, 1, 9, 0, 1, 700, 1, false);

do $$
declare r record; n int;
begin
  select count(*) into n from relatorio_produtos_fornecedor(9);
  if n <> 2 then raise exception 'loja Omie: esperava 2 pares, veio %', n; end if;
  select * into r from relatorio_produtos_fornecedor(9) where fornecedor_chave = 'id:77';
  if r.ultima_nota <> '100' or r.ultima_data <> '2026-09-03' or r.qtde <> 24 or r.unidade <> 'UN' or r.preco_unit <> 2.5 or r.total <> 60
     or r.custo_unit <> 2.5 or r.compras <> 2 or r.total_comprado <> 159 or r.primeira_data <> '2026-09-02' or r.fornecedor_fantasia <> 'A FANTASIA'
     or r.codigo_fornecedor <> 'X-1'
  then raise exception 'fornecedor A: %', row_to_json(r); end if;
  select * into r from relatorio_produtos_fornecedor(9) where fornecedor_chave = 'nome:SEM CADASTRO ME';
  if r.n_cod_prod <> 500 or r.ultima_data <> '2026-09-05' or r.qtde <> 3 or r.preco_unit <> 4 then raise exception 'sem cadastro: %', row_to_json(r); end if;
  -- loja própria: só a compra lançada; chave sem o CNPJ em claro
  select count(*) into n from relatorio_produtos_fornecedor(18);
  if n <> 1 then raise exception 'loja própria: esperava 1 par, veio %', n; end if;
  select * into r from relatorio_produtos_fornecedor(18);
  if r.ultima_nota <> 'P1' or r.qtde <> 12 or r.total <> 90 or r.preco_unit <> 7.5 or r.custo_unit <> 7.5 or r.compras <> 1
     or r.fornecedor_chave not like 'cnpj:%' or r.fornecedor_chave like '%11222333%'
  then raise exception 'própria: %', row_to_json(r); end if;
  -- a loja Omie não lê compras_proprio e a própria não lê as notas do Omie
  select count(*) into n from relatorio_produtos_fornecedor(18) where fornecedor_chave like 'id:%';
  if n <> 0 then raise exception 'loja própria leu notas do Omie'; end if;
  raise notice 'relatorio_produtos_fornecedor OK';
end $$;
rollback;
