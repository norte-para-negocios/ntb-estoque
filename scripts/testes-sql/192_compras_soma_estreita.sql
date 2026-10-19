-- Teste da migration 192: mesma saída das RPCs de Compras antes × depois, e tempos. Só no banco local (fi), com
-- notas/itens/produtos REAIS da loja 5 copiados por "copy ... to stdout" (mesmo padrão da 170) e o usuário comum
-- de scripts/testes-sql/fi_setup_usuario_loja5.sql. work_mem igual ao de produção (16 MB).
-- Começa do estado de produção de 19/10 (RPCs da 176 + custo da 185), guarda a saída em tabelas, aplica a 192 e
-- compara. Pode rodar quantas vezes quiser.
set client_min_messages = warning;
\i supabase/migrations/176_compras_valor_estoque.sql
\i scripts/testes-sql/192_estado_antes_custo.sql
set work_mem = '16MB';

drop table if exists fi_casos, fi_antes_total, fi_antes_matriz, fi_antes_dim;
create table fi_casos as
select * from (values
  ('padrao',       null::text[], null::text[], null::text, null::text[], null::text, null::bigint, 'CONCLUIDA'),
  ('todas',        null, null, null, null, null, null, 'TODAS'),
  ('pendente',     null, null, null, null, null, null, 'PENDENTE'),
  ('familia',      (select array[descricao_familia] from produtos where loja_id = 5 and descricao_familia is not null group by 1 order by count(*) desc limit 1), null, null, null, null, null, 'CONCLUIDA'),
  ('familia_sem',  array['__sem__'], null, null, null, null, null, 'CONCLUIDA'),
  ('tipo',         null, array['01','04'], null, null, null, null, 'CONCLUIDA'),
  ('fornecedor',   null, null, (select left(coalesce(c_razao_social, c_nome), 5) from notas_fiscais where loja_id = 5 and coalesce(c_razao_social, c_nome) is not null group by 1 order by count(*) desc limit 1), null, null, null, 'CONCLUIDA'),
  ('cfop',         null, null, null, (select array[full_object->'itensAjustes'->>'cCFOPEntrada'] from nota_fiscal_items where loja_id = 5 group by 1 order by count(*) desc limit 1), null, null, 'CONCLUIDA'),
  ('produto',      null, null, null, null, 'a', null, 'CONCLUIDA'),
  ('local',        null, null, null, null, null, (select (full_object->'itensAjustes'->>'codigo_local_estoque')::bigint from nota_fiscal_items where loja_id = 5 and full_object->'itensAjustes'->>'codigo_local_estoque' is not null group by 1 order by count(*) desc limit 1), 'CONCLUIDA')
) v(caso, fam, tip, forn, cfo, prod, loc, st);
grant select on fi_casos to authenticated;

create table fi_antes_total as
select c.caso, r.* from fi_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-19', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
create table fi_antes_matriz as
select c.caso, d.dim, r.* from fi_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) d(dim),
  relatorio_compras_matriz(5, '2025-07-01', '2026-10-19', d.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
create table fi_antes_dim as
select c.caso, d.dim, r.* from fi_casos c, unnest(array['familia','fornecedor','cfop']) d(dim),
  relatorio_compras_dim(5, '2025-07-01', '2026-10-19', d.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
select (select count(*) from fi_antes_total) total_linhas, (select count(*) from fi_antes_matriz) matriz_linhas, (select count(*) from fi_antes_dim) dim_linhas;

\echo == ANTES (como usuário comum, ano corrente, igual à tela)
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_total(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_status => 'CONCLUIDA');
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_matriz(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_dim => 'familia', p_status => 'CONCLUIDA');
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_dim(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_dim => 'fornecedor', p_status => 'CONCLUIDA');
commit;

\i supabase/migrations/192_compras_soma_estreita.sql
set work_mem = '16MB';

\echo == DEPOIS
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000005","role":"authenticated"}';
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_total(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_status => 'CONCLUIDA');
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_matriz(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_dim => 'familia', p_status => 'CONCLUIDA');
explain (analyze, timing off, summary on, costs off) select * from relatorio_compras_dim(p_loja_id => 5, p_ini => '2026-01-01', p_fim => '2026-10-19', p_dim => 'fornecedor', p_status => 'CONCLUIDA');
commit;

\echo == IGUALDADE (10 combinações de filtro x dimensões, período jul/2025-out/2026)
do $$
declare d int;
begin
  select count(*) into d from (
    (select * from fi_antes_total except all
     select c.caso, r.* from fi_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-19', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, r.* from fi_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-19', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r
     except all select * from fi_antes_total)) z;
  assert d = 0, 'total divergiu em ' || d || ' linha(s)';
  select count(*) into d from (
    (select * from fi_antes_matriz except all
     select c.caso, dd.dim, r.* from fi_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) dd(dim),
       relatorio_compras_matriz(5, '2025-07-01', '2026-10-19', dd.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, dd.dim, r.* from fi_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) dd(dim),
       relatorio_compras_matriz(5, '2025-07-01', '2026-10-19', dd.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r
     except all select * from fi_antes_matriz)) z;
  assert d = 0, 'matriz divergiu em ' || d || ' linha(s)';
  select count(*) into d from (
    (select * from fi_antes_dim except all
     select c.caso, dd.dim, r.* from fi_casos c, unnest(array['familia','fornecedor','cfop']) dd(dim),
       relatorio_compras_dim(5, '2025-07-01', '2026-10-19', dd.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, dd.dim, r.* from fi_casos c, unnest(array['familia','fornecedor','cfop']) dd(dim),
       relatorio_compras_dim(5, '2025-07-01', '2026-10-19', dd.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r
     except all select * from fi_antes_dim)) z;
  assert d = 0, 'dim divergiu em ' || d || ' linha(s)';
  assert (select count(*) from fi_antes_matriz) > 1000, 'poucos dados para provar';
  assert (select count(distinct caso) from fi_antes_total where valor > 0) >= 8, 'combinações vazias demais';
end $$;
\echo == custo_estoque_item_omie nova x antiga: itens reais + grade sintética (inclui o bloco sefaz, ausente na loja 5)
do $$
declare d int;
begin
  select count(*) into d from nota_fiscal_items i
  where custo_estoque_item_omie(i.full_object, i.n_qtde_nfe, i.n_preco_unit) is distinct from fi_custo_antigo(i.full_object, i.n_qtde_nfe, i.n_preco_unit);
  assert d = 0, 'custo divergiu em ' || d || ' item(ns) reais';
  with grade as (
    select jsonb_strip_nulls(jsonb_build_object(
      'itensCabec', jsonb_build_object('vTotalItem', (array[null, '', '100.00', '57.33', '0'])[1 + g % 5], 'vDesconto', (array[null, '', '3.10'])[1 + g % 3]),
      'itensIPI', jsonb_build_object('nValIPI', (array[null, '4.20', ''])[1 + (g / 5) % 3]),
      'itensICMSST', jsonb_build_object('nValorST', (array[null, '7.77'])[1 + (g / 7) % 2]),
      'itensICMS', jsonb_build_object('nValor', (array[null, '12.00'])[1 + (g / 11) % 2]),
      'itensCustoEstoque', case when g % 13 = 0 then null when g % 17 = 0 then '"texto"'::jsonb else jsonb_build_object(
        'cIPICusto', (array['S','N',null])[1 + g % 3], 'cICMSSTCusto', (array['N','S'])[1 + (g / 3) % 2],
        'cICMSCusto', (array['S','N'])[1 + (g / 2) % 2], 'cPISCusto', (array['N','S'])[1 + (g / 4) % 2],
        'nAliqCredPISCusto', (array['1.65', '', null])[1 + g % 3], 'cCOFINSCusto', (array['S','N'])[1 + (g / 6) % 2],
        'nAliqCredCOFINSCusto', (array['7.6', null])[1 + (g / 8) % 2], 'cOutrosDespCusto', (array['N','S'])[1 + (g / 9) % 2],
        'cFreteCusto', (array['N','S'])[1 + (g / 10) % 2], 'cSeguroCusto', (array['S','N'])[1 + (g / 12) % 2]) end,
      'sefaz', case when g % 4 = 0 then jsonb_build_object('vFrete', (array['9.99', '', null])[1 + g % 3], 'vSeg', '1.11', 'freteCte', (array['5.50', null])[1 + (g / 2) % 2])
                    when g % 4 = 1 then '[]'::jsonb end)) as fo,
      (array[null, 2, 1.5, 0])[1 + g % 4]::numeric as q, (array[null, 50, 33.333])[1 + g % 3]::numeric as p
    from generate_series(1, 20000) g)
  select count(*) into d from grade where custo_estoque_item_omie(fo, q, p) is distinct from fi_custo_antigo(fo, q, p);
  assert d = 0, 'custo divergiu em ' || d || ' caso(s) sintético(s)';
end $$;
-- embutida: o plano não chama mais a função (a expressão aparece no Output)
explain (verbose, costs off) select custo_estoque_item_omie(full_object, n_qtde_nfe, n_preco_unit) from nota_fiscal_items limit 1;
\timing on
select sum(fi_custo_antigo(full_object, n_qtde_nfe, n_preco_unit)) antiga from nota_fiscal_items where loja_id = 5;
select sum(custo_estoque_item_omie(full_object, n_qtde_nfe, n_preco_unit)) nova from nota_fiscal_items where loja_id = 5;
\timing off
drop function fi_custo_antigo(jsonb, numeric, numeric);
-- a ordem da matriz (order by 1, 2) e do dim (valor desc) segue a mesma
select caso, valor, n_notas, valor_estoque from fi_antes_total order by caso;
drop table fi_casos, fi_antes_total, fi_antes_matriz, fi_antes_dim;
\echo RESULTADO: PASSOU (asserts ok)
