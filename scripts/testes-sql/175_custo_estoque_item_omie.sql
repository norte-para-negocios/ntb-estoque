-- Teste da migration 175 (casos reais da loja 5). Cópia local, nunca em produção.
do $$
declare
  n jsonb := '{"cICMSCusto":"N","cICMSSTCusto":"N","cIPICusto":"N","cPISCusto":"N","cCOFINSCusto":"N","cOutrosDespCusto":"N","nAliqCredPISCusto":0,"nAliqCredCOFINSCusto":0}';
  r numeric;
begin
  r := custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":6.5}'::jsonb, 'itensICMS', '{"nValor":1.33}'::jsonb, 'itensCustoEstoque', n), 1, 6.5);
  if r <> 5.17 then raise exception 'esponja: %', r; end if;
  r := custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":33}'::jsonb, 'itensICMS', '{"nValor":6.77}'::jsonb, 'itensCustoEstoque', n || '{"cIPICusto":"S","cICMSSTCusto":"S"}'), 1, 33);
  if r <> 26.23 then raise exception 'alho: %', r; end if;
  r := custo_estoque_item_omie('{"itensCabec":{"vTotalItem":3197.93,"vDesconto":12.97},"itensCustoEstoque":{"cIPICusto":"S","cICMSSTCusto":"S"}}', 77, 41.7);
  if r <> 3197.93 then raise exception 'pescada: %', r; end if;
  r := custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":189.23}'::jsonb, 'itensCustoEstoque', n), 12, 14.570054);
  if r <> 174.84 then raise exception 'agua: %', r; end if;
  r := custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":109.88,"vDesconto":0}'::jsonb, 'itensIPI', '{"nValIPI":1.58}'::jsonb, 'itensCustoEstoque', n), 2, 49.971587);
  if r <> 99.94 then raise exception 'h2o: %', r; end if;
  r := custo_estoque_item_omie(jsonb_build_object('itensCabec', '{"vTotalItem":241.79}'::jsonb, 'itensICMSST', '{"nValorST":11.79}'::jsonb, 'itensCustoEstoque', n), 20, 11.5);
  if r <> 230 then raise exception 'recorte: %', r; end if;
  r := custo_estoque_item_omie('{"itensCabec":{}}', 4, 54.9);
  if r <> 219.6 then raise exception 'sem marcacoes: %', r; end if;
  if item_movimenta_estoque('{"itensAjustes":{"cNaoGerarMovEstoque":"S"}}') then raise exception 'naomov'; end if;
  if item_movimenta_estoque('{"itensCabec":{"cIgnorarItem":"S"}}') then raise exception 'ignorar'; end if;
  if not item_movimenta_estoque('{"itensAjustes":{"cNaoGerarFinanceiro":"S","cNaoGerarMovEstoque":"N"}}') then raise exception 'naofin'; end if;
  if not item_movimenta_estoque(null) then raise exception 'nulo'; end if;
  raise notice 'custo_estoque_item_omie OK';
end $$;
