-- Teste da migration 284 (Produtos por fornecedor: total = vTotalItem, custo = item de menor sequência, itens da nota).
-- Banco local com notas/itens REAIS da loja 5 (ex.: `create database p28 template d6`), da raiz do repo:
--   psql -d p28 -f scripts/testes-sql/284_produtos_fornecedor_omie.sql
set client_min_messages = notice;
\set ON_ERROR_STOP 1
set client_min_messages = warning;
\i supabase/migrations/210_relatorio_produtos_fornecedor.sql
set client_min_messages = notice;
drop table if exists t284_antes;
create table t284_antes as select x from jsonb_array_elements(relatorio_produtos_fornecedor(5)) x;
\i supabase/migrations/284_produtos_fornecedor_omie.sql

do $$
declare d int; n int; r jsonb;
begin
  create temp table t284_depois on commit drop as select x from jsonb_array_elements(relatorio_produtos_fornecedor(5)) x;
  select count(*) into n from t284_depois;
  -- mesmos pares, mesma última compra (nota, data, quantidade, preço, compras)
  select count(*) into d from (
    (select a.x - 'total' - 'custo_unit' - 'total_comprado' from t284_antes a except select b.x - 'total' - 'custo_unit' - 'total_comprado' - 'itens_ultima_nota' from t284_depois b)
    union all
    (select b.x - 'total' - 'custo_unit' - 'total_comprado' - 'itens_ultima_nota' from t284_depois b except select a.x - 'total' - 'custo_unit' - 'total_comprado' from t284_antes a)) z;
  if d <> 0 then raise exception '284: % pares mudaram fora de total/custo', d; end if;
  -- total = vTotalItem do item da última compra (quando há)
  select count(*) into d from t284_depois b
   join nota_fiscal_items i on i.loja_id = 5 and i.nota_fiscal_id = (b.x->>'ultima_nota_id')::bigint and i.n_id_produto = (b.x->>'n_cod_prod')::bigint
   where (b.x->>'itens_ultima_nota')::int = 1 and nullif(i.full_object->'itensCabec'->>'vTotalItem', '') is not null
     and (b.x->>'total')::numeric <> (i.full_object->'itensCabec'->>'vTotalItem')::numeric;
  if d <> 0 then raise exception '284: % totais diferentes do vTotalItem', d; end if;
  select count(*) into d from t284_depois where (x->>'itens_ultima_nota')::int > 1;
  raise notice '284: % pares, % com mais de um item do produto na última nota', n, d;
  -- caso da captura: 60145 SUPRINOX NF 33198 (seq 1: 2 × 9,90; seq 2: 3 × 53,00) -> custo 9,90 (Omie), total 159 (vTotalItem)
  select b.x into r from t284_depois b join produtos p on p.loja_id = 5 and p.codigo_produto = (b.x->>'n_cod_prod')::bigint
   where p.codigo = '60145' and b.x->>'ultima_nota' = '000033198';
  if r is null then
    raise notice '284: NF 33198 não está neste banco, caso 60145 pulado';
  elsif (r->>'custo_unit')::numeric <> 9.9 or (r->>'total')::numeric <> 159 or (r->>'itens_ultima_nota')::int <> 2 then
    raise exception '284: 60145/NF 33198 deu %', r;
  else
    raise notice '284: 60145/NF 33198 custo 9,90 total 159,00 itens 2 (Omie: custo 9,9; linhas 2 × 9,90 e 3 × 53,00)';
  end if;
end $$;
drop table t284_antes;
\echo 284 OK
