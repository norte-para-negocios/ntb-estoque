-- Teste da 170 (item 4): a relatorio_movimentacao_matriz nova devolve exatamente o mesmo que a antiga (copiada abaixo
-- como pg_temp.ref_matriz_antiga). Rodar numa cópia com dados (nunca em produção): psql < este arquivo.
CREATE OR REPLACE FUNCTION pg_temp.ref_matriz_antiga(p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text, p_cod_prods bigint[] DEFAULT NULL::bigint[], p_produto text DEFAULT NULL::text)
 RETURNS TABLE(rotulo text, mes text, qtde numeric, valor numeric)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(nullif(
      case p_dim
        when 'tipo'    then p.tipo_item
        when 'familia' then p.descricao_familia
        when 'produto' then m.descricao
      end, ''), 'Sem classificação') as rotulo,
    to_char(m.data, 'YYYY-MM') as mes,
    sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end)::numeric as qtde,
    sum((case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) * coalesce(pr.preco_unit, 0))::numeric as valor
  from movimentos_historico m
  left join produtos p on p.loja_id = m.loja_id and p.codigo_produto = m.cod_prod
  left join produto_preco_recente pr on pr.loja_id = m.loja_id and pr.codigo_produto = m.cod_prod
  where m.loja_id = p_loja_id and m.data >= p_ini and m.data <= p_fim
    and (p_cod_prods is null or m.cod_prod = any(p_cod_prods))
    and (p_produto is null or p_produto = ''
         or m.descricao ilike '%' || p_produto || '%'
         or m.codigo    ilike '%' || p_produto || '%')
  group by 1, 2
  having sum(case when p_sentido = 'entradas' then coalesce(m.entradas, 0) else coalesce(m.saidas, 0) end) <> 0
  order by 1, 2;
$function$

;
\set ON_ERROR_STOP 1
do $$
declare d text; s text; l bigint; n bigint; prods bigint[];
begin
  select array_agg(codigo_produto) into prods from (select codigo_produto from produtos where loja_id=5 order by id limit 40) x;
  foreach l in array array[3,5] loop
    foreach d in array array['produto','familia','tipo'] loop
      foreach s in array array['saidas','entradas'] loop
        select count(*) into n from (
          (select * from pg_temp.ref_matriz_antiga(l, '2026-01-01', '2026-10-13', d, s, null, null) except all select * from relatorio_movimentacao_matriz(l, '2026-01-01', '2026-10-13', d, s, null, null))
          union all
          (select * from relatorio_movimentacao_matriz(l, '2026-01-01', '2026-10-13', d, s, null, null) except all select * from pg_temp.ref_matriz_antiga(l, '2026-01-01', '2026-10-13', d, s, null, null))) z;
        if n > 0 then raise exception 'matriz difere: loja % dim % sentido % (% linhas)', l, d, s, n; end if;
      end loop;
    end loop;
  end loop;
  select count(*) into n from (
    (select * from pg_temp.ref_matriz_antiga(5, '2025-07-01', '2026-10-13', 'familia', 'saidas', prods, 'a') except all select * from relatorio_movimentacao_matriz(5, '2025-07-01', '2026-10-13', 'familia', 'saidas', prods, 'a'))
    union all (select * from relatorio_movimentacao_matriz(5, '2025-07-01', '2026-10-13', 'familia', 'saidas', prods, 'a') except all select * from pg_temp.ref_matriz_antiga(5, '2025-07-01', '2026-10-13', 'familia', 'saidas', prods, 'a'))) z;
  if n > 0 then raise exception 'matriz difere com filtros (% linhas)', n; end if;
  raise notice 'matriz igual em 12 combinacoes + filtros';
end $$;
