-- 090_movimentacao_preco_cache.sql
-- Achado real (2026-07-27): relatorio_movimentacao_matriz calcula "preço mais
-- recente por produto" com uma CTE `distinct on` que varre nota_fiscal_items
-- inteiro TODA VEZ que o relatório é aberto. Isso ocasionalmente estoura o
-- statement_timeout de 8s do PostgREST (erro 57014), e o app engolia isso em
-- silêncio, fazendo a tela cair só na fatia fria (Contabo) -- parecia
-- "travada em abril" mesmo com dado novo no banco. Tentativas de corrigir via
-- índice (088/089) e via plan_cache_mode (role/database) reduziram o custo
-- mas não eliminaram a instabilidade no caminho real do PostgREST.
--
-- Fix definitivo: tira esse cálculo do caminho de leitura do usuário. Uma
-- tabela pequena (produto_preco_recente) guarda o preço já calculado por
-- produto; um endpoint de cron (mesmo padrão de scripts/sync-cron.sh)
-- recalcula periodicamente. relatorio_movimentacao_matriz passa a fazer um
-- JOIN simples nessa tabela (chave primária, instantâneo) em vez de recalcular
-- do zero -- a query fica imune ao tamanho de nota_fiscal_items.

create table if not exists produto_preco_recente (
  loja_id bigint not null,
  codigo_produto bigint not null,
  preco_unit numeric not null,
  atualizado_em timestamptz not null default now(),
  primary key (loja_id, codigo_produto)
);

-- Recalcula todos os produtos de UMA loja (chamado pelo cron, uma loja por vez
-- -- mesmo padrão de granularidade dos outros syncs desta sessão).
create or replace function atualizar_preco_recente(p_loja_id bigint)
returns void
language sql
as $$
  insert into produto_preco_recente (loja_id, codigo_produto, preco_unit, atualizado_em)
  select distinct on (i.n_id_produto)
    p_loja_id, i.n_id_produto, i.n_preco_unit, now()
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = p_loja_id and nf.deleted_at is null and i.n_preco_unit > 0 and i.n_id_produto is not null
  order by i.n_id_produto, nf.d_emissao_nfe desc
  on conflict (loja_id, codigo_produto) do update
    set preco_unit = excluded.preco_unit, atualizado_em = excluded.atualizado_em;
$$;

revoke execute on function atualizar_preco_recente(bigint) from public;
revoke execute on function atualizar_preco_recente(bigint) from anon, authenticated;
grant  execute on function atualizar_preco_recente(bigint) to service_role;

-- relatorio_movimentacao_matriz: troca a CTE `preco` (varredura + distinct on
-- em nota_fiscal_items/notas_fiscais, cara e instável) por um JOIN direto na
-- tabela pré-calculada (leitura por chave primária, barata e estável).
drop function if exists relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text);

create or replace function relatorio_movimentacao_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text, p_sentido text,
  p_cod_prods bigint[] default null, p_produto text default null
) returns table(rotulo text, mes text, qtde numeric, valor numeric)
language sql stable as $$
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
$$;

revoke execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) from public;
revoke execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) from anon;
grant  execute on function relatorio_movimentacao_matriz(bigint, date, date, text, text, bigint[], text) to authenticated, service_role;
