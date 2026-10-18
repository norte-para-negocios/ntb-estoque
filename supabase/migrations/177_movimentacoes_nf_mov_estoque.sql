-- 177: Movimentação sem os itens de nota "não movimenta estoque" / "ignorar item" (Fase A, Task 7; item 6 do plano
-- docs/superpowers/plans/2026-10-18-fase-a-correcoes-provadas.md). Corpo = 170 (conferido igual a produção em
-- 18/10/2026) + só o filtro item_movimenta_estoque (175) no bloco de entradas de nota. Mesma assinatura e saída.
-- Depende da 175.

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
    -- Transferência (TRF/TPQ com destino) vira DUAS linhas, como no kardex do Omie: saída na origem (lado 1) e
    -- entrada no destino (lado 2). Assim o filtro de local mostra o sinal certo e os totais da loja se anulam.
    select 'm' || m.id || case when lado.n = 2 then 'd' else '' end as chave,
           case when m.data = date_trunc('day', m.data, 'UTC') then (m.data at time zone 'UTC')::date
                else (m.data at time zone 'America/Bahia')::date end as data,
           m.data as momento, m.id_prod as n_cod_prod,
           case when lado.n = 2 then m.codigo_local_estoque_destino else m.codigo_local_estoque end as codigo_local_estoque,
           case when lado.n = 1 and m.tipo in ('TRF', 'TPQ') then m.codigo_local_estoque_destino end as local_destino,
           case when m.tipo = 'SLD' then coalesce(m.quan, 0)
                when m.tipo = 'ENT' or lado.n = 2 then abs(coalesce(m.quan, 0))
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
    cross join lateral (values (1), (2)) as lado(n)
    left join lateral (
      select ii.inventario_id from inventario_items ii
      where m.tipo = 'SLD' and m.id_ajuste is not null and ii.loja_id = m.loja_id and ii.id_ajuste = m.id_ajuste
      limit 1
    ) inv on true
    where m.loja_id = p_loja_id
      and m.data >= (p_ini::timestamp at time zone 'UTC')
      and m.data < ((p_fim + 1)::timestamp at time zone 'UTC') + interval '3 hours'
      and coalesce(m.status, 'Concluido') = 'Concluido'
      and (lado.n = 1 or (m.tipo in ('TRF', 'TPQ') and m.codigo_local_estoque_destino is not null))

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
      and item_movimenta_estoque(it.full_object) -- 177: o Omie não lança no estoque
  ),
  f as (
    select * from u
    where u.data between p_ini and p_fim
      and (p_produtos is null or u.n_cod_prod = any (p_produtos))
      and (p_local is null or u.codigo_local_estoque = p_local)
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

notify pgrst, 'reload schema';
