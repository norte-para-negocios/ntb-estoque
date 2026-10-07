-- 149: rotulo_tipo_item(null) devolvia NULL ("case p_tipo when null" nunca casa), e o pré-agregado do faturamento
-- próprio (recalcular_faturamento_proprio) grava rotulo NOT NULL. Item sem produto cadastrado — a taxa de serviço
-- automática de loja sem o produto "Taxa de Serviço" — fazia o Estoque recusar o fechamento inteiro da venda
-- ("null value in column rotulo of relation faturamento_importado"). Achado na QA rodada 3 (ODARA, 07/10).
create or replace function public.rotulo_tipo_item(p_tipo text) returns text
language sql immutable as $$
  select case
    when p_tipo is null or p_tipo = '' then 'Não classificado'
    when p_tipo = '00' then 'Mercadoria p/ revenda' when p_tipo = '01' then 'Matéria-prima' when p_tipo = '02' then 'Embalagem'
    when p_tipo = '03' then 'Produto em processo' when p_tipo = '04' then 'Produto acabado' when p_tipo = '05' then 'Subproduto'
    when p_tipo = '06' then 'Produto intermediário' when p_tipo = '07' then 'Uso e consumo' when p_tipo = '08' then 'Ativo imobilizado'
    when p_tipo = '09' then 'Serviços' when p_tipo = '10' then 'Outros insumos' when p_tipo = '99' then 'Outras'
    else 'Tipo ' || p_tipo end
$$;
