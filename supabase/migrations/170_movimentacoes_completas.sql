-- 170 — Movimentações completas (13/10/2026): RLS "initplan" que faltou na 156, índices das telas de movimentação,
-- OP e nota, e a RPC movimentacoes_loja (lista completa de movimentos de uma loja Omie SEM o espelho completo).
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md). Depende da 160 (movimentos.autor,
-- ordens_producao.incluido_por_omie) e da 161. Numerada 170 para não colidir com a Fase 4 (162+).
--
-- Aplicar SEM -1/transação (os índices são CONCURRENTLY, não rodam dentro de transação):
--   docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 170_movimentacoes_completas.sql
-- Depois: desktop/scripts/gerar-schema.sh + versão nova do app desktop.
--
-- 1. RLS: a 156 reescreveu só as políticas cuja expressão era exatamente "(usuario_tem_acesso_loja(loja_id) OR
--    usuario_e_admin())". Ficaram de fora movimentos_historico (tem um cast ::bigint), lojas (coluna id) e as 3 tabelas
--    filhas (subconsulta EXISTS). Medido em 13/10 como usuário logado: RPC relatorio_movimentacao_matriz (loja 3, ano)
--    2.072 ms contra 189 ms sem RLS; 30 dias do Histórico 155 ms contra 30 ms. Mesma regra de acesso.
--    REVERTER: alter policy <nome> on public.<tabela> using (<expressão antiga, ver comentário de cada uma>).
--
-- 2. Índices: movimentos por produto (aba Movimentos/Saldo; sem índice = varre 146 MB), OPs por data prevista (lista e
--    contadores da tela de OP: 150–500 ms cada), OPs concluídas por data (RPC abaixo), busca de OP por número (trigram),
--    itens de NF por produto (notas do produto; o índice existente é parcial, só preço > 0), inventário por ajuste.
--
-- 3. movimentacoes_loja: une numa consulta só
--      - movimentos (ajustes, vendas do PDV, contagens SLD e transferências; só status Concluido = já está no Omie),
--      - produção (entrada do produto) e consumo (ficha gravada na OP, full_object.itensDetalhes) das OPs concluídas,
--      - entradas das notas fiscais concluídas e não canceladas (quantidade da nota, n_qtde_nfe).
--    Filtros, total e somas (contagem de inventário fora das somas) calculados no banco; paginação estável
--    (data, momento, chave). security invoker: vale a RLS de quem chama.

-- 1. RLS -----------------------------------------------------------------------------------------------------------
-- antes: (usuario_tem_acesso_loja((loja_id)::bigint) OR usuario_e_admin())
alter policy movimentos_historico_select_por_loja on public.movimentos_historico
  using ((select usuario_e_admin()) or loja_id::bigint in (select usuario_lojas()));
-- antes: (usuario_tem_acesso_loja(id) OR usuario_e_admin())
alter policy lojas_select_por_loja on public.lojas
  using ((select usuario_e_admin()) or id in (select usuario_lojas()));
-- antes: EXISTS (... WHERE v.id = vendas_proprio_itens.venda_id AND (usuario_tem_acesso_loja(v.loja_id) OR usuario_e_admin()))
alter policy vendas_proprio_itens_select on public.vendas_proprio_itens
  using (exists (select 1 from vendas_proprio v where v.id = vendas_proprio_itens.venda_id
                 and ((select usuario_e_admin()) or v.loja_id in (select usuario_lojas()))));
alter policy vendas_proprio_pagamentos_select on public.vendas_proprio_pagamentos
  using (exists (select 1 from vendas_proprio v where v.id = vendas_proprio_pagamentos.venda_id
                 and ((select usuario_e_admin()) or v.loja_id in (select usuario_lojas()))));
alter policy ordens_producao_proprio_itens_select on public.ordens_producao_proprio_itens
  using (exists (select 1 from ordens_producao_proprio o where o.id = ordens_producao_proprio_itens.ordem_id
                 and ((select usuario_e_admin()) or o.loja_id in (select usuario_lojas()))));

-- 2. Índices -------------------------------------------------------------------------------------------------------
create index concurrently if not exists movimentos_loja_prod_data_idx on public.movimentos (loja_id, id_prod, data desc);
create index concurrently if not exists ordens_producao_loja_previsao_idx on public.ordens_producao (loja_id, identificacao_d_dt_previsao);
create index concurrently if not exists ordens_producao_loja_conclusao_idx on public.ordens_producao (loja_id, dt_conclusao_real) where concluida;
create index concurrently if not exists ordens_producao_num_op_trgm on public.ordens_producao using gin (identificacao_c_num_op extensions.gin_trgm_ops);
create index concurrently if not exists nota_fiscal_items_loja_prod_idx on public.nota_fiscal_items (loja_id, n_id_produto);
create index concurrently if not exists inventario_items_loja_ajuste_idx on public.inventario_items (loja_id, id_ajuste) where id_ajuste is not null;

-- 3. RPC -----------------------------------------------------------------------------------------------------------
create or replace function public.movimentacoes_loja(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produtos bigint[] default null, p_local bigint default null, p_origem text default null,
  p_doc text default null, p_autor text default null, p_limit integer default 100, p_offset integer default 0
)
returns table (
  chave text, data date, momento timestamptz, n_cod_prod bigint, codigo_local_estoque bigint, local_destino bigint,
  quantidade numeric, contagem boolean, origem text, doc_tipo text, doc_id bigint, doc_rotulo text, autor text, obs text,
  total bigint, entradas numeric, saidas numeric
)
language sql stable security invoker set search_path = public as $$
  with u as (
    -- movimentos do Omie (ajustes, PDV, contagem, transferência). Data: o sync grava só a data (meia-noite UTC) e o
    -- app a hora real; meia-noite UTC exata = aquele dia, o resto = dia da Bahia (mesma regra de diaDoMovimento).
    select 'm' || m.id as chave,
           case when m.data = date_trunc('day', m.data, 'UTC') then (m.data at time zone 'UTC')::date
                else (m.data at time zone 'America/Bahia')::date end as data,
           m.data as momento, m.id_prod as n_cod_prod, m.codigo_local_estoque,
           case when m.tipo in ('TRF', 'TPQ') then m.codigo_local_estoque_destino end as local_destino,
           case when m.tipo = 'SLD' then coalesce(m.quan, 0)
                when m.tipo = 'ENT' then abs(coalesce(m.quan, 0))
                else -abs(coalesce(m.quan, 0)) end as quantidade,
           m.tipo = 'SLD' as contagem,
           case when m.origem = 'PDV' then 'pdv'
                when m.tipo = 'SLD' then 'inventario'
                when m.tipo in ('TRF', 'TPQ') or m.transferencia_id is not null then 'transferencia'
                else 'ajuste' end as origem,
           case when m.origem = 'PDV' then null
                when m.transferencia_id is not null then 'transferencia'
                when m.tipo = 'SLD' and inv.inventario_id is not null then 'inventario'
                else 'ajuste' end as doc_tipo,
           case when m.origem = 'PDV' then null
                when m.transferencia_id is not null then m.transferencia_id
                when m.tipo = 'SLD' and inv.inventario_id is not null then inv.inventario_id
                else coalesce(m.id_ajuste, m.id) end as doc_id,
           case when m.origem = 'PDV' then 'Venda PDV'
                when m.transferencia_id is not null then 'Transferência ' || m.transferencia_id
                when m.tipo = 'SLD' and inv.inventario_id is not null then 'Inventário ' || inv.inventario_id
                when m.id_ajuste is not null then 'Ajuste ' || m.id_ajuste
                else 'Ajuste do app ' || m.id end as doc_rotulo,
           m.autor, m.obs
    from movimentos m
    left join lateral (
      select ii.inventario_id from inventario_items ii
      where m.tipo = 'SLD' and m.id_ajuste is not null and ii.loja_id = m.loja_id and ii.id_ajuste = m.id_ajuste
      limit 1
    ) inv on true
    where m.loja_id = p_loja_id
      and m.data >= (p_ini::timestamp at time zone 'UTC')
      and m.data < ((p_fim + 1)::timestamp at time zone 'UTC') + interval '3 hours'
      and coalesce(m.status, 'Concluido') = 'Concluido'

    union all
    -- produção: entrada do produto da OP concluída, no local da OP, na data de conclusão
    select 'op' || o.id, o.dt_conclusao_real, null::timestamptz, o.identificacao_n_cod_produto,
           o.identificacao_codigo_local_estoque, null::bigint, coalesce(o.identificacao_n_qtde, 0), false,
           'op_producao', 'op', o.id, 'OP ' || coalesce(o.identificacao_c_num_op, o.num_ordem, o.id::text),
           coalesce(o.concluida_por_nome, o.incluido_por_omie), null::text
    from ordens_producao o
    where o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(o.identificacao_n_cod_produto, 0) <> 0

    union all
    -- consumo: cada insumo da ficha gravada na OP (itensDetalhes), no local do item (ou da OP). cUtilizarDoEstoque não
    -- filtra: na loja 5 todo insumo MP vem 'N' e mesmo assim sai do estoque no Omie (conferido com movimentos_historico).
    select 'oc' || o.id || '-' || i.n, o.dt_conclusao_real, null::timestamptz, (i.item->>'nIdProdutoMalha')::bigint,
           coalesce(nullif(i.item->>'codigo_local_estoque', '')::bigint, o.identificacao_codigo_local_estoque), null::bigint,
           -abs(coalesce(nullif(i.item->>'nQtde', '')::numeric, 0)), false,
           'op_consumo', 'op', o.id, 'OP ' || coalesce(o.identificacao_c_num_op, o.num_ordem, o.id::text),
           coalesce(o.concluida_por_nome, o.incluido_por_omie), null::text
    from ordens_producao o
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(o.full_object->'itensDetalhes') = 'array' then o.full_object->'itensDetalhes' else '[]'::jsonb end
    ) with ordinality as i(item, n)
    where o.loja_id = p_loja_id and o.concluida and o.dt_conclusao_real between p_ini and p_fim
      and coalesce(nullif(i.item->>'nIdProdutoMalha', '')::bigint, 0) <> 0

    union all
    -- entradas de nota fiscal concluída e não cancelada (quantidade e unidade da nota)
    select 'nf' || it.id, nf.d_emissao_nfe, null::timestamptz, it.n_id_produto,
           nullif(it.full_object->'itensAjustes'->>'codigo_local_estoque', '')::bigint, null::bigint,
           abs(coalesce(it.n_qtde_nfe, 0)), false,
           'nf', 'nf', nf.id, 'NF ' || coalesce(nf.c_numero_nfe, nf.id::text),
           null::text, coalesce(nf.c_razao_social, nf.c_nome)
    from notas_fiscais nf
    join nota_fiscal_items it on it.loja_id = nf.loja_id and it.nota_fiscal_id = nf.id
    where nf.loja_id = p_loja_id and nf.d_emissao_nfe between p_ini and p_fim and nf.deleted_at is null
      and nf.c_etapa = '60' and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') <> 'S'
      and coalesce(it.n_id_produto, 0) <> 0
  ),
  f as (
    select * from u
    where u.data between p_ini and p_fim
      and (p_produtos is null or u.n_cod_prod = any (p_produtos))
      and (p_local is null or u.codigo_local_estoque = p_local or u.local_destino = p_local)
      and (p_origem is null or p_origem = '' or u.origem = p_origem)
      and (p_doc is null or p_doc = '' or u.doc_rotulo ilike '%' || p_doc || '%')
      and (p_autor is null or p_autor = '' or u.autor ilike '%' || p_autor || '%')
  )
  select f.*,
         count(*) over () as total,
         coalesce(sum(case when not f.contagem and f.quantidade > 0 then f.quantidade end) over (), 0) as entradas,
         coalesce(sum(case when not f.contagem and f.quantidade < 0 then -f.quantidade end) over (), 0) as saidas
  from f
  order by f.data desc, f.momento desc nulls last, f.chave
  limit greatest(p_limit, 0) offset greatest(p_offset, 0)
$$;
revoke all on function public.movimentacoes_loja(bigint, date, date, bigint[], bigint, text, text, text, integer, integer) from public, anon;
grant execute on function public.movimentacoes_loja(bigint, date, date, bigint[], bigint, text, text, text, integer, integer) to authenticated;
