-- 291: Movimentação "Em quantidade" — unidade de cada produto e lançamentos errados que foram desfeitos. Só leitura.
--
-- Por quê (produção, loja 5, 01/01–23/10/2026, só leitura):
--   - LINGUIÇA CALABRESA (MC), kg: contagem de inventário de 2.720.000 kg em 30/05 (Joab; o normal é ~10 kg) e nova
--     contagem 0 em 31/05. No resumo diário do Omie (movimentos_historico) virou entrada de 2.719.998 em 30/05 e saída
--     de 2.720.000 em 31/05: a matriz de saídas mostrava 2.720.020 em mai/26. Mesmo padrão em MAIONESE (5.933 kg
--     entram em 10/08, 5.997 saem em 19/08), LAGOSTA (8.333/8.399), FARINHA PANKO (996,8/999,04), DETERGENTE (2.480/2.509).
--   - LEITE DE COCO (MP) 1.559.196 em jan, VINAGRE ÁLCOOL 239.144 em 09/03, VODKA ORLOFF 103.994 em 28/05: NÃO são
--     erro. O cadastro é em ml: 1.559 L de leite de coco em janeiro batem com as compras (1.266 L no mês, 8,7 mil L
--     comprados e 8,6 mil L saídos no ano); vinagre e vodka saem por contagem de inventário (o consumo não está na
--     ficha) e também batem com as compras (vodka: 77 L em 2025 + 42 L em 2026 entrados, 104 L saídos, 30 L hoje).
--     A tela passa a mostrar a unidade e a converter ml → L e g → kg.
--
-- relatorio_movimentacao_qtd_extras(loja, ini, fim) devolve um jsonb:
--   unidades: [{descricao, unidade}] dos produtos com movimento no período (descricao = a de movimentos_historico, que
--             é o rótulo da matriz);
--   desfeitos: pares entrada × saída do mesmo produto em até 31 dias, quantidades a menos de 5 % uma da outra e as duas
--             acima de 100 × o 3º quartil das quantidades diárias do produto (365 dias até o fim, pelo menos 10 dias
--             com movimento; o quartil não se deixa levar pelo próprio erro, que é 1 ou 2 dias). Cada
--             entrada e cada saída entra em um par só (o mais perto na data). A tela tira os dois lados da matriz e lista.
-- security invoker: vale a RLS de quem chama. Teste: scripts/testes-sql/291_movimentacao_qtd_desfeitos.sql.
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 291_movimentacao_qtd_desfeitos.sql
-- Reverter: drop function relatorio_movimentacao_qtd_extras(bigint, date, date) (a tela volta ao de antes sozinha).

begin;

create or replace function public.relatorio_movimentacao_qtd_extras(p_loja_id bigint, p_ini date, p_fim date)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  -- EXECUTE: planejado com as datas de verdade. Como função SQL o plano genérico (datas desconhecidas) levava minutos
  -- no banco de teste; a mesma consulta com as datas leva 0,25–0,7 s.
  execute $q$
  with d as (
    select m.cod_prod, m.descricao, m.data, coalesce(m.entradas, 0) as e, coalesce(m.saidas, 0) as s
    from movimentos_historico m
    where m.loja_id = $1 and m.data between $3 - 365 and $3 + 31
  ), x as (
    select cod_prod, e as q from d where e > 0 and data <= $3
    union all
    select cod_prod, s from d where s > 0 and data <= $3
  ), mag as (
    select cod_prod, percentile_cont(0.75) within group (order by q)::numeric as p75, count(*) as n from x group by cod_prod
  ), ent as (
    select d.cod_prod, d.descricao, d.data, d.e from d join mag g using (cod_prod)
    where d.e > 0 and g.n >= 10 and d.e > 100 * g.p75 and d.data between $2 - 31 and $3 + 31
  ), sai as (
    select d.cod_prod, d.descricao, d.data, d.s from d join mag g using (cod_prod)
    where d.s > 0 and g.n >= 10 and d.s > 100 * g.p75 and d.data between $2 - 31 and $3 + 31
  ), cand as (
    select e.cod_prod, e.descricao, e.data as d_ent, s.data as d_sai, e.e, s.s, abs(s.data - e.data) as dist
    from ent e join sai s on s.cod_prod = e.cod_prod and abs(s.data - e.data) <= 31
    where least(e.e, s.s) >= 0.95 * greatest(e.e, s.s)
  ), um_por_entrada as (
    select distinct on (cod_prod, d_ent) * from cand order by cod_prod, d_ent, dist, abs(e - s)
  ), pares as (
    select distinct on (cod_prod, d_sai) * from um_por_entrada order by cod_prod, d_sai, dist, abs(e - s)
  ), pares_periodo as (
    select * from pares p where p.d_ent between $2 and $3 or p.d_sai between $2 and $3
  ), un as (
    select distinct on (m.descricao) m.descricao, pr.unidade
    from movimentos_historico m
    join produtos pr on pr.loja_id = $1 and pr.codigo_produto = m.cod_prod
    where m.loja_id = $1 and m.data between $2 and $3 and coalesce(pr.unidade, '') <> ''
    order by m.descricao, m.cod_prod
  )
  select jsonb_build_object(
    'unidades', coalesce((select jsonb_agg(jsonb_build_object('descricao', un.descricao, 'unidade', un.unidade)) from un), '[]'::jsonb),
    'desfeitos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cod_prod', p.cod_prod, 'descricao', p.descricao, 'unidade', pr.unidade,
               'data_entrada', p.d_ent, 'data_saida', p.d_sai, 'quantidade_entrada', round(p.e, 6), 'quantidade_saida', round(p.s, 6))
             order by p.d_ent, p.cod_prod)
      from pares_periodo p
      left join produtos pr on pr.loja_id = $1 and pr.codigo_produto = p.cod_prod), '[]'::jsonb)
  )
  $q$ into r using p_loja_id, p_ini, p_fim;
  return r;
end
$$;
revoke all on function public.relatorio_movimentacao_qtd_extras(bigint, date, date) from public, anon;
grant execute on function public.relatorio_movimentacao_qtd_extras(bigint, date, date) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
