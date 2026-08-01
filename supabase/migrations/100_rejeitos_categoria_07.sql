-- Achado real 2026-08-01: dashboard de rejeitos (relatorio_rejeitos_por_tipo,
-- migration 093) so nomeava 3 das 6 categorias de baixa que a consultoria usa
-- (planilha MOV_AMJ_2026, abas "BAIXA *"). tipo_item='07' (Material de Uso e
-- Consumo) caia inteiro em "Outros", misturando Gastos Gerais, Despesas
-- Funcionarios e Material de Consumo genuino.
--
-- descricao_familia e texto livre por loja (confirmado ao vivo: "Gastos
-- Gerais"/"Gastos gerais"/"GASTOS GERAIS", "Despesas Funcionarios"/"Despesas
-- funcionarios" -- variam so em capitalizacao entre as 6 lojas) -- por isso
-- ilike case-insensitive, nao igualdade exata. As demais familias dentro de
-- tipo_item='07' (Atacado/Embalagens, Ativo, Mat. Escritorio, Mat. Limpeza,
-- Diversos etc) nao tem equivalente separado na planilha -- viram "Material
-- de Consumo" (a maior fatia declarada da aba "BAIXA MC" real).

create or replace function relatorio_rejeitos_por_tipo(
  p_loja_id  bigint,
  p_data_ini date,
  p_data_fim date
)
returns table (
  categoria      text,
  valor_total    numeric,
  qtd_movimentos bigint
)
language sql
stable
security invoker
as $$
  select
    case
      when p.tipo_item = '01' then 'Matéria-prima'
      when p.tipo_item = '00' then 'Revenda'
      when p.tipo_item in ('03', '06') then 'Produto em processo'
      when p.tipo_item = '07' and p.descricao_familia ilike '%gastos%ger%' then 'Gastos Gerais'
      when p.tipo_item = '07' and p.descricao_familia ilike '%despes%funcion%' then 'Despesas Funcionários'
      when p.tipo_item = '07' then 'Material de Consumo'
      else 'Outros'
    end as categoria,
    sum(coalesce(m.valor, 0) * coalesce(m.quan, 0)) as valor_total,
    count(*) as qtd_movimentos
  from movimentos m
  join produtos p on p.codigo_produto = m.id_prod and p.loja_id = m.loja_id
  where m.loja_id = p_loja_id
    and m.motivo = 'TPQ'
    and m.status = 'Concluido'
    and m.data >= p_data_ini
    and m.data < (p_data_fim + 1)
  group by categoria
  order by valor_total desc nulls last
$$;
