-- Teste da migration 281 (bonificação nas RPCs de Compras, só com p_bonificacao = true). Banco local com notas/itens/
-- produtos REAIS da loja 5 (ex.: `create database p28 template d6`), da raiz do repo:
--   psql -d p28 -f scripts/testes-sql/281_compras_bonificacao.sql
-- Volta ao estado de produção de 20/10 (192 + detalhe da 176 + custo da 280), guarda a saída, aplica a 281 e confere:
-- (1) sem o parâmetro = igual a antes em 10 combinações de filtro × dimensões; (2) com o parâmetro = antes + só os itens
-- x.910/x.908; (3) o caso provado do Omie: out/2026, 2 itens de bonificação, 5.743,24 de valor de estoque.
set client_min_messages = notice;
\set ON_ERROR_STOP 1

-- estado de antes (rerodável)
drop function if exists public.relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint, text, boolean);
drop function if exists public.relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint, text, boolean);
drop function if exists public.relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint, text, boolean);
drop function if exists public.relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[], text, bigint, text, boolean);
set client_min_messages = warning;
\i supabase/migrations/192_compras_soma_estreita.sql
\i supabase/migrations/280_custo_credito_simples.sql
\i scripts/testes-sql/281_estado_antes_detalhe.sql
set client_min_messages = notice;

drop table if exists t281_casos, t281_total, t281_matriz, t281_dim, t281_det;
create table t281_casos as
select * from (values
  ('padrao',      null::text[], null::text[], null::text, null::text[], null::text, null::bigint, 'CONCLUIDA'),
  ('todas',       null, null, null, null, null, null, 'TODAS'),
  ('pendente',    null, null, null, null, null, null, 'PENDENTE'),
  ('familia_sem', array['__sem__'], null, null, null, null, null, 'CONCLUIDA'),
  ('tipo',        null, array['01','04'], null, null, null, null, 'CONCLUIDA'),
  ('fornecedor',  null, null, 'a', null, null, null, 'CONCLUIDA'),
  ('cfop',        null, null, null, array['1.910','1.102'], null, null, 'CONCLUIDA'),
  ('produto',     null, null, null, null, 'a', null, 'CONCLUIDA'),
  ('cancelada',   null, null, null, null, null, null, 'CANCELADA'),
  ('manifestada', null, null, null, null, null, null, 'MANIFESTADA')
) v(caso, fam, tip, forn, cfo, prod, loc, st);

create table t281_total as
select c.caso, r.* from t281_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
create table t281_matriz as
select c.caso, d.dim, r.* from t281_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) d(dim),
  relatorio_compras_matriz(5, '2025-07-01', '2026-10-31', d.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
create table t281_dim as
select c.caso, d.dim, r.* from t281_casos c, unnest(array['familia','fornecedor','cfop']) d(dim),
  relatorio_compras_dim(5, '2025-07-01', '2026-10-31', d.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;
create table t281_det as
select c.caso, r.* from t281_casos c, relatorio_compras_detalhe(5, '2026-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r;

\i supabase/migrations/281_compras_bonificacao.sql

do $$
declare d int; b numeric; be numeric; n int; t record;
begin
  -- (1) sem o parâmetro: igual a antes
  select count(*) into d from (
    (select caso, valor, n_notas, valor_estoque from t281_total
     except select c.caso, r.valor, r.n_notas, r.valor_estoque from t281_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, r.valor, r.n_notas, r.valor_estoque from t281_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r
     except select caso, valor, n_notas, valor_estoque from t281_total)) z;
  if d <> 0 then raise exception '281: total sem o parâmetro mudou (% linhas)', d; end if;
  select count(*) into d from (
    (select * from t281_matriz except select c.caso, x.dim, r.* from t281_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) x(dim), relatorio_compras_matriz(5, '2025-07-01', '2026-10-31', x.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, x.dim, r.* from t281_casos c, unnest(array['familia','tipo','produto','fornecedor','cfop']) x(dim), relatorio_compras_matriz(5, '2025-07-01', '2026-10-31', x.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r except select * from t281_matriz)) z;
  if d <> 0 then raise exception '281: matriz sem o parâmetro mudou (% linhas)', d; end if;
  select count(*) into d from (
    (select * from t281_dim except select c.caso, x.dim, r.* from t281_casos c, unnest(array['familia','fornecedor','cfop']) x(dim), relatorio_compras_dim(5, '2025-07-01', '2026-10-31', x.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, x.dim, r.* from t281_casos c, unnest(array['familia','fornecedor','cfop']) x(dim), relatorio_compras_dim(5, '2025-07-01', '2026-10-31', x.dim, c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r except select * from t281_dim)) z;
  if d <> 0 then raise exception '281: dim sem o parâmetro mudou (% linhas)', d; end if;
  select count(*) into d from (
    (select * from t281_det except select c.caso, r.* from t281_casos c, relatorio_compras_detalhe(5, '2026-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r)
    union all
    (select c.caso, r.* from t281_casos c, relatorio_compras_detalhe(5, '2026-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r except select * from t281_det)) z;
  if d <> 0 then raise exception '281: detalhe sem o parâmetro mudou (% linhas)', d; end if;
  select count(*) into d from t281_casos c, relatorio_compras_total(5, '2025-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st) r
   where r.valor_bonificacao <> 0 or r.valor_estoque_bonificacao <> 0;
  if d <> 0 then raise exception '281: colunas de bonificação <> 0 sem o parâmetro'; end if;

  -- (2) com o parâmetro: antes + exatamente os itens x.910/x.908 (colunas novas = a diferença)
  for t in
    select c.caso, a.valor va, a.valor_estoque ea, r.valor vn, r.valor_estoque en, r.valor_bonificacao vb, r.valor_estoque_bonificacao eb
    from t281_casos c join t281_total a using (caso),
         relatorio_compras_total(5, '2025-07-01', '2026-10-31', c.fam, c.tip, c.forn, c.cfo, c.prod, c.loc, c.st, true) r
  loop
    if round(t.vn - t.va, 6) <> round(t.vb, 6) or round(t.en - t.ea, 6) <> round(t.eb, 6) then
      raise exception '281: caso %: com bonificação % / % não fecha com a coluna % / %', t.caso, t.vn - t.va, t.en - t.ea, t.vb, t.eb;
    end if;
  end loop;
  -- a matriz por CFOP com o parâmetro só ganha linhas de CFOP x.910/x.908
  select count(*) into d from (
    select rotulo, mes, valor, valor_estoque from relatorio_compras_matriz(5, '2025-07-01', '2026-10-31', 'cfop', p_bonificacao => true)
    except select rotulo, mes, valor, valor_estoque from t281_matriz where caso = 'padrao' and dim = 'cfop') z
   where right(regexp_replace(z.rotulo, '\D', '', 'g'), 3) not in ('910', '908');
  if d <> 0 then raise exception '281: matriz cfop com bonificação mudou % linhas que não são bonificação', d; end if;

  -- (3) caso provado contra o Omie: out/2026, loja 5, notas concluídas
  select r.valor_bonificacao, r.valor_estoque_bonificacao into b, be from relatorio_compras_total(5, '2026-10-01', '2026-10-31', p_bonificacao => true) r;
  select count(*) into n from relatorio_compras_detalhe(5, '2026-10-01', '2026-10-31', p_bonificacao => true) r where right(regexp_replace(r.cfop, '\D', '', 'g'), 3) = '910';
  raise notice '281: out/2026 bonificação: % itens, valor da nota %, valor de estoque % (Omie: 2 itens, 6.446,28 / 5.743,24)', n, b, be;
  if n <> 2 or be <> 5743.24 then raise exception '281: bonificação de out/2026 diferente do Omie'; end if;
  raise notice '281 OK';
end $$;

-- uma assinatura só por função (PostgREST não escolhe entre duas)
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname in ('relatorio_compras_total', 'relatorio_compras_matriz', 'relatorio_compras_dim', 'relatorio_compras_detalhe') and pronamespace = 'public'::regnamespace;
  if n <> 4 then raise exception '281: % versões das 4 RPCs (esperado 4)', n; end if;
end $$;
drop table t281_casos, t281_total, t281_matriz, t281_dim, t281_det;
\echo 281 OK
