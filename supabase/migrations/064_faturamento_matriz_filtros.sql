-- Filtros de valor (multi-select por rotulo) + periodo customizado no relatorio
-- de faturamento. Pedido do Ramon (reuniao 06/07): "eu nao quero ver todos os
-- tipos, eu nao quero ver todas as familias... por forma de pagamento tambem".
--
-- faturamento_importado guarda 3 pivots JA agregados por dimensao (tipo/familia/
-- forma_pgto), sem uma tabela de fatos por cupom -- entao nao da pra cruzar
-- "familia X" com "tipo Y" na mesma linha. O filtro de rotulos (p_rotulos) por
-- isso se aplica sempre a dimensao que esta sendo exibida (p_dim); o app.
-- decide, por tela, qual dos 3 filtros (tipo/familia/forma_pgto) mandar como
-- p_rotulos conforme o `dim` selecionado.
--
-- Importante (mesma licao da migration 057): "create or replace" com uma lista
-- de parametros DIFERENTE da existente cria um OVERLOAD, nao substitui -- e
-- chamar com menos args que batem em defaults de duas assinaturas quebra com
-- "function ... is not unique". Por isso o drop explicito da assinatura antiga
-- antes de recriar.
drop function if exists relatorio_faturamento_matriz(bigint, text);

create or replace function relatorio_faturamento_matriz(
  p_loja_id bigint,
  p_dim text,
  p_mes_ini text default null,
  p_mes_fim text default null,
  p_rotulos text[] default null
)
returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select rotulo, mes, sum(valor)::numeric
  from faturamento_importado
  where loja_id = p_loja_id
    and dimensao = p_dim
    and (p_mes_ini is null or mes >= p_mes_ini)
    and (p_mes_fim is null or mes <= p_mes_fim)
    and (p_rotulos is null or rotulo = any(p_rotulos))
  group by rotulo, mes
  order by rotulo, mes;
$$;

-- Rotulos distintos por dimensao (tipo/familia/forma_pgto) desta loja, pra
-- popular as opcoes dos 3 filtros multi-select na tela sem trazer a matriz
-- inteira (que pode passar de 1000 linhas com o PostgREST).
create or replace function relatorio_faturamento_opcoes(p_loja_id bigint)
returns table(dimensao text, rotulo text)
language sql stable as $$
  select distinct dimensao, rotulo
  from faturamento_importado
  where loja_id = p_loja_id
  order by dimensao, rotulo;
$$;
