-- Sugestão de compra POR FORNECEDOR: o produto não tem fornecedor no cadastro,
-- então derivamos do histórico de NF de entrada (de quem a loja já comprou cada
-- produto). Um produto comprado de 2 fornecedores aparece nos 2.

-- Lista de fornecedores que a loja já comprou (para o dropdown do filtro).
create or replace function compras_fornecedores(p_loja_id bigint)
returns table(fornecedor text)
language sql stable as $$
  select distinct coalesce(nf.c_razao_social, nf.c_nome) as fornecedor
  from notas_fiscais nf
  where nf.loja_id = p_loja_id
    and nf.deleted_at is null
    and coalesce(nf.c_razao_social, nf.c_nome) is not null
    and length(trim(coalesce(nf.c_razao_social, nf.c_nome))) > 0
  order by 1;
$$;

-- Códigos de produto (codigo_produto) que a loja já comprou daquele fornecedor.
create or replace function compras_produtos_do_fornecedor(p_loja_id bigint, p_fornecedor text)
returns table(cod bigint)
language sql stable as $$
  select distinct i.n_id_produto::bigint as cod
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and coalesce(nf.c_razao_social, nf.c_nome) = p_fornecedor
    and i.n_id_produto is not null;
$$;
