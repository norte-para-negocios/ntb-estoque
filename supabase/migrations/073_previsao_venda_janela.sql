-- 073_previsao_venda_janela.sql
-- Permite ter mais de uma janela de previsao (7/15/30 dias) por produto,
-- em vez de uma unica linha fixa de 7 dias. Cron passa a gravar as 3 janelas
-- de uma vez; a tela de Repor deixa o usuario escolher qual exibir.

alter table previsao_venda
  add column if not exists janela_dias integer not null default 7;

-- A constraint antiga so cobria (loja_id, n_cod_prod) -- com 3 janelas por
-- produto isso colidiria. Substitui pela constraint que inclui janela_dias.
alter table previsao_venda
  drop constraint if exists previsao_venda_loja_id_n_cod_prod_key;

alter table previsao_venda
  add constraint previsao_venda_loja_produto_janela_key
  unique (loja_id, n_cod_prod, janela_dias);

-- produtos_repor() precisa continuar enxergando so a janela padrao de 7 dias,
-- senao um produto apareceria repetido (uma vez por janela). Corpo identico
-- ao de 013_produtos_repor.sql, so com "and pv.janela_dias = 7" adicionado
-- no join de previsao_venda.
create or replace function produtos_repor(p_loja_id bigint)
returns setof bigint
language sql
stable
as $$
  with ultima as (
    select max(data_posicao) as d from posicao_estoques where loja_id = p_loja_id
  ),
  pos as (
    select n_cod_prod, sum(n_saldo) as saldo, sum(estoque_minimo) as min_omie
    from posicao_estoques, ultima
    where loja_id = p_loja_id and data_posicao = ultima.d
    group by n_cod_prod
  )
  select p.codigo_produto
  from produtos p
  join pos on pos.n_cod_prod = p.codigo_produto
  left join previsao_venda pv on pv.loja_id = p.loja_id
    and pv.n_cod_prod = p.codigo_produto
    and pv.janela_dias = 7
  where p.loja_id = p_loja_id
    and coalesce(p.estoque_minimo, pos.min_omie) > 0
    and greatest(0, coalesce(p.estoque_minimo, pos.min_omie) + coalesce(pv.qtde, 0) - pos.saldo) > 0;
$$;

grant execute on function produtos_repor(bigint) to anon, authenticated, service_role;
