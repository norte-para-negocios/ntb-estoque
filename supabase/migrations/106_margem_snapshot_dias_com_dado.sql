-- Fix round 1 da revisão da Task 13 (auditoria 2026-08-09): o cron
-- `snapshot-margem-diario` passou a PULAR o snapshot do dia de uma loja
-- quando uma consulta falha (ver migration 101 e o próprio cron -- decisão
-- deliberada: melhor um buraco detectável na série do que um número errado
-- gravado como se fosse real pra sempre, já que a tabela é append-only sem
-- retroativo possível). Mas sem retry, uma falha transiente vira um buraco
-- PERMANENTE naquele dia -- e `relatorio_margem_snapshot_matriz` fazia só
-- `avg()` do que existisse por mês, sem indicar quantos dias entraram na
-- média. Uma loja com 9 dias de dado e outra com 3 (por causa de 6 falhas)
-- mostravam o mesmo tipo de número, sem nenhum sinal de que a segunda média
-- é bem menos confiável. Adiciona `dias` (contagem de dias distintos que
-- entraram na média daquele mês) ao retorno -- a tela usa isso pra marcar o
-- cabeçalho do mês na "Evolução mensal" (candidato futuro: real retry no
-- cron, não implementado ainda).

-- CREATE OR REPLACE FUNCTION não permite mudar a lista de colunas de saída
-- de uma função RETURNS TABLE -- precisa dropar antes.
drop function if exists relatorio_margem_snapshot_matriz(bigint);

create function relatorio_margem_snapshot_matriz(p_loja_id bigint)
returns table (codigo text, descricao text, familia text, mes text, pdv numeric, cmc numeric, margem numeric, dias integer)
language sql stable as $$
  select
    codigo,
    max(descricao) as descricao,
    max(descricao_familia) as familia,
    to_char(data_snapshot, 'YYYY-MM') as mes,
    avg(pdv) as pdv,
    avg(cmc) as cmc,
    avg(margem) as margem,
    count(distinct data_snapshot)::int as dias
  from margem_snapshot_diario
  where loja_id = p_loja_id
  group by codigo, to_char(data_snapshot, 'YYYY-MM')
  order by codigo, mes
$$;
