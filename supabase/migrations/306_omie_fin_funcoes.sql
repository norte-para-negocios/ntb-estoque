-- 306 — Financeiro A0: gravação idempotente do espelho do financeiro do Omie, visão "atual" e conferência.
-- Depende da 305. Aplicar logo depois dela (manual, backup + OK do dono), ANTES do código:
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 306_omie_fin_funcoes.sql
-- Teste: scripts/testes-sql/305_306_omie_fin.sql (banco local ntb-teste-sql).
--
-- Regras de gravação (as mesmas para aviso e API):
--   * chave do Omie (codigo_lancamento_omie / codigo_baixa / nCodLanc) + loja: repetir a mesma linha não muda nada;
--   * só regrava se a linha nova representa um instante IGUAL OU MAIS NOVO (`fonte_em`): aviso processado atrasado
--     nunca desfaz uma leitura mais nova da API, e vice-versa;
--   * campo que a fonte não traz (null) não apaga o que já existe (coalesce): o aviso do título não traz o resumo
--     (valor pago/aberto), a API não traz a tarifa da baixa;
--   * nunca apaga linha: título/lançamento excluído no Omie fica com excluido = true; baixa cancelada, cancelada = true;
--   * loja 4, loja de teste e loja fora do modo Omie são recusadas aqui também (defesa em profundidade).
-- Só o service role executa (o cron do servidor).

begin;
set lock_timeout = '5s';

create or replace function public.omie_fin_exigir_loja(p_loja bigint) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_loja = 4 or not exists (
    select 1 from lojas where id = p_loja and is_test = false and coalesce(modo_estoque, 'omie') = 'omie'
  ) then
    raise exception 'Espelho do financeiro do Omie: loja % não permitida', p_loja using errcode = '22023';
  end if;
end $$;

-- --------------------------------------------------------------------------------------------------------- títulos
-- p_linhas: [{codigo_lancamento_omie, natureza, ..., fonte_em, origem_dado, webhook_id, excluido,
--             so_rateio, categorias_definidas, categorias}]
--   so_rateio = true: aviso Rateio.Categoria — só grava `categorias` (cria a linha mínima se o título ainda não chegou).
--   categorias_definidas = true: a fonte diz qual é o rateio (inclusive "nenhum": null) e ele vale se for mais novo.
create or replace function public.omie_fin_gravar_titulos(p_loja bigint, p_linhas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_gravados int := 0; v_rateios int := 0; v_total int;
begin
  perform omie_fin_exigir_loja(p_loja);
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'p_linhas deve ser um array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_linhas);

  -- Cada elemento vira uma linha de omie_fin_titulos (campos a mais são ignorados) + as 2 marcas do lote.
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             where (e->>'codigo_lancamento_omie') is null or coalesce(e->>'natureza', '') not in ('P', 'R')) then
    raise exception 'Linha de título sem código ou natureza' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_linhas) e
             group by (e->>'codigo_lancamento_omie')::bigint, coalesce((e->>'so_rateio')::boolean, false) having count(*) > 1) then
    raise exception 'Título repetido no mesmo lote' using errcode = '22023';
  end if;

  -- Título completo (aviso do título ou API).
  with up as (
    insert into omie_fin_titulos as t (
      loja_id, codigo_lancamento_omie, natureza, codigo_lancamento_integracao, codigo_cliente_fornecedor, codigo_categoria,
      id_conta_corrente, data_emissao, data_registro, data_vencimento, data_previsao, data_pagamento, valor_documento,
      valor_pago, valor_aberto, valor_desconto, valor_juros, valor_multa, liquidado, resumo_em, status_titulo, situacao,
      excluido, excluido_em, numero_documento, numero_documento_fiscal, numero_parcela, numero_pedido, codigo_tipo_documento,
      id_origem, operacao, chave_nfe, nsu, codigo_projeto, codigo_vendedor, codigo_titulo_repeticao, incluido_omie_em,
      incluido_por, alterado_omie_em, alterado_por, visto_aberto_em, origem_dado, fonte_em, webhook_id, atualizado_em)
    select p_loja, l.codigo_lancamento_omie, l.natureza, l.codigo_lancamento_integracao, l.codigo_cliente_fornecedor, l.codigo_categoria,
      l.id_conta_corrente, l.data_emissao, l.data_registro, l.data_vencimento, l.data_previsao, l.data_pagamento, l.valor_documento,
      l.valor_pago, l.valor_aberto, l.valor_desconto, l.valor_juros, l.valor_multa, l.liquidado, l.resumo_em, l.status_titulo, l.situacao,
      coalesce(l.excluido, false), case when l.excluido then coalesce(l.excluido_em, l.fonte_em, now()) end,
      l.numero_documento, l.numero_documento_fiscal, l.numero_parcela, l.numero_pedido, l.codigo_tipo_documento,
      l.id_origem, l.operacao, l.chave_nfe, l.nsu, l.codigo_projeto, l.codigo_vendedor, l.codigo_titulo_repeticao, l.incluido_omie_em,
      l.incluido_por, l.alterado_omie_em, l.alterado_por, l.visto_aberto_em, coalesce(l.origem_dado, 'api'), l.fonte_em, l.webhook_id, now()
    from jsonb_array_elements(p_linhas) e cross join lateral jsonb_populate_record(null::omie_fin_titulos, e) l
    where not coalesce((e->>'so_rateio')::boolean, false)
    on conflict (loja_id, codigo_lancamento_omie) do update set
      natureza = excluded.natureza,
      codigo_lancamento_integracao = coalesce(excluded.codigo_lancamento_integracao, t.codigo_lancamento_integracao),
      codigo_cliente_fornecedor = coalesce(excluded.codigo_cliente_fornecedor, t.codigo_cliente_fornecedor),
      codigo_categoria = coalesce(excluded.codigo_categoria, t.codigo_categoria),
      id_conta_corrente = coalesce(excluded.id_conta_corrente, t.id_conta_corrente),
      data_emissao = coalesce(excluded.data_emissao, t.data_emissao),
      data_registro = coalesce(excluded.data_registro, t.data_registro),
      data_vencimento = coalesce(excluded.data_vencimento, t.data_vencimento),
      data_previsao = coalesce(excluded.data_previsao, t.data_previsao),
      data_pagamento = coalesce(excluded.data_pagamento, t.data_pagamento),
      valor_documento = coalesce(excluded.valor_documento, t.valor_documento),
      valor_pago = coalesce(excluded.valor_pago, t.valor_pago),
      valor_aberto = coalesce(excluded.valor_aberto, t.valor_aberto),
      valor_desconto = coalesce(excluded.valor_desconto, t.valor_desconto),
      valor_juros = coalesce(excluded.valor_juros, t.valor_juros),
      valor_multa = coalesce(excluded.valor_multa, t.valor_multa),
      liquidado = coalesce(excluded.liquidado, t.liquidado),
      resumo_em = coalesce(excluded.resumo_em, t.resumo_em),
      status_titulo = coalesce(excluded.status_titulo, t.status_titulo),
      situacao = coalesce(excluded.situacao, t.situacao),
      excluido = excluded.excluido,
      excluido_em = case when excluded.excluido then coalesce(t.excluido_em, excluded.excluido_em) end,
      numero_documento = coalesce(excluded.numero_documento, t.numero_documento),
      numero_documento_fiscal = coalesce(excluded.numero_documento_fiscal, t.numero_documento_fiscal),
      numero_parcela = coalesce(excluded.numero_parcela, t.numero_parcela),
      numero_pedido = coalesce(excluded.numero_pedido, t.numero_pedido),
      codigo_tipo_documento = coalesce(excluded.codigo_tipo_documento, t.codigo_tipo_documento),
      id_origem = coalesce(excluded.id_origem, t.id_origem),
      operacao = coalesce(excluded.operacao, t.operacao),
      chave_nfe = coalesce(excluded.chave_nfe, t.chave_nfe),
      nsu = coalesce(excluded.nsu, t.nsu),
      codigo_projeto = coalesce(excluded.codigo_projeto, t.codigo_projeto),
      codigo_vendedor = coalesce(excluded.codigo_vendedor, t.codigo_vendedor),
      codigo_titulo_repeticao = coalesce(excluded.codigo_titulo_repeticao, t.codigo_titulo_repeticao),
      incluido_omie_em = coalesce(excluded.incluido_omie_em, t.incluido_omie_em),
      incluido_por = coalesce(excluded.incluido_por, t.incluido_por),
      alterado_omie_em = coalesce(excluded.alterado_omie_em, t.alterado_omie_em),
      alterado_por = coalesce(excluded.alterado_por, t.alterado_por),
      visto_aberto_em = coalesce(excluded.visto_aberto_em, t.visto_aberto_em),
      origem_dado = excluded.origem_dado,
      fonte_em = excluded.fonte_em,
      webhook_id = coalesce(excluded.webhook_id, t.webhook_id),
      atualizado_em = now()
    where coalesce(t.fonte_em, '-infinity'::timestamptz) <= coalesce(excluded.fonte_em, '-infinity'::timestamptz)
    returning 1
  ) select count(*) into v_gravados from up;

  -- Varredura de abertos: "visto aberto" vale mesmo se a linha não foi regravada (havia dado mais novo).
  update omie_fin_titulos t set visto_aberto_em = l.visto_aberto_em
  from jsonb_array_elements(p_linhas) e cross join lateral jsonb_populate_record(null::omie_fin_titulos, e) l
  where t.loja_id = p_loja and t.codigo_lancamento_omie = l.codigo_lancamento_omie and l.visto_aberto_em is not null
    and t.visto_aberto_em is distinct from l.visto_aberto_em and coalesce(t.visto_aberto_em, '-infinity'::timestamptz) < l.visto_aberto_em;

  -- Rateio: linha mínima para o título que ainda não chegou (o aviso do título completa depois, fonte_em nula).
  insert into omie_fin_titulos (loja_id, codigo_lancamento_omie, natureza, origem_dado, webhook_id)
  select p_loja, (e->>'codigo_lancamento_omie')::bigint, e->>'natureza', 'rateio', (e->>'webhook_id')::bigint
  from jsonb_array_elements(p_linhas) e where coalesce((e->>'so_rateio')::boolean, false)
  on conflict (loja_id, codigo_lancamento_omie) do nothing;

  -- Rateio (aviso ou API com categorias_definidas): vale o mais novo do lote por título, se for mais novo que o gravado.
  with c as (
    select distinct on ((e->>'codigo_lancamento_omie')::bigint)
      (e->>'codigo_lancamento_omie')::bigint as codigo, case when jsonb_typeof(e->'categorias') = 'array' then e->'categorias' end as categorias,
      coalesce((e->>'categorias_em')::timestamptz, (e->>'fonte_em')::timestamptz) as em
    from jsonb_array_elements(p_linhas) e
    where coalesce((e->>'so_rateio')::boolean, false) or coalesce((e->>'categorias_definidas')::boolean, false)
    order by (e->>'codigo_lancamento_omie')::bigint, coalesce((e->>'categorias_em')::timestamptz, (e->>'fonte_em')::timestamptz) desc nulls last
  ), r as (
    update omie_fin_titulos t set categorias = c.categorias, categorias_em = c.em, atualizado_em = now()
    from c
    where t.loja_id = p_loja and t.codigo_lancamento_omie = c.codigo
      and coalesce(t.categorias_em, '-infinity'::timestamptz) <= coalesce(c.em, '-infinity'::timestamptz)
      and (t.categorias is distinct from c.categorias or t.categorias_em is distinct from c.em)
    returning 1
  ) select count(*) into v_rateios from r;

  return jsonb_build_object('linhas', v_total, 'gravados', v_gravados, 'rateios', v_rateios);
end $$;

-- ---------------------------------------------------------------------------------------------------------- baixas
create or replace function public.omie_fin_gravar_baixas(p_loja bigint, p_linhas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_gravados int := 0; v_total int;
begin
  perform omie_fin_exigir_loja(p_loja);
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'p_linhas deve ser um array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_linhas);
  if exists (select 1 from jsonb_populate_recordset(null::omie_fin_baixas, p_linhas) l
             where l.codigo_baixa is null or l.natureza is null or l.natureza not in ('P', 'R')) then
    raise exception 'Linha de baixa sem código ou natureza' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_populate_recordset(null::omie_fin_baixas, p_linhas) l group by l.codigo_baixa having count(*) > 1) then
    raise exception 'Baixa repetida no mesmo lote' using errcode = '22023';
  end if;

  with up as (
    insert into omie_fin_baixas as b (
      loja_id, codigo_baixa, natureza, codigo_lancamento_omie, codigo_lancamento_integracao, codigo_baixa_integracao,
      codigo_conta_corrente, codigo_cliente_fornecedor, codigo_categoria, data, data_cred, data_conciliacao, valor, juros, multa,
      desconto, tarifa, codigo_mov_cc, observacao, cancelada, cancelada_em, origem_dado, fonte_em, webhook_id, atualizado_em)
    select p_loja, l.codigo_baixa, l.natureza, l.codigo_lancamento_omie, l.codigo_lancamento_integracao, l.codigo_baixa_integracao,
      l.codigo_conta_corrente, l.codigo_cliente_fornecedor, l.codigo_categoria, l.data, l.data_cred, l.data_conciliacao, l.valor, l.juros, l.multa,
      l.desconto, l.tarifa, l.codigo_mov_cc, l.observacao, coalesce(l.cancelada, false),
      case when l.cancelada then coalesce(l.cancelada_em, l.fonte_em, now()) end, coalesce(l.origem_dado, 'api'), l.fonte_em, l.webhook_id, now()
    from jsonb_populate_recordset(null::omie_fin_baixas, p_linhas) l
    on conflict (loja_id, codigo_baixa) do update set
      natureza = excluded.natureza,
      codigo_lancamento_omie = coalesce(excluded.codigo_lancamento_omie, b.codigo_lancamento_omie),
      codigo_lancamento_integracao = coalesce(excluded.codigo_lancamento_integracao, b.codigo_lancamento_integracao),
      codigo_baixa_integracao = coalesce(excluded.codigo_baixa_integracao, b.codigo_baixa_integracao),
      codigo_conta_corrente = coalesce(excluded.codigo_conta_corrente, b.codigo_conta_corrente),
      codigo_cliente_fornecedor = coalesce(excluded.codigo_cliente_fornecedor, b.codigo_cliente_fornecedor),
      codigo_categoria = coalesce(excluded.codigo_categoria, b.codigo_categoria),
      data = coalesce(excluded.data, b.data),
      data_cred = coalesce(excluded.data_cred, b.data_cred),
      data_conciliacao = coalesce(excluded.data_conciliacao, b.data_conciliacao),
      valor = coalesce(excluded.valor, b.valor),
      juros = coalesce(excluded.juros, b.juros),
      multa = coalesce(excluded.multa, b.multa),
      desconto = coalesce(excluded.desconto, b.desconto),
      tarifa = coalesce(excluded.tarifa, b.tarifa),
      codigo_mov_cc = coalesce(excluded.codigo_mov_cc, b.codigo_mov_cc),
      observacao = coalesce(excluded.observacao, b.observacao),
      cancelada = excluded.cancelada,
      cancelada_em = case when excluded.cancelada then coalesce(b.cancelada_em, excluded.cancelada_em) end,
      origem_dado = excluded.origem_dado,
      fonte_em = excluded.fonte_em,
      webhook_id = coalesce(excluded.webhook_id, b.webhook_id),
      atualizado_em = now()
    where coalesce(b.fonte_em, '-infinity'::timestamptz) <= coalesce(excluded.fonte_em, '-infinity'::timestamptz)
    returning 1
  ) select count(*) into v_gravados from up;
  return jsonb_build_object('linhas', v_total, 'gravados', v_gravados);
end $$;

-- --------------------------------------------------------------------------------------- lançamentos de conta corrente
create or replace function public.omie_fin_gravar_lancamentos_cc(p_loja bigint, p_linhas jsonb) returns jsonb
language plpgsql set search_path = public as $$
declare v_gravados int := 0; v_total int;
begin
  perform omie_fin_exigir_loja(p_loja);
  if jsonb_typeof(p_linhas) is distinct from 'array' then raise exception 'p_linhas deve ser um array' using errcode = '22023'; end if;
  v_total := jsonb_array_length(p_linhas);
  if exists (select 1 from jsonb_populate_recordset(null::omie_fin_lancamentos_cc, p_linhas) l
             where l.n_cod_lanc is null or l.tipo is null) then
    raise exception 'Lançamento sem código ou tipo' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_populate_recordset(null::omie_fin_lancamentos_cc, p_linhas) l group by l.n_cod_lanc having count(*) > 1) then
    raise exception 'Lançamento repetido no mesmo lote' using errcode = '22023';
  end if;
  with up as (
    insert into omie_fin_lancamentos_cc as c (
      loja_id, n_cod_lanc, c_cod_int_lanc, tipo, n_cod_cc, n_cod_cc_destino, d_dt_lanc, n_valor_lanc, c_cod_categ, c_natureza,
      c_origem, c_tipo, c_num_doc, n_cod_cliente, c_obs, d_dt_conc, situacao, excluido, excluido_em, origem_dado, fonte_em, webhook_id, atualizado_em)
    select p_loja, l.n_cod_lanc, l.c_cod_int_lanc, l.tipo, l.n_cod_cc, l.n_cod_cc_destino, l.d_dt_lanc, l.n_valor_lanc, l.c_cod_categ, l.c_natureza,
      l.c_origem, l.c_tipo, l.c_num_doc, l.n_cod_cliente, l.c_obs, l.d_dt_conc, l.situacao, coalesce(l.excluido, false),
      case when l.excluido then coalesce(l.excluido_em, l.fonte_em, now()) end, coalesce(l.origem_dado, 'webhook'), l.fonte_em, l.webhook_id, now()
    from jsonb_populate_recordset(null::omie_fin_lancamentos_cc, p_linhas) l
    on conflict (loja_id, n_cod_lanc) do update set
      c_cod_int_lanc = coalesce(excluded.c_cod_int_lanc, c.c_cod_int_lanc),
      tipo = excluded.tipo,
      n_cod_cc = coalesce(excluded.n_cod_cc, c.n_cod_cc),
      n_cod_cc_destino = coalesce(excluded.n_cod_cc_destino, c.n_cod_cc_destino),
      d_dt_lanc = coalesce(excluded.d_dt_lanc, c.d_dt_lanc),
      n_valor_lanc = coalesce(excluded.n_valor_lanc, c.n_valor_lanc),
      c_cod_categ = coalesce(excluded.c_cod_categ, c.c_cod_categ),
      c_natureza = coalesce(excluded.c_natureza, c.c_natureza),
      c_origem = coalesce(excluded.c_origem, c.c_origem),
      c_tipo = coalesce(excluded.c_tipo, c.c_tipo),
      c_num_doc = coalesce(excluded.c_num_doc, c.c_num_doc),
      n_cod_cliente = coalesce(excluded.n_cod_cliente, c.n_cod_cliente),
      c_obs = coalesce(excluded.c_obs, c.c_obs),
      d_dt_conc = coalesce(excluded.d_dt_conc, c.d_dt_conc),
      situacao = coalesce(excluded.situacao, c.situacao),
      excluido = excluded.excluido,
      excluido_em = case when excluded.excluido then coalesce(c.excluido_em, excluded.excluido_em) end,
      origem_dado = excluded.origem_dado,
      fonte_em = excluded.fonte_em,
      webhook_id = coalesce(excluded.webhook_id, c.webhook_id),
      atualizado_em = now()
    where coalesce(c.fonte_em, '-infinity'::timestamptz) <= coalesce(excluded.fonte_em, '-infinity'::timestamptz)
    returning 1
  ) select count(*) into v_gravados from up;
  return jsonb_build_object('linhas', v_total, 'gravados', v_gravados);
end $$;

-- ------------------------------------------------------------------------------- títulos que sumiram dos abertos
-- Depois de uma varredura COMPLETA de abertos iniciada em p_desde: títulos que temos como abertos/parciais, que não
-- apareceram nela e que não mudaram depois do início dela (pago/excluído sem aviso). O cron confere um a um.
create or replace function public.omie_fin_abertos_nao_vistos(p_loja bigint, p_desde timestamptz, p_limite int default 500)
returns table (codigo_lancamento_omie bigint, natureza char(1)) language sql stable set search_path = public as $$
  select t.codigo_lancamento_omie, t.natureza from omie_fin_titulos t
  where t.loja_id = p_loja and not t.excluido and t.situacao in ('aberto', 'parcial')
    and coalesce(t.visto_aberto_em, '-infinity'::timestamptz) < p_desde
    and coalesce(t.fonte_em, '-infinity'::timestamptz) < p_desde
  order by t.codigo_lancamento_omie
  limit greatest(1, least(coalesce(p_limite, 500), 2000))
$$;

-- --------------------------------------------------------------------------------------------- visão "atual"
-- valor_aberto_atual: o resumo do Omie (API) quando ele é a informação mais nova do título; se depois dele chegou
-- aviso do título ou de baixa, estima pelo documento menos as baixas ativas (valor + desconto − juros − multa).
create or replace view public.omie_fin_titulos_atual with (security_invoker = true) as
select t.*,
  coalesce(b.qtd_baixas, 0) as qtd_baixas,
  coalesce(b.abatido, 0) as abatido_baixas,
  coalesce(b.pago, 0) as pago_baixas,
  b.ultima_baixa_em,
  case when t.excluido then 'excluido' else t.situacao end as situacao_atual,
  (t.resumo_em is not null and t.resumo_em >= coalesce(t.fonte_em, '-infinity'::timestamptz)
     and t.resumo_em >= coalesce(b.ultima_baixa_em, '-infinity'::timestamptz)) as resumo_atual,
  case
    when t.excluido or t.situacao = 'cancelado' then 0::numeric
    when t.resumo_em is not null and t.resumo_em >= coalesce(t.fonte_em, '-infinity'::timestamptz)
         and t.resumo_em >= coalesce(b.ultima_baixa_em, '-infinity'::timestamptz) then coalesce(t.valor_aberto, 0)
    when t.situacao = 'liquidado' then 0::numeric
    else greatest(coalesce(t.valor_documento, 0) - coalesce(b.abatido, 0), 0)
  end as valor_aberto_atual
from public.omie_fin_titulos t
left join lateral (
  select count(*) filter (where not x.cancelada) as qtd_baixas,
         sum(coalesce(x.valor, 0) + coalesce(x.desconto, 0) - coalesce(x.juros, 0) - coalesce(x.multa, 0)) filter (where not x.cancelada) as abatido,
         sum(coalesce(x.valor, 0)) filter (where not x.cancelada) as pago,
         max(x.fonte_em) filter (where x.origem_dado = 'webhook') as ultima_baixa_em
  from public.omie_fin_baixas x
  where x.loja_id = t.loja_id and x.codigo_lancamento_omie = t.codigo_lancamento_omie
) b on true;
revoke all on public.omie_fin_titulos_atual from anon, authenticated;
grant select on public.omie_fin_titulos_atual to service_role;

-- ----------------------------------------------------------------------------------------------------- conferência
-- Por loja: total a pagar/receber em aberto (hoje) e pago/recebido no mês (baixas não canceladas com data no mês),
-- para comparar com as telas do Omie (Finanças › Contas a Pagar/Receber). p_loja null = todas.
create or replace function public.omie_fin_conferencia(p_mes date default null, p_loja bigint default null)
returns table (loja_id bigint, natureza char(1), abertos_qtd bigint, abertos_valor numeric, vencidos_valor numeric,
               baixas_mes_qtd bigint, baixas_mes_valor numeric, titulos_qtd bigint, abertos_sem_resumo_atual bigint,
               ultima_fonte timestamptz)
language sql stable set search_path = public as $$
  with m as (
    select date_trunc('month', coalesce(p_mes, (now() at time zone 'America/Bahia')::date))::date as ini
  ), t as (
    select a.loja_id, a.natureza,
      count(*) filter (where a.valor_aberto_atual > 0) as abertos_qtd,
      coalesce(sum(a.valor_aberto_atual), 0) as abertos_valor,
      coalesce(sum(a.valor_aberto_atual) filter (where a.data_vencimento < (now() at time zone 'America/Bahia')::date), 0) as vencidos_valor,
      count(*) filter (where not a.excluido) as titulos_qtd,
      count(*) filter (where a.valor_aberto_atual > 0 and not a.resumo_atual) as abertos_sem_resumo_atual,
      max(a.fonte_em) as ultima_fonte
    from omie_fin_titulos_atual a
    where p_loja is null or a.loja_id = p_loja
    group by 1, 2
  ), b as (
    select x.loja_id, x.natureza, count(*) as qtd, coalesce(sum(x.valor), 0) as valor
    from omie_fin_baixas x, m
    where not x.cancelada and x.data >= m.ini and x.data < (m.ini + interval '1 month')::date
      and (p_loja is null or x.loja_id = p_loja)
    group by 1, 2
  )
  select coalesce(t.loja_id, b.loja_id), coalesce(t.natureza, b.natureza)::char(1), coalesce(t.abertos_qtd, 0), coalesce(t.abertos_valor, 0),
         coalesce(t.vencidos_valor, 0), coalesce(b.qtd, 0), coalesce(b.valor, 0), coalesce(t.titulos_qtd, 0),
         coalesce(t.abertos_sem_resumo_atual, 0), t.ultima_fonte
  from t full join b on b.loja_id = t.loja_id and b.natureza = t.natureza
  order by 1, 2
$$;

-- ------------------------------------------------------------------------------------------------------- permissões
do $$ declare f text; begin
  foreach f in array array[
    'omie_fin_exigir_loja(bigint)', 'omie_fin_gravar_titulos(bigint, jsonb)', 'omie_fin_gravar_baixas(bigint, jsonb)',
    'omie_fin_gravar_lancamentos_cc(bigint, jsonb)', 'omie_fin_abertos_nao_vistos(bigint, timestamptz, int)',
    'omie_fin_conferencia(date, bigint)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
