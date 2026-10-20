-- Teste da migration 280 (crédito do Simples sai do custo). Banco local com os itens REAIS da loja 5 (ex.: `d6`, ou
-- `create database p28 template d6`), rodado da raiz do repo: psql -d p28 -f scripts/testes-sql/280_custo_credito_simples.sql
-- Guarda a saída da função de antes (192), aplica a 280 e confere: só mudam itens com CSOSN 101/201 sem ICMS próprio e
-- com "ICMS é custo" = N; os casos provados contra o kardex do Omie dão o valor do kardex; continua embutível.
set client_min_messages = notice;
\set ON_ERROR_STOP 1
-- estado de antes (= 192, produção em 20/10/2026), para o teste poder rodar de novo
\i scripts/testes-sql/280_estado_antes_custo.sql

drop table if exists t280_antes;
create table t280_antes as
select i.id, custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) as v from nota_fiscal_items i;

\i supabase/migrations/280_custo_credito_simples.sql

do $$
declare n_mud int; n_fora int; v numeric;
begin
  -- 1) só mudam os itens do Simples com crédito e ICMS fora do custo
  select count(*) into n_mud from nota_fiscal_items i join t280_antes a using (id)
   where custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) is distinct from a.v;
  select count(*) into n_fora from nota_fiscal_items i join t280_antes a using (id)
   where custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) is distinct from a.v
     and not (coalesce(i.full_object->'itensCustoEstoque'->>'cICMSCusto', 'N') = 'N'
              and coalesce(nullif(i.full_object->'itensICMS'->>'nValor', '')::numeric, 0) = 0
              and i.full_object->'itensICMSSN'->>'cSitTribSN' in ('101', '201')
              and coalesce(nullif(i.full_object->'itensICMSSN'->>'nCredSN', '')::numeric, 0) <> 0);
  if n_fora <> 0 then raise exception '280: % itens mudaram fora da regra', n_fora; end if;
  if n_mud = 0 then raise exception '280: nenhum item mudou (banco sem itens do Simples da loja 5?)'; end if;
  raise notice '280: % itens mudaram, todos do Simples com crédito', n_mud;

  -- 2) casos provados contra o kardex do Omie (JSON real)
  v := custo_estoque_item_omie('{"itensIPI": {"nValIPI": 0}, "itensICMS": null, "itensCabec": {"nQtdeNFe": 12, "vDesconto": 0, "nPrecoUnit": 26.5, "vTotalItem": 318}, "itensICMSSN": {"cOrigem": "0", "nCredSN": 12.34, "cSitTribSN": "101", "nAliqCredSN": 3.88}, "itensICMSST": {"cCEST": "18.002.00"}, "itensCustoEstoque": {"cIPICusto": "N", "cPISCusto": "N", "cICMSCusto": "N", "cFreteCusto": "N", "cCOFINSCusto": "N", "cICMSSTCusto": "N", "cSeguroCusto": "N", "cOutrosDespCusto": "N", "nAliqCredPISCusto": 0, "nAliqCredCOFINSCusto": 0}}', 12, 26.5);
  if v <> 305.66 then raise exception '280: NF 34972 deu %, kardex 305,66', v; end if;
  v := custo_estoque_item_omie('{"itensIPI": {"nValIPIDev": 0}, "itensICMS": null, "itensCabec": {"nQtdeNFe": 72, "vDesconto": 0, "nPrecoUnit": 10.25, "vTotalItem": 738}, "itensICMSSN": {"cOrigem": "0", "nCredSN": 10.04, "cSitTribSN": "101", "nAliqCredSN": 1.36}, "itensICMSST": {"cCEST": "17.010.00"}, "itensCustoEstoque": {"cIPICusto": "S", "cPISCusto": "N", "cICMSCusto": "N", "cFreteCusto": "N", "cCOFINSCusto": "N", "cICMSSTCusto": "S", "cSeguroCusto": "N", "cOutrosDespCusto": "N", "nAliqCredPISCusto": 0, "nAliqCredCOFINSCusto": 0}}', 72, 10.25);
  if v <> 727.96 or round(v / 72000, 6) <> 0.010111 then raise exception '280: NF 5008 deu %, kardex 0,010111 × 72.000', v; end if;
  -- ICMS é custo = S: o crédito fica
  v := custo_estoque_item_omie('{"itensCabec": {"vTotalItem": 318}, "itensICMSSN": {"nCredSN": 12.34, "cSitTribSN": "101"}, "itensCustoEstoque": {"cICMSCusto": "S"}}', 12, 26.5);
  if v <> 318 then raise exception '280: ICMS custo S deu %', v; end if;
  -- ICMS próprio presente: vence (projeção da nota própria, 185)
  v := custo_estoque_item_omie('{"itensCabec": {"vTotalItem": 100}, "itensICMS": {"nValor": 7}, "itensICMSSN": {"nCredSN": 3, "cSitTribSN": "101"}, "itensCustoEstoque": {"cICMSCusto": "N"}}', 1, 100);
  if v <> 93 then raise exception '280: nValor presente deu %', v; end if;
  -- itensICMSSN como texto/array não quebra
  v := custo_estoque_item_omie('{"itensCabec": {"vTotalItem": 100}, "itensICMSSN": "", "itensCustoEstoque": {"cICMSCusto": "N"}}', 1, 100);
  if v <> 100 then raise exception '280: itensICMSSN texto deu %', v; end if;
  raise notice '280 OK';
end $$;

-- continua embutível: o plano não pode mostrar a chamada da função
do $$
declare p text;
begin
  execute 'explain (verbose, costs off, format json) select custo_estoque_item_omie(full_object, n_qtde_nfe, n_preco_unit) from nota_fiscal_items limit 1' into p;
  if p ~ 'custo_estoque_item_omie' then raise exception '280: a função deixou de ser embutida pelo planner'; end if;
  raise notice '280: embutível OK';
end $$;
drop table t280_antes;
\echo 280 OK
