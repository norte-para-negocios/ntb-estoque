-- Reuniao 09/07 (#32): "evolucao do preco" -- "comprou a Budweiser de 10 e
-- agora esta comprando de 11... da esses feedbacks, os insights". Compara o
-- preco unitario da ultima compra (NF de entrada) com o da compra anterior,
-- por produto. Mesma fonte/filtro de deleted_at que compras_fornecedores e
-- compras_produtos_do_fornecedor (migration 036).

create or replace function evolucao_preco_produtos(p_loja_id bigint, p_codigos bigint[])
returns table(
  cod_produto bigint,
  preco_atual numeric,
  data_atual date,
  fornecedor_atual text,
  preco_anterior numeric,
  data_anterior date
)
language sql stable as $$
  with compras as (
    select
      i.n_id_produto::bigint as cod_produto,
      i.n_preco_unit as preco,
      nf.d_emissao_nfe as data,
      coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
      row_number() over (partition by i.n_id_produto order by nf.d_emissao_nfe desc, i.id desc) as rn
    from nota_fiscal_items i
    join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
    where i.loja_id = p_loja_id
      and nf.deleted_at is null
      and i.n_id_produto = any(p_codigos)
      and i.n_preco_unit > 0
  )
  select
    c1.cod_produto,
    c1.preco as preco_atual,
    c1.data as data_atual,
    c1.fornecedor as fornecedor_atual,
    c2.preco as preco_anterior,
    c2.data as data_anterior
  from compras c1
  left join compras c2 on c2.cod_produto = c1.cod_produto and c2.rn = 2
  where c1.rn = 1;
$$;
